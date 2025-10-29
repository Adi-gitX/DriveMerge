const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const bodyParser = require("body-parser");
const { checkHashes, addHashes, getAll } = require("./db/simpleHashes");
const { createFile } = require("./db/files");
const { createJob } = require("./db/jobs");
const { signToken, verifyToken, requireAuth } = require('./auth');

const app = express();
app.use(bodyParser.json({ limit: "10mb" }));

// Simple CORS for PoC: allow requests from Next dev server
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:3000");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const PORT = process.env.PORT || 4000;

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Prisma client helper (lazy): prints DB mode at startup
const { isEnabled: prismaIsEnabled, getClient: getPrismaClient } = require('./db/prismaClient');

// Simple broadcast helper
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

app.get("/health", async (req, res) => {
  const resp = { ok: true };
  try {
    if (prismaIsEnabled()) {
      // quick DB probe
      try {
        const p = getPrismaClient();
        // run a tiny, cheap query
        await p.$queryRaw`SELECT 1`;
        resp.db = 'ok';
      } catch (err) {
        resp.db = 'down';
        resp.dbError = String(err).slice(0, 200);
      }
    } else {
      resp.db = 'disabled';
    }
  } catch (err) {
    resp.db = 'error';
    resp.dbError = String(err).slice(0, 200);
  }
  res.json(resp);
});

// PoC endpoint: accept file metadata + chunkHashes
// Request body: { fileName, fileSize, chunkHashes: [sha256,...] }
app.post("/api/files/create", async (req, res) => {
  const { fileName, fileSize } = req.body || {};
  // Accept either 'chunkHashes' (array of sha256) or 'chunks' (array of metadata {hash,...})
  let chunks = [];
  if (Array.isArray(req.body.chunkHashes)) chunks = req.body.chunkHashes.map((h) => ({ hash: h }));
  else if (Array.isArray(req.body.chunks)) chunks = req.body.chunks.map((c) => ({ hash: c.hash, size: c.size, wrappedChunkKey: c.wrappedChunkKey, wrapIv: c.wrapIv, chunkIv: c.chunkIv }));
  else return res.status(400).json({ error: "chunkHashes or chunks must be provided as an array" });

  const chunkHashes = chunks.map((c) => c.hash).filter(Boolean);
  const results = await checkHashes(chunkHashes);

  // Build response: for each hash, if exists -> deduplicated, else -> needs_upload with placeholder URL
  const jobs = results.map((r) => {
    if (r.exists) {
      return { hash: r.hash, status: "deduplicated" };
    }
    return {
      hash: r.hash,
      status: "needs_upload",
      uploadUrl: `https://example.com/upload/${r.hash}`,
    };
  });

  // Persist file metadata (wrapped file key if provided)
  const wrappedFileKey = req.body.wrappedFileKey || null;
  const wrappedFileKeyIv = req.body.wrappedFileKeyIv || null;
  // if Authorization header provided and valid, attach ownerId
  let ownerId = null;
  try {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.slice(7).trim();
      const payload = verifyToken(token);
      if (payload && payload.userId) ownerId = payload.userId;
    }
  } catch (e) {}

  const fileRec = await createFile({ fileName, fileSize, chunks, wrappedFileKey, wrappedFileKeyIv });
  if (ownerId) {
    // update ownerId in record (directly mutate for PoC)
    fileRec.ownerId = ownerId;
    // persist updated
    const { updateFile } = require('./db/files');
    updateFile(fileRec.id, { ownerId });
  }

  // Persist a Job record (PoC) containing per-chunk items and broadcast job_ready
  let jobRec = null;
  try {
    jobRec = await createJob({ fileId: fileRec.id, items: jobs });
  } catch (err) {
    // If job persistence fails, log and continue — still return the ephemeral jobs
    console.error('createJob failed:', String(err));
  }

  // Broadcast a job_ready message to all WebSocket clients, include fileId and job info
  broadcast({ type: "job_ready", fileId: fileRec.id, fileName, fileSize, jobs, job: jobRec });

  // Respond with the jobs and fileId (include persisted job if available)
  res.json({ fileId: fileRec.id, fileName, fileSize, jobs, job: jobRec });
});

