// Simple in-memory Hash store for PoC
// Exports functions to check which hashes exist and to add hashes

const hashStore = new Map(); // sha256 -> refCount

function checkHashes(hashList) {
  // return an array of objects: { hash, exists }
  return hashList.map((h) => ({ hash: h, exists: hashStore.has(h) }));
}

function addHashes(hashList) {
  for (const h of hashList) {
    const count = hashStore.get(h) || 0;
    hashStore.set(h, count + 1);
  }
}

function getAll() {
  return Array.from(hashStore.entries()).map(([sha256, refCount]) => ({
    sha256,
    refCount,
  }));
}

module.exports = { checkHashes, addHashes, getAll };
