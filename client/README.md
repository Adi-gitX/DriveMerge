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

Files to be added next

- `pages/index.tsx` (UI + wiring to workers)
- `workers/chunker.worker.ts` (chunking & hashing)
- `workers/transfer.worker.ts` (upload & progress)
- `hooks/useWebSocket.ts` (WS management)

Security

- The client will derive the Master Key from the user's password using Argon2id in the browser and never send the password or derived key to the server.

Contact

- See top-level README for overarching project notes and PoC acceptance criteria.
