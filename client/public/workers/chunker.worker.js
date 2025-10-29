// chunker.worker.js
// PoC Web Worker: fixed-size chunking + SHA-256 hashing

self.addEventListener("message", (ev) => {
  const msg = ev.data || {};
  // handle wrap request: main thread sends masterKey (base64) to wrap the fileKey
  if (msg.type === 'wrapFileKey') {
    handleWrapFileKey(msg.masterKey).catch((err) => {
      self.postMessage({ type: 'error', message: String(err) });
    });
    return;
  }

  if (msg.type === "chunkFile") {
    // Validate file-like object
    const file = msg.file;
    if (
      !file ||
      typeof file.size !== "number" ||
      typeof file.slice !== "function"
    ) {
      self.postMessage({
        type: "error",
        message: "Invalid file provided to chunker.worker",
      });
      return;
    }

    // CDC parameters (defaults)
    const defaults = {
      minChunk: 16 * 1024, // 16KB
      avgChunk: 64 * 1024, // 64KB
      maxChunk: 256 * 1024, // 256KB
      // windowSize not required for gear hash, included for compatibility
      windowSize: 48,
    };

    const cfg = {
      minChunk:
        Number.isFinite(msg.minChunk) && msg.minChunk > 0
          ? Math.floor(msg.minChunk)
          : defaults.minChunk,
      avgChunk:
        Number.isFinite(msg.avgChunk) && msg.avgChunk > 0
          ? Math.floor(msg.avgChunk)
          : defaults.avgChunk,
      maxChunk:
        Number.isFinite(msg.maxChunk) && msg.maxChunk > 0
          ? Math.floor(msg.maxChunk)
          : defaults.maxChunk,
    };

    // Safety: ensure min <= avg <= max
    if (cfg.minChunk > cfg.avgChunk)
      cfg.minChunk = Math.max(1, Math.floor(cfg.avgChunk / 4));
    if (cfg.maxChunk < cfg.avgChunk)
      cfg.maxChunk = Math.max(cfg.avgChunk * 2, cfg.avgChunk + 1);

    processFileCDC(file, cfg);
  }
});

// global holder for the raw file key so we can wrap it later on request
let __fileKeyRaw = null;

// base64 helpers for external messages
function uint8ToBase64(u8) {
  const CHUNK = 0x8000;
  let index = 0;
  let result = '';
  while (index < u8.length) {
    const slice = u8.subarray(index, Math.min(index + CHUNK, u8.length));
    result += String.fromCharCode.apply(null, slice);
    index += CHUNK;
  }
  return btoa(result);
}

function base64ToUint8(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

async function handleWrapFileKey(masterKeyB64) {
  if (!__fileKeyRaw) {
    self.postMessage({ type: 'error', message: 'No fileKey available to wrap' });
    return;
  }
  try {
    const masterRaw = base64ToUint8(masterKeyB64);
    const masterCryptoKey = await crypto.subtle.importKey('raw', masterRaw.buffer, { name: 'AES-GCM' }, false, ['encrypt']);
    const wrapIv = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wrapIv }, masterCryptoKey, __fileKeyRaw.buffer);
    const wrappedB64 = uint8ToBase64(new Uint8Array(wrapped));
    const wrapIvB64 = uint8ToBase64(wrapIv);
    self.postMessage({ type: 'wrappedFileKey', wrappedFileKey: wrappedB64, wrapIv: wrapIvB64 });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err) });
  }
}

// Gear table for fast CDC (256 random 32-bit values). Using fixed constants for determinism.
const GEAR = new Uint32Array([
  0x3a8f13b1,
  0x5c6d7e2f,
  0x1d2a3b4c,
  0x9f8e7d6c,
  0xa1b2c3d4,
  0x0f1e2d3c,
  0x12345678,
  0xabcdef01,
  0x23456789,
  0x3456789a,
  0x456789ab,
  0x56789abc,
  0x6789abcd,
  0x789abcde,
  0x89abcdef,
  0x9abcdef0,
  0x0a0b0c0d,
  0x1a1b1c1d,
  0x2a2b2c2d,
  0x3b3c3d3e,
  0x4c4d4e4f,
  0x5d5e5f60,
  0x6e6f7071,
  0x7f808182,
  0x8f909192,
  0x9fa0a1a2,
  0xafb0b1b2,
  0xbfc0c1c2,
  0xcfd0d1d2,
  0xdfd1d2d3,
  0xefc1c2c3,
  0xffb1b2b3,
  // fill the rest with a simple sequence to reach 256
  ...Array.from({ length: 224 }, (_, i) => (0x11111111 + i) >>> 0),
]);

