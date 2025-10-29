const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const bodyParser = require("body-parser");
const { checkHashes, addHashes, getAll } = require("./db/simpleHashes");
const { createFile } = require("./db/files");

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

// Simple broadcast helper
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

app.get("/health", (req, res) => res.json({ ok: true }));

// PoC endpoint: accept file metadata + chunkHashes
// Request body: { fileName, fileSize, chunkHashes: [sha256,...] }
app.post("/api/files/create", (req, res) => {
  const { fileName, fileSize } = req.body || {};
  // Accept either 'chunkHashes' (array of sha256) or 'chunks' (array of metadata {hash,...})
  let chunks = [];
  if (Array.isArray(req.body.chunkHashes)) chunks = req.body.chunkHashes.map((h) => ({ hash: h }));
  else if (Array.isArray(req.body.chunks)) chunks = req.body.chunks.map((c) => ({ hash: c.hash, size: c.size, wrappedChunkKey: c.wrappedChunkKey, wrapIv: c.wrapIv, chunkIv: c.chunkIv }));
  else return res.status(400).json({ error: "chunkHashes or chunks must be provided as an array" });

  const chunkHashes = chunks.map((c) => c.hash).filter(Boolean);
  const results = checkHashes(chunkHashes);

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
  const fileRec = createFile({ fileName, fileSize, chunks, wrappedFileKey, wrappedFileKeyIv });

  // Broadcast a job_ready message to all WebSocket clients, include fileId
  broadcast({ type: "job_ready", fileId: fileRec.id, fileName, fileSize, jobs });

  // Respond with the jobs and fileId
  res.json({ fileId: fileRec.id, fileName, fileSize, jobs });
});

// PoC endpoint to simulate commit of uploaded chunks (client can call after upload)
app.post("/api/files/commit", (req, res) => {
  const { chunkHashes } = req.body || {};
  if (!Array.isArray(chunkHashes))
    return res.status(400).json({ error: "chunkHashes must be an array" });
  addHashes(chunkHashes);
  broadcast({ type: "hashes_committed", count: chunkHashes.length });
  res.json({ ok: true, committed: chunkHashes.length });
});

// Admin: list known hashes
app.get("/api/hashes", (req, res) => res.json(getAll()));

// Return list of stored files (PoC)
app.get('/api/files', (req, res) => {
  try {
    const { listFiles } = require('./db/files');
    const data = listFiles();
    res.json({ files: data });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Return file metadata by id
app.get('/api/files/:fileId', (req, res) => {
  try {
    const { getFile } = require('./db/files');
    const rec = getFile(req.params.fileId);
    if (!rec) return res.status(404).json({ error: 'file not found' });
    res.json({ file: rec });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Accept user-uploaded metadata backup for a file (wrapped file key etc.)
app.post('/api/files/:fileId/metadata', (req, res) => {
  try {
    const { getFile, updateFile } = require('./db/files');
    const id = req.params.fileId;
    const rec = getFile(id);
    if (!rec) return res.status(404).json({ error: 'file not found' });

    const { wrappedFileKey, wrappedFileKeyIv, note } = req.body || {};
    const patch = {};
    if (typeof wrappedFileKey === 'string') patch.wrappedFileKey = wrappedFileKey;
    if (typeof wrappedFileKeyIv === 'string') patch.wrappedFileKeyIv = wrappedFileKeyIv;
    if (typeof note === 'string') patch.note = note;

    const updated = updateFile(id, patch);
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
});
