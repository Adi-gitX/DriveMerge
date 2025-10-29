// crypto.worker.js
// Lightweight worker to derive a Master Key from a user password.
// NOTE: This implementation uses PBKDF2 as a secure fallback. For production
// we should replace this with Argon2id (WASM) for stronger resistance against
// GPU/ASIC attacks. The worker exposes a simple derive API.

self.addEventListener('message', async (ev) => {
  const msg = ev.data || {};
  if (msg.type === 'derive') {
    const password = msg.password || '';
    // Try Argon2id (WASM) via argon2-browser first, fallback to PBKDF2
    try {
      let usedAlgo = null;
      // dynamic import of argon2-browser (it will load WASM under the hood)
      let argon2 = null;
      try {
        argon2 = await import('argon2-browser');
      } catch (e) {
        argon2 = null;
      }

      if (argon2 && argon2.hash) {
        // Prepare salt (16 bytes)
        const saltU8 = msg.salt ? base64ToUint8(msg.salt) : crypto.getRandomValues(new Uint8Array(16));
        // argon2-browser accepts salt as string; convert to base64 string
        const saltB64 = uint8ToBase64(saltU8);
        const time = Number.isFinite(msg.time) ? msg.time : 3; // iterations
        const mem = Number.isFinite(msg.mem) ? msg.mem : 65536; // KiB (64 MiB)
        const parallelism = Number.isFinite(msg.parallelism) ? msg.parallelism : 1;
        const res = await argon2.hash({ pass: password, salt: saltB64, time, mem, parallelism, hashLen: 32, type: argon2.ArgonType.Argon2id });
        // res.hashHex contains hex string of the raw hash
        const masterKey = hexToUint8(res.hashHex);
        self.postMessage({ type: 'derived', masterKey: uint8ToBase64(masterKey), salt: uint8ToBase64(saltU8), algo: 'argon2id' });
        usedAlgo = 'argon2id';
      } else {
        // PBKDF2 fallback
        const iterations = Number.isFinite(msg.iterations) ? msg.iterations : 250000;
        const enc = new TextEncoder();
        const pwKey = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
        const salt = msg.salt ? base64ToUint8(msg.salt) : crypto.getRandomValues(new Uint8Array(16));
        const derivedBits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, pwKey, 256);
        const masterKey = new Uint8Array(derivedBits); // 32 bytes
        self.postMessage({ type: 'derived', masterKey: uint8ToBase64(masterKey), salt: uint8ToBase64(salt), algo: 'PBKDF2' });
        usedAlgo = 'pbkdf2';
      }
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err) });
    }
  }
});

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

// Future: attempt to load Argon2 WASM and expose it here instead of PBKDF2.

function hexToUint8(hex) {
  if (!hex) return new Uint8Array(0);
  const u8 = new Uint8Array(hex.length / 2);
  for (let i = 0; i < u8.length; i++) u8[i] = parseInt(hex.substr(i * 2, 2), 16);
  return u8;
}
