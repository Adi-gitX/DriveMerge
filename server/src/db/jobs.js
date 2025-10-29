const { isEnabled, getClient } = require('./prismaClient');

// In-memory fallback
const fallback = (() => {
  const jobs = new Map();
  let nextId = 1;

  function createJob({ fileId, items = [], status = 'pending' }) {
    const id = String(nextId++);
    const rec = { id, fileId, status, createdAt: new Date().toISOString(), items: items.map((it, i) => ({ id: `${id}:${i}`, hash: it.hash, status: it.status || 'needs_upload', uploadUrl: it.uploadUrl || null })) };
    jobs.set(id, rec);
    return rec;
  }

  function getJob(id) {
    return jobs.get(String(id)) || null;
  }

  function listJobs() {
    return Array.from(jobs.values());
  }

  return { createJob, getJob, listJobs };
})();

async function createJob({ fileId, items = [], status = 'pending' }) {
  if (!isEnabled()) return fallback.createJob({ fileId, items, status });
  const prisma = getClient();
  const rec = await prisma.job.create({
    data: {
      file: { connect: { id: String(fileId) } },
      status,
      items: { create: items.map((it) => ({ hash: it.hash, status: it.status || 'needs_upload', uploadUrl: it.uploadUrl || null })) },
    },
    include: { items: true },
  });
  return {
    id: rec.id,
    fileId: rec.fileId,
    status: rec.status,
    createdAt: rec.createdAt.toISOString(),
    items: rec.items.map((it) => ({ id: it.id, hash: it.hash, status: it.status, uploadUrl: it.uploadUrl })),
  };
}

async function getJob(id) {
  if (!isEnabled()) return fallback.getJob(id);
  const prisma = getClient();
  const rec = await prisma.job.findUnique({ where: { id: String(id) }, include: { items: true } });
  if (!rec) return null;
  return {
    id: rec.id,
    fileId: rec.fileId,
    status: rec.status,
    createdAt: rec.createdAt.toISOString(),
    items: rec.items.map((it) => ({ id: it.id, hash: it.hash, status: it.status, uploadUrl: it.uploadUrl })),
  };
}

async function listJobs() {
  if (!isEnabled()) return fallback.listJobs();
  const prisma = getClient();
  const rows = await prisma.job.findMany({ include: { items: true }, orderBy: { createdAt: 'desc' } });
  return rows.map((rec) => ({ id: rec.id, fileId: rec.fileId, status: rec.status, createdAt: rec.createdAt.toISOString(), items: rec.items.map((it) => ({ id: it.id, hash: it.hash, status: it.status, uploadUrl: it.uploadUrl })) }));
}

module.exports = { createJob, getJob, listJobs };
