const { Queue, Worker, QueueScheduler } = require('bullmq');
const IORedis = require('ioredis');
const { getClient, isEnabled } = require('../db/prismaClient');
const { getJob, updateJobItem, updateJobStatus } = require('../db/jobs');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const QUEUE_NAME = process.env.QUEUE_NAME || 'drivemerge:jobs';

let queue = null;
let worker = null;
let scheduler = null;

function initQueue() {
  if (queue) return queue;
  const connection = new IORedis(REDIS_URL);
  queue = new Queue(QUEUE_NAME, { connection });
  // scheduler helps retry/clean stalled
  scheduler = new QueueScheduler(QUEUE_NAME, { connection });
  return queue;
}

async function enqueueJob(jobId) {
  const q = initQueue();
  return q.add('generate-urls', { jobId }, { removeOnComplete: true, attempts: 3 });
}

function startWorker(options = {}) {
  const { onUpdate } = options;
  if (worker) return worker;
  const connection = new IORedis(REDIS_URL);
  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { jobId } = job.data;
      // fetch job details
      const rec = await getJob(jobId);
      if (!rec) return;
      // mark job in_progress
      await updateJobStatus(jobId, 'in_progress');
      if (onUpdate) onUpdate({ type: 'job:update', jobId, status: 'in_progress' });

      // process each item and generate a placeholder uploadUrl
      for (const item of rec.items) {
        if (item.status === 'deduplicated' || item.status === 'uploaded') continue;
        const uploadBase = process.env.UPLOAD_BASE || 'https://uploads.example.com/upload';
        const uploadUrl = `${uploadBase}/${item.hash}`;
        await updateJobItem(jobId, item.id, { status: 'url_ready', uploadUrl });
        if (onUpdate) onUpdate({ type: 'job:item:update', jobId, itemId: item.id, hash: item.hash, status: 'url_ready', uploadUrl });
      }

      // mark job completed
      await updateJobStatus(jobId, 'completed');
      if (onUpdate) onUpdate({ type: 'job:update', jobId, status: 'completed' });
      return true;
    },
    { connection }
  );

  worker.on('failed', (job, err) => {
    if (onUpdate) onUpdate({ type: 'job:failed', jobId: job.data && job.data.jobId, error: String(err) });
  });

  return worker;
}

module.exports = { initQueue, enqueueJob, startWorker };
