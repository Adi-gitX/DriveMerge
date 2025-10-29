# DriveMerge — Server (Local dev & Neon + Prisma setup)

This file documents how to run the PoC server locally and how to enable persistence using Prisma + a PostgreSQL-compatible provider (Neon was used in development).

Contents
- Requirements
- Environment variables
- Quick start (in-memory fallback)
- Enable Prisma + Neon (push schema)
- Optional: run migrations (shadow DB notes)
- Useful commands and debugging

## Requirements
- Node (>= 18 recommended)
- Yarn or npm
- Optional: Docker (if you prefer to run Postgres locally)

## Environment variables
- `DATABASE_URL` — Postgres connection string (used by Prisma). Example (Neon pooling endpoint):
  ```bash
  export DATABASE_URL='postgresql://neondb_owner:SECRET@ep-.../neondb?sslmode=require&channel_binding=require'
  ```
- `DM_JWT_SECRET` — JWT secret for PoC auth (defaults to `drivemerge-dev-secret` if not set).

## Quick start (in-memory fallback — no DB required)
1. Install dependencies:
```bash
cd server
yarn install
```
2. Start the server (uses in-memory stores):
```bash
yarn dev
# or
node src/server.js
```
The server will log that it is running and will indicate that Prisma is not enabled and it is using the in-memory fallback.

## Enable Prisma + Neon (recommended for persistence)
1. Export your Neon `DATABASE_URL` into your shell (wrap in single quotes):
```bash
export DATABASE_URL='postgresql://neondb_owner:YOURPASSWORD@ep-.../neondb?sslmode=require&channel_binding=require'
```
2. (Optional) align Prisma versions (recommended):
```bash
yarn add -D prisma@5.22.0
yarn add @prisma/client@5.22.0
```
3. Push the Prisma schema to the DB (creates tables without migration history):
```bash
npx prisma db push
yarn prisma:generate
```
4. Start the server. The startup logs will show `Prisma client: enabled and connected to database` when successful:
```bash
yarn dev
```

## Notes about `prisma migrate` and Neon
- `prisma migrate dev` creates migration files and applies them but uses a shadow database; some hosted providers (or pooling endpoints) may require a dedicated shadow DB. If `prisma migrate` fails with shadow DB errors on Neon, either:
  - Create a dedicated shadow DB and set `SHADOW_DATABASE_URL` in your environment before running `prisma migrate dev`.
  - Or use `prisma db push` for development (no migration files) and move to proper migrations for production.

## Useful commands
- Generate Prisma client: `yarn prisma:generate` or `npx prisma generate`
- Push schema: `npx prisma db push`
- Run migrations: `yarn prisma:migrate` (may need `SHADOW_DATABASE_URL` for Neon)
- Inspect DB: `npx prisma studio`

## Debugging tips
- If Prisma generator complains "Could not resolve @prisma/client": install `@prisma/client` inside the `server` package (or hoist to your workspace root). Example:
  ```bash
  cd server
  yarn add @prisma/client@5.22.0
  yarn add -D prisma@5.22.0
  ```
- If the server fails to start with `EADDRINUSE: address already in use :::4000`, identify and stop the process or run the server on a different port:
  ```bash
  lsof -t -i :4000 | xargs -r kill
  PORT=4001 node src/server.js
  ```
- If Neon connection fails, ensure the `DATABASE_URL` is correct and that Neon's allowed connection settings are satisfied (Neon pooling endpoint is usually fine). Use `psql` to test connectivity:
  ```bash
  psql '<YOUR_DATABASE_URL>' -c '\dt'
  ```

## Security notes
- Keep `CLIENT_SECRET` and `DATABASE_URL` out of source control. Use environment variables or a secrets manager in CI/CD.
- Rotate Google OAuth client secrets if they have been committed publicly.

## Next steps (suggested)
- Add a staging Prisma migration flow and configure `SHADOW_DATABASE_URL` if you plan to use `prisma migrate` against Neon.
- Replace the in-memory hash/file stores with the Prisma-backed implementations (done in the PoC code; enable Prisma to persist data).
- Add integration tests that run against a throwaway Neon DB or a local Postgres instance.
# DriveMerge - Server (PoC)

This folder contains the API Gateway and WebSocket server for the DriveMerge PoC. The server's PoC responsibilities:

- Expose `/api/files/create` to accept a list of chunk SHA-256 hashes and metadata for a new file.
- Maintain a small in-memory or SQLite-backed `Hashes` store to determine deduplication for PoC.
- Host a WebSocket server that broadcasts `job_ready` messages and per-chunk progress events to connected clients.
- In later milestones, act as the coordinator that queues URL generation jobs, manages per-account BullMQ queues, and handles circuit-breaker state in Redis.

Quickstart (server)

1. From monorepo root, install dependencies for the server:

```bash
cd "/Users/kammatiaditya/Downloads/DriveMerge 2/DriveMerge-Project"
yarn workspace server install
```

2. Start the server (PoC implementation will add `src/server.ts`):

```bash
cd server
yarn dev
```

Environment variables (local dev)

- Create `server/.env` (DO NOT commit this file):

```properties
CLIENT_ID=your-google-client-id.apps.googleusercontent.com
CLIENT_SECRET=your-google-client-secret
REDIRECT_URI=http://localhost:3000/auth/google/callback
PORT=3000
# In production add DATABASE_URL, REDIS_URL, and SERVER_ENCRYPTION_KEY
```

PoC details

- For the PoC we will start with a small in-memory Hash map to represent the `Hashes` table. This avoids DB setup for the first demo and makes iteration faster.
- The server will respond to `/api/files/create` with a JSON payload that contains for each chunk either `deduplicated: true` or `needs_upload: true`. For `needs_upload` chunks the server will (in PoC) return a placeholder signed URL. Later this will be replaced by real Google Drive resumable upload sessions generated by a background job.

Next work items for server

- Create `src/server.ts` with Express + WS server and a `/api/files/create` endpoint.
- Add a small `src/db/simpleHashes.ts` to simulate persistence and refCount logic.
- Later: integrate PostgreSQL (Prisma), Redis (BullMQ), and Google Drive signed URL generation.

Security and secrets

- Do not commit `CLIENT_SECRET` to source control. Rotate any secret keys if you believe they were exposed.
- Server will only store encrypted refresh tokens for linked Google accounts. It will never receive raw chunk plaintext or unwrapped chunk keys.

Contact

- See top-level README for overall project direction, PoC acceptance criteria and next milestones.
