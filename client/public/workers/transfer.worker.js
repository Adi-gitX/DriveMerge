// transfer.worker.js
// Simulated transfer worker for PoC: fakes upload progress for given jobs

self.addEventListener("message", (ev) => {
  const msg = ev.data || {};
  if (msg.type === "uploadJobs") {
    simulateUploads(msg.jobs || []);
  }
});

function simulateUploads(jobs) {
  // jobs: [{ hash, uploadUrl }]
  const uploaded = [];
  let idx = 0;

  function uploadNext() {
    if (idx >= jobs.length) {
      // all done
      self.postMessage({ type: "done", uploaded });
      return;
    }

    const job = jobs[idx];
    let percent = 0;
    const interval = setInterval(() => {
      percent += Math.floor(Math.random() * 15) + 5; // random progress
      if (percent >= 100) percent = 100;
      self.postMessage({ type: "progress", hash: job.hash, percent });
      if (percent === 100) {
        clearInterval(interval);
        uploaded.push(job.hash);
        idx += 1;
        // small delay between chunks
        setTimeout(uploadNext, 200);
      }
    }, 150);
  }

  uploadNext();
}