// CDC using a gear-based rolling hash. Boundaries are chosen when (hash & mask) === 0.
async function processFileCDC(file, cfg) {
  try {
    const fileSize = file.size;
    const avg = cfg.avgChunk;
    const maskBits = Math.max(1, Math.round(Math.log2(avg)));
    const mask = (1 << maskBits) - 1;

    const minChunk = cfg.minChunk;
    const maxChunk = cfg.maxChunk;

  // generate a random file key (raw) and import as CryptoKey for wrapping per-chunk keys
  const fileKeyRaw = crypto.getRandomValues(new Uint8Array(32));
  // keep a raw copy in module scope so the main thread can request it be wrapped
  __fileKeyRaw = fileKeyRaw;
    const fileKey = await crypto.subtle.importKey(
      'raw',
      fileKeyRaw.buffer,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );

    const readerChunk = 256 * 1024; // read in 256KB blocks from the file
    let offset = 0;
    let chunkBufferParts = [];
    let chunkLen = 0;
    let chunkIndex = 0;
    let gearHash = 0;

    // helper: base64 encode Uint8Array
    function uint8ToBase64(u8) {
      const CHUNK = 0x8000;
      let index = 0;
      let result = '';
      while (index < u8.length) {
        const slice = u8.subarray(index, Math.min(index + CHUNK, u8.length));
        result += String.fromCharCode.apply(null, slice);
        index += CHUNK;
      }
      return btoa(result);
    }

    while (offset < fileSize) {
      const end = Math.min(offset + readerChunk, fileSize);
      const slice = file.slice(offset, end);
      const buf = new Uint8Array(await slice.arrayBuffer());

      for (let i = 0; i < buf.length; i++) {
        const b = buf[i];
        // update gear hash
        gearHash = ((gearHash << 1) + GEAR[b]) >>> 0;

        // append byte to current chunk parts
        chunkBufferParts.push(b);
        chunkLen += 1;

        const reachedMin = chunkLen >= minChunk;
        const reachedMax = chunkLen >= maxChunk;

        // cut condition
        if ((reachedMin && (gearHash & mask) === 0) || reachedMax) {
          // assemble chunk
          const chunkBytes = new Uint8Array(chunkLen);
          for (let j = 0; j < chunkLen; j++) chunkBytes[j] = chunkBufferParts[j];

          // compute plaintext hash (SHA-256) for deduplication
          const hashBuffer = await crypto.subtle.digest('SHA-256', chunkBytes.buffer);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const hashHex = hashArray.map((x) => x.toString(16).padStart(2, '0')).join('');

          // generate random per-chunk key and encrypt chunk with AES-GCM
          const chunkKeyRaw = crypto.getRandomValues(new Uint8Array(32));
          const chunkKey = await crypto.subtle.importKey('raw', chunkKeyRaw.buffer, { name: 'AES-GCM' }, false, ['encrypt']);
          const chunkIv = crypto.getRandomValues(new Uint8Array(12));
          const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: chunkIv }, chunkKey, chunkBytes.buffer);

          // wrap (encrypt) the chunkKeyRaw with the fileKey using AES-GCM (wrapIv)
          const wrapIv = crypto.getRandomValues(new Uint8Array(12));
          const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wrapIv }, fileKey, chunkKeyRaw.buffer);

          // base64 encode wrapped key and IVs
          const wrappedB64 = uint8ToBase64(new Uint8Array(wrapped));
          const wrapIvB64 = uint8ToBase64(wrapIv);
          const chunkIvB64 = uint8ToBase64(chunkIv);

          // post progress (bytes processed and approx percent) with encryption metadata
          const bytesProcessed = offset + i + 1;
          const percent = Math.round((bytesProcessed / fileSize) * 100);
          self.postMessage({
            type: 'progress',
            index: chunkIndex,
            hash: hashHex,
            size: chunkLen,
            bytesProcessed,
            percent,
            wrappedChunkKey: wrappedB64,
            wrapIv: wrapIvB64,
            chunkIv: chunkIvB64,
          });

          // reset for next chunk
          chunkIndex += 1;
          chunkBufferParts = [];
          chunkLen = 0;
          gearHash = 0;
        }
      }

      offset = end;
      // yield occasionally to keep worker responsive
      await new Promise((r) => setTimeout(r, 0));
    }

    // final trailing chunk
    if (chunkLen > 0) {
      const chunkBytes = new Uint8Array(chunkLen);
      for (let j = 0; j < chunkLen; j++) chunkBytes[j] = chunkBufferParts[j];
      const hashBuffer = await crypto.subtle.digest('SHA-256', chunkBytes.buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map((x) => x.toString(16).padStart(2, '0')).join('');

      const chunkKeyRaw = crypto.getRandomValues(new Uint8Array(32));
      const chunkKey = await crypto.subtle.importKey('raw', chunkKeyRaw.buffer, { name: 'AES-GCM' }, false, ['encrypt']);
      const chunkIv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: chunkIv }, chunkKey, chunkBytes.buffer);
      const wrapIv = crypto.getRandomValues(new Uint8Array(12));
      const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wrapIv }, fileKey, chunkKeyRaw.buffer);

      const wrappedB64 = uint8ToBase64(new Uint8Array(wrapped));
      const wrapIvB64 = uint8ToBase64(wrapIv);
      const chunkIvB64 = uint8ToBase64(chunkIv);

      const bytesProcessed = fileSize;
      self.postMessage({ type: 'progress', index: chunkIndex, hash: hashHex, size: chunkLen, bytesProcessed, percent: 100, wrappedChunkKey: wrappedB64, wrapIv: wrapIvB64, chunkIv: chunkIvB64 });
      chunkIndex += 1;
    }

    // For compatibility with previous API, client receives progress events and a final done
    self.postMessage({ type: 'done', chunks: { count: chunkIndex } });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err) });
  }
}