// PoC endpoint to simulate commit of uploaded chunks (client can call after upload)
app.post("/api/files/commit", (req, res) => {
  const { chunkHashes } = req.body || {};
  if (!Array.isArray(chunkHashes))
    return res.status(400).json({ error: "chunkHashes must be an array" });
  (async () => {
    await addHashes(chunkHashes);
    broadcast({ type: "hashes_committed", count: chunkHashes.length });
    res.json({ ok: true, committed: chunkHashes.length });
  })().catch((err) => res.status(500).json({ error: String(err) }));
});

// Admin: list known hashes
app.get("/api/hashes", async (req, res) => {
  try {
    const rows = await getAll();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Admin: list jobs (PoC)
app.get('/api/jobs', async (req, res) => {
  try {
    const { listJobs } = require('./db/jobs');
    const rows = await listJobs();
    res.json({ jobs: rows });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Return list of stored files (PoC)
app.get('/api/files', async (req, res) => {
  try {
    const { listFiles } = require('./db/files');
    const data = await listFiles();
    res.json({ files: data });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Return file metadata by id
app.get('/api/files/:fileId', async (req, res) => {
  try {
    const { getFile } = require('./db/files');
    const rec = await getFile(req.params.fileId);
    if (!rec) return res.status(404).json({ error: 'file not found' });
    res.json({ file: rec });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Accept user-uploaded metadata backup for a file (wrapped file key etc.)
app.post('/api/files/:fileId/metadata', async (req, res) => {
  try {
    const { getFile, updateFile } = require('./db/files');
    const id = req.params.fileId;
    const rec = await getFile(id);
    if (!rec) return res.status(404).json({ error: 'file not found' });

    // require auth and ensure requester is owner
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'missing authorization' });
    const token = auth.slice(7).trim();
    const payload = verifyToken(token);
    if (!payload || !payload.userId) return res.status(401).json({ error: 'invalid token' });
    if (rec.ownerId && rec.ownerId !== payload.userId) return res.status(403).json({ error: 'not owner' });

    const { wrappedFileKey, wrappedFileKeyIv, note } = req.body || {};
    const patch = {};
    if (typeof wrappedFileKey === 'string') patch.wrappedFileKey = wrappedFileKey;
    if (typeof wrappedFileKeyIv === 'string') patch.wrappedFileKeyIv = wrappedFileKeyIv;
    if (typeof note === 'string') patch.note = note;

    const updated = await updateFile(id, patch);
    res.json({ ok: true, file: updated });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// WebSocket greeting
wss.on("connection", (ws) => {
  ws.send(
    JSON.stringify({ type: "welcome", msg: "DriveMerge PoC WS connected" })
  );

  ws.on("message", (message) => {
    // When a client sends a WS message (e.g., progress), broadcast it to all clients
    try {
      const parsed = JSON.parse(message.toString());
      broadcast({ type: "client_event", payload: parsed });
    } catch (err) {
      broadcast({ type: "client_event", payload: String(message) });
    }
  });
});

// Simple auth: issue a JWT for a username (PoC). In production, replace with OAuth or NextAuth.
app.post('/api/auth/login', (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username required' });
  // For PoC accept any username and return a signed token with userId=username
  const token = signToken({ userId: String(username) });
  res.json({ ok: true, token });
});

// Friendly error handling for common startup failures (e.g., port in use)
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the process using it, or run with a different PORT environment variable, e.g. PORT=4001 node src/server.js`);
    process.exit(1);
  }
  console.error('Server error:', err);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`DriveMerge PoC server listening on http://localhost:${PORT}`);
  // Print whether Prisma is enabled and attempt a quick connection for visibility
  try {
    if (prismaIsEnabled()) {
      const prisma = getPrismaClient();
      prisma
        .$connect()
        .then(() => {
          console.log('Prisma client: enabled and connected to database');
        })
        .catch((err) => {
          console.error('Prisma client: enabled but failed to connect:', String(err));
        });
    } else {
      console.log('Prisma client: not enabled, running with in-memory fallback');
    }
  } catch (err) {
    console.error('Prisma client check failed:', String(err));
  }
});

// Graceful shutdown: disconnect Prisma if connected
process.on('SIGINT', async () => {
  if (prismaIsEnabled()) {
    try {
      const p = getPrismaClient();
      await p.$disconnect();
      console.log('Prisma disconnected');
    } catch (err) {
      // ignore
    }
  }
  process.exit(0);
});
