# DriveMerge Project (Monorepo)

This repository will contain the DriveMerge MVP: a zero-knowledge distributed storage network that aggregates multiple Google Drive accounts into a single resilient storage layer.

# DriveMerge Project (Monorepo)

DriveMerge is an experimental MVP for a zero-knowledge distributed storage network that aggregates multiple Google Drive accounts into a single, resilient, deduplicated storage layer.

This repository is a working monorepo scaffold for the Proof-of-Concept (PoC) and subsequent MVP development.

High-level goals
- Zero-knowledge: the server never gains access to unencrypted user data or unwrapped encryption keys.
- Client-side encryption (Web Crypto) and client-side chunking/reconstruction.
- Direct-to-cloud uploads using signed (resumable) upload sessions for Google Drive.
- Content-Defined Chunking (CDC), deduplication, Reed-Solomon erasure coding for resilience.
- Real-time per-chunk progress via WebSocket and an animated UI visualizer.

Repository layout
```
/DriveMerge-Project
  /client    -> Next.js frontend + Web Workers (chunking, crypto, transfer)
  /server    -> Node.js API Gateway + WebSocket + job processors (URL generation)
  package.json (monorepo runner)
  README.md (this file)
  .gitignore
```

Current status (PoC scope)
- A minimal monorepo scaffold has been created with placeholder package.json files for `client` and `server`.
- Next steps: implement a PoC (Milestone A) where the client Web Worker performs simple chunking and SHA-256 hashing, posts chunk metadata to the server, and the server replies with a deduplication response and job_ready event over WebSocket.

Security note (IMPORTANT)
- I found OAuth credentials in an attached `.env`. If those are live credentials, rotate them immediately. Never commit or share `CLIENT_SECRET` or other private tokens publicly.
- For production, store secrets in a vault (HashiCorp Vault, AWS Secrets Manager, or environment-protected configs). The server will only store encrypted refresh tokens (encrypted at rest with a server key) and never unwrapped chunk keys.

Quickstart (PoC)
1. Install dependencies (from monorepo root):

```bash
cd "/Users/kammatiaditya/Downloads/DriveMerge 2/DriveMerge-Project"
yarn install
```

2. Start both client & server in development (after the PoC implementation is added):

```bash
yarn dev
```

3. Current PoC plan (what I'll implement next):
- Client: `client/pages/index.tsx` + `client/workers/chunker.worker.ts` (fixed-size chunking for PoC), compute SHA-256 and send hashes to server.
- Server: `server/src/server.ts` will expose `/api/files/create` to accept chunk lists, and a WebSocket server that sends a `job_ready` message describing which chunks need upload vs deduplicated.

Environment variables (example for local dev)
- Create a `.env` file for the server. Example variables used during development:

```properties
# OAuth credentials (do NOT commit)
CLIENT_ID=your-google-client-id.apps.googleusercontent.com
CLIENT_SECRET=your-google-client-secret
REDIRECT_URI=http://localhost:3000/auth/google/callback
PORT=3000

# In production, also configure DATABASE_URL, REDIS_URL, and SERVER_ENCRYPTION_KEY
```

PoC acceptance criteria
- Client can chunk a small sample file and compute SHA-256 hashes without blocking the UI.
- Client POSTs metadata to `/api/files/create` and receives a response listing `deduplicated` vs `needs_upload` chunks.
- WebSocket server broadcasts a `job_ready` message the client can receive.

Next steps I will take (you can watch progress in the todo list):
1. Implement the PoC server (`server/src/server.ts`) and a tiny in-memory Hash store to simulate deduplication.
2. Implement a chunker worker in the client and wire the request/response and WebSocket.
3. Add basic client UI to select a file and kick off the PoC flow.

If you want me to start right away, I will implement the PoC now and run a local test to validate the flow.

Contact & notes
- I will annotate code and add READMEs inside `/client` and `/server` with more detailed run instructions.
- Reminder: rotate OAuth secrets if they are real.

-- DriveMerge PoC scaffold
