// simple in-memory files store for PoC
// Each file record: { id, fileName, fileSize, chunks: [{hash,size,...}], wrappedFileKey, wrappedFileKeyIv, createdAt }
const files = new Map();
let nextId = 1;

function createFile({ fileName, fileSize, chunks = [], wrappedFileKey = null, wrappedFileKeyIv = null }) {
  const id = String(nextId++);
  const rec = {
    id,
    fileName: fileName || null,
    fileSize: Number.isFinite(fileSize) ? fileSize : null,
    chunks: Array.isArray(chunks) ? chunks : [],
    wrappedFileKey: wrappedFileKey || null,
    wrappedFileKeyIv: wrappedFileKeyIv || null,
    createdAt: new Date().toISOString(),
  };
  files.set(id, rec);
  return rec;
}

function getFile(id) {
  return files.get(String(id)) || null;
}

function listFiles() {
  return Array.from(files.values());
}

function updateFile(id, patch) {
  const key = String(id);
  if (!files.has(key)) return null;
  const cur = files.get(key);
  const updated = Object.assign({}, cur, patch, { id: cur.id });
  files.set(key, updated);
  return updated;
}

module.exports = { createFile, getFile, listFiles };
