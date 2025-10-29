# DriveMerge - Client (PoC)

This folder contains the experimental Next.js client for DriveMerge. For the PoC, the client will provide:

- A minimal UI to pick a file and start the PoC upload flow.
- A Web Worker (`workers/chunker.worker.ts`) that performs fixed-size chunking (PoC), computes SHA-256 per chunk, and returns a list of chunk hashes and chunk blobs to the main thread.
- A simple transfer worker (later) to stream encrypted chunk data to signed upload URLs.
- A WebSocket client to receive `job_ready` and progress events from the server.

Why a worker?

- All CPU-heavy tasks (hashing, chunking, encryption) must run off the main thread to avoid freezing the UI. Web Workers are the mechanism for this in the browser.

Quickstart (client)

1. From monorepo root:

```bash
cd "/Users/kammatiaditya/Downloads/DriveMerge 2/DriveMerge-Project"
yarn workspace client install
```

2. Run the client dev server (after dependencies are installed):

```bash
cd client
yarn dev
```

PoC file flow (what to expect)

1. User selects a file in the browser.
2. The main thread posts the `File` to the `chunker.worker`.
3. The worker emits per-chunk messages with `hash` and chunk blob references.
4. The client POSTs the list of hashes to `/api/files/create`.
5. Server responds with which chunks are "deduplicated" vs "needs_upload" and provides signed URLs for missing chunks (in the final implementation).
6. The client passes upload jobs to the transfer worker which performs direct PUTs to the signed URLs and emits progress back to the server via WebSocket.

Notes

- For the PoC we use fixed-size chunking (simpler). CDC (Rabin-Karp) will be implemented after the PoC once the flow is proven working.
- Real crypto (Argon2id, AES-GCM) and Reed-Solomon will be integrated using WASM libraries in a later step.
 - Real crypto (Argon2id, AES-GCM) and Reed-Solomon are being integrated using WASM libraries. The PoC now attempts to use Argon2id (via `argon2-browser`) in a dedicated `crypto.worker.js` and falls back to PBKDF2 when Argon2 isn't available.

Files to be added next

- `pages/index.tsx` (UI + wiring to workers)
- `workers/chunker.worker.ts` (chunking & hashing)
- `workers/transfer.worker.ts` (upload & progress)
- `hooks/useWebSocket.ts` (WS management)

Note: the current PoC files use plain JavaScript under `public/workers/*.js` and `pages/index.js`.

Security

- The client will derive the Master Key from the user's password using Argon2id in the browser and never send the password or derived key to the server.

Argon2id integration (current)

- The client includes `client/public/workers/crypto.worker.js` which attempts to dynamically import `argon2-browser` and run Argon2id in WASM. If the import or WASM execution fails (environments where WASM can't load), the worker falls back to PBKDF2.
- Default Argon2 parameters used: time=3, memory=64MiB (65536 KiB), parallelism=1, hashLen=32. These are configurable in the worker call.

Install and run (quick):

1. From monorepo root, install workspace deps:

```bash
yarn install
```

2. Or install client deps directly and ensure `argon2-browser` is present:

```bash
cd client
yarn add argon2-browser
yarn install
```

3. Run the client dev server:

```bash
cd client
yarn dev
```

Test the KDF flow in the UI

- Open http://localhost:3000 in your browser.
- Enter a password in the password field and select a file.
- Open DevTools console/network to observe the `crypto.worker` derived message (it will emit a `{ type: 'derived', algo: 'argon2id' }` message when Argon2 is used, otherwise `algo: 'PBKDF2'`).

Security note

- PBKDF2 is only a fallback. For production, Argon2id (WASM) is recommended. We should review parameters (time/memory) across target client devices and potentially provide adaptive defaults or offline instructions for stronger parameters on powerful devices.

Contact

- See top-level README for overarching project notes and PoC acceptance criteria.
