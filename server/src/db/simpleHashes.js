// Hash store wrapper — prefer Prisma when available, fall back to in-memory PoC store
const { isEnabled, getClient } = require('./prismaClient');

// In-memory fallback
const fallback = (() => {
  const hashStore = new Map(); // sha256 -> refCount

  function checkHashes(hashList) {
    return hashList.map((h) => ({ hash: h, exists: hashStore.has(h) }));
  }

  function addHashes(hashList) {
    for (const h of hashList) {
      const count = hashStore.get(h) || 0;
      hashStore.set(h, count + 1);
    }
  }

  function getAll() {
    return Array.from(hashStore.entries()).map(([sha256, refCount]) => ({ sha256, refCount }));
  }

  return { checkHashes, addHashes, getAll };
})();

async function checkHashes(hashList) {
  if (!isEnabled()) return fallback.checkHashes(hashList);
  const prisma = getClient();
  const out = [];
  for (const h of hashList) {
    const rec = await prisma.hash.findUnique({ where: { sha256: h } });
    out.push({ hash: h, exists: !!rec });
  }
  return out;
}

async function addHashes(hashList) {
  if (!isEnabled()) return fallback.addHashes(hashList);
  const prisma = getClient();
  for (const h of hashList) {
    try {
      await prisma.hash.upsert({ where: { sha256: h }, update: { refCount: { increment: 1 } }, create: { sha256: h, refCount: 1 } });
    } catch (err) {
      // ignore individual upsert errors for PoC
    }
  }
}

async function getAll() {
  if (!isEnabled()) return fallback.getAll();
  const prisma = getClient();
  const rows = await prisma.hash.findMany();
  return rows.map((r) => ({ sha256: r.sha256, refCount: r.refCount }));
}

module.exports = { checkHashes, addHashes, getAll };
