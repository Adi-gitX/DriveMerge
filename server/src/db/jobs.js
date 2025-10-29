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

  function updateJobItem(jobId, itemId, patch = {}) {
    const rec = jobs.get(String(jobId));
    if (!rec) return null;
    const it = rec.items.find((x) => x.id === String(itemId));
    if (!it) return null;
    Object.assign(it, patch);
    return it;
  }

  function updateJobStatus(jobId, status) {
    const rec = jobs.get(String(jobId));
    if (!rec) return null;
    rec.status = status;
    return rec;
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

async function updateJobItem(jobId, itemId, patch = {}) {
  if (!isEnabled()) return fallback.updateJobItem(jobId, itemId, patch);
  const prisma = getClient();
  const updated = await prisma.jobItem.update({ where: { id: String(itemId) }, data: { ...patch } });
  return { id: updated.id, hash: updated.hash, status: updated.status, uploadUrl: updated.uploadUrl };
}

async function updateJobStatus(jobId, status) {
  if (!isEnabled()) return fallback.updateJobStatus(jobId, status);
  const prisma = getClient();
  const updated = await prisma.job.update({ where: { id: String(jobId) }, data: { status } });
  return { id: updated.id, status: updated.status };
}

async function listJobs() {
  if (!isEnabled()) return fallback.listJobs();
  const prisma = getClient();
  const rows = await prisma.job.findMany({ include: { items: true }, orderBy: { createdAt: 'desc' } });
  return rows.map((rec) => ({ id: rec.id, fileId: rec.fileId, status: rec.status, createdAt: rec.createdAt.toISOString(), items: rec.items.map((it) => ({ id: it.id, hash: it.hash, status: it.status, uploadUrl: it.uploadUrl })) }));
}

module.exports = { createJob, getJob, listJobs, updateJobItem, updateJobStatus };
