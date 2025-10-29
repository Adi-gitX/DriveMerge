const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bodyParser = require('body-parser');
const { checkHashes, addHashes, getAll } = require('./db/simpleHashes');

const app = express();
app.use(bodyParser.json({ limit: '10mb' }));

// Simple CORS for PoC: allow requests from Next dev server
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
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

app.get('/health', (req, res) => res.json({ ok: true }));

// PoC endpoint: accept file metadata + chunkHashes
// Request body: { fileName, fileSize, chunkHashes: [sha256,...] }
app.post('/api/files/create', (req, res) => {
  const { fileName, fileSize, chunkHashes } = req.body || {};
  if (!Array.isArray(chunkHashes)) {
    return res.status(400).json({ error: 'chunkHashes must be an array' });
  }

  const results = checkHashes(chunkHashes);

  // Build response: for each hash, if exists -> deduplicated, else -> needs_upload with placeholder URL
  const jobs = results.map((r) => {
    if (r.exists) {
      return { hash: r.hash, status: 'deduplicated' };
    }
    return { hash: r.hash, status: 'needs_upload', uploadUrl: `https://example.com/upload/${r.hash}` };
  });

  // Broadcast a job_ready message to all WebSocket clients
  broadcast({ type: 'job_ready', fileName, fileSize, jobs });

  // Respond with the jobs
  res.json({ fileName, fileSize, jobs });
});

// PoC endpoint to simulate commit of uploaded chunks (client can call after upload)
app.post('/api/files/commit', (req, res) => {
  const { chunkHashes } = req.body || {};
  if (!Array.isArray(chunkHashes)) return res.status(400).json({ error: 'chunkHashes must be an array' });
  addHashes(chunkHashes);
  broadcast({ type: 'hashes_committed', count: chunkHashes.length });
  res.json({ ok: true, committed: chunkHashes.length });
});

// Admin: list known hashes
app.get('/api/hashes', (req, res) => res.json(getAll()));

// WebSocket greeting
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'welcome', msg: 'DriveMerge PoC WS connected' }));
});

server.listen(PORT, () => {
  console.log(`DriveMerge PoC server listening on http://localhost:${PORT}`);
});
