// Files DB wrapper — prefer Prisma when available, fall back to in-memory PoC store
const { isEnabled, getClient } = require('./prismaClient');

// In-memory fallback implementation (keeps existing PoC behavior)
const fallback = (() => {
  const files = new Map();
  let nextId = 1;

  function createFile({ fileName, fileSize, chunks = [], wrappedFileKey = null, wrappedFileKeyIv = null, ownerId = null }) {
    const id = String(nextId++);
    const rec = {
      id,
      fileName: fileName || null,
      fileSize: Number.isFinite(fileSize) ? fileSize : null,
      chunks: Array.isArray(chunks) ? chunks : [],
      wrappedFileKey: wrappedFileKey || null,
      wrappedFileKeyIv: wrappedFileKeyIv || null,
      ownerId: ownerId || null,
      note: null,
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

  return { createFile, getFile, listFiles, updateFile };
})();

async function createFile(params) {
  if (!isEnabled()) return fallback.createFile(params);
  const prisma = getClient();
  const { fileName, fileSize, chunks = [], wrappedFileKey = null, wrappedFileKeyIv = null, ownerId = null } = params;
  const created = await prisma.file.create({
    data: {
      fileName,
      fileSize: fileSize == null ? null : Number(fileSize),
      wrappedFileKey,
      wrappedFileKeyIv,
      ownerId,
      chunks: { create: chunks.map((c) => ({ hash: c.hash, size: c.size || null, wrappedChunkKey: c.wrappedChunkKey || null, wrapIv: c.wrapIv || null, chunkIv: c.chunkIv || null })) },
    },
    include: { chunks: true },
  });
  // convert to PoC shape
  return {
    id: created.id,
    fileName: created.fileName,
    fileSize: created.fileSize,
    chunks: created.chunks.map((c) => ({ hash: c.hash, size: c.size })),
    wrappedFileKey: created.wrappedFileKey,
    wrappedFileKeyIv: created.wrappedFileKeyIv,
    ownerId: created.ownerId,
    note: created.note,
    createdAt: created.createdAt.toISOString(),
  };
}

async function getFile(id) {
  if (!isEnabled()) return fallback.getFile(id);
  const prisma = getClient();
  const rec = await prisma.file.findUnique({ where: { id: String(id) }, include: { chunks: true } });
  if (!rec) return null;
  return {
    id: rec.id,
    fileName: rec.fileName,
    fileSize: rec.fileSize,
    chunks: rec.chunks.map((c) => ({ hash: c.hash, size: c.size })),
    wrappedFileKey: rec.wrappedFileKey,
    wrappedFileKeyIv: rec.wrappedFileKeyIv,
    ownerId: rec.ownerId,
    note: rec.note,
    createdAt: rec.createdAt.toISOString(),
  };
}

async function listFiles() {
  if (!isEnabled()) return fallback.listFiles();
  const prisma = getClient();
  const rows = await prisma.file.findMany({ include: { chunks: true }, orderBy: { createdAt: 'desc' } });
  return rows.map((rec) => ({
    id: rec.id,
    fileName: rec.fileName,
    fileSize: rec.fileSize,
    chunks: rec.chunks.map((c) => ({ hash: c.hash, size: c.size })),
    wrappedFileKey: rec.wrappedFileKey,
    wrappedFileKeyIv: rec.wrappedFileKeyIv,
    ownerId: rec.ownerId,
    note: rec.note,
    createdAt: rec.createdAt.toISOString(),
  }));
}

async function updateFile(id, patch) {
  if (!isEnabled()) return fallback.updateFile(id, patch);
  const prisma = getClient();
  // Only allow updating specific fields in PoC
  const data = {};
  if (typeof patch.wrappedFileKey === 'string') data.wrappedFileKey = patch.wrappedFileKey;
  if (typeof patch.wrappedFileKeyIv === 'string') data.wrappedFileKeyIv = patch.wrappedFileKeyIv;
  if (typeof patch.ownerId === 'string') data.ownerId = patch.ownerId;
  if (typeof patch.note === 'string') data.note = patch.note;
  if (Object.keys(data).length === 0) return getFile(id);
  const updated = await prisma.file.update({ where: { id: String(id) }, data, include: { chunks: true } });
  return {
    id: updated.id,
    fileName: updated.fileName,
    fileSize: updated.fileSize,
    chunks: updated.chunks.map((c) => ({ hash: c.hash, size: c.size })),
    wrappedFileKey: updated.wrappedFileKey,
    wrappedFileKeyIv: updated.wrappedFileKeyIv,
    ownerId: updated.ownerId,
    note: updated.note,
    createdAt: updated.createdAt.toISOString(),
  };
}

module.exports = { createFile, getFile, listFiles, updateFile };
