# Image Upload & Validation App

A full-stack app where users upload images that get automatically categorized
into **Accepted** or **Rejected** by a server-side validation pipeline
(format, size, blur, face detection, duplicate detection).

## Stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript + Tailwind CSS |
| Backend | Hono (Node runtime) |
| Database | PostgreSQL (Neon or Supabase in production; PGlite for local dev/tests) |
| ORM | Drizzle ORM |
| Object storage | Supabase Storage (S3-compatible API), private bucket |
| Image processing | `sharp`, `heic-convert` |
| Face detection | `@vladmandic/face-api` (WASM backend, runs locally) |
| Perceptual hashing | `blockhash-core` |
| Testing | Vitest + Testing Library |

## Repo layout

```
backend/    Hono API, validation pipeline, Drizzle schema/migrations
frontend/   React + Vite app
```

Both are npm workspaces under the root `package.json`.

## Setup

Requires Node 22+.

```bash
npm install
```

### Run without any external accounts (recommended for a first look)

The backend can run entirely locally — no Neon, no Supabase, no env vars —
using an embedded Postgres (PGlite) and an in-memory storage stand-in. The
real validation pipeline (sharp, HEIC conversion, face-api, phash) runs
exactly as it would in production; only the database and object storage are
swapped for local equivalents.

```bash
npm run dev:local --workspace backend   # http://localhost:3000
npm run dev --workspace frontend        # http://localhost:5173
```

Data doesn't persist across restarts in this mode — that's the point, it's a
zero-setup way to try the app.

### Run against a real database + Supabase Storage

1. Copy the env files and fill in real values:
   ```bash
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env
   ```
2. Create a Postgres database — either a [Neon](https://neon.tech) project,
   or Supabase's own Postgres (Project Settings -> Database) — and set
   `DATABASE_URL` in `backend/.env`.
   > **If using Supabase Postgres:** use the **Session pooler** connection
   > string, not the direct `db.<project-ref>.supabase.co` host. The direct
   > host is IPv6-only, and most hosts (Render, WSL2, many CI runners) have
   > no outbound IPv6, which fails with `ENETUNREACH`-style errors that
   > look like bad credentials but aren't. The pooler host
   > (`aws-0-<region>.pooler.supabase.com:5432`) is IPv4-reachable.
3. Create a private [Supabase Storage](https://supabase.com/storage) bucket
   and set the `SUPABASE_*` vars in `backend/.env`.
4. Apply migrations: `npm run db:migrate --workspace backend`.
5. Start both apps:
   ```bash
   npm run dev:backend
   npm run dev:frontend
   ```

## Testing

```bash
npm test --workspace backend    # unit + integration (Vitest)
npm test --workspace frontend   # component tests (Vitest + Testing Library)
```

Backend integration tests need no external services or secrets: they run
against [PGlite](https://github.com/electric-sql/pglite) (an embedded,
WASM-compiled Postgres) applying the real migration SQL, and against an
in-memory fake storage client instead of real Supabase Storage. This is a
deliberate substitution for the Docker/testcontainers approach the spec
suggested — this sandbox's Docker daemon wasn't reachable from WSL, and
PGlite gives an equivalent guarantee (real Postgres semantics, a disposable
database per test file) with zero external dependency, which also means CI
needs no database secrets at all.

Face-detection fixtures (`no-face.jpg`, `one-face.jpg`, etc.) are
synthetic drawings, not real photographs — shipping real photos of people in
a public test-fixture directory raises consent/licensing concerns this
project doesn't need to take on. The face-detection *decision logic*
(`evaluateFaces` — "too small" / "multiple faces") is fully unit-tested
against literal bounding boxes; the ML wrapper itself (`detectFaces`) has a
smoke test that it runs without throwing, not an accuracy claim. See the
comments in `backend/scripts/generate-fixtures.mjs` and
`backend/test/unit/faceDetection.test.ts` for the full reasoning. Similarly,
no real `.heic` sample ships in the repo — sharp's prebuilt binaries don't
include an HEIC encoder (patent-encumbered, excluded from the default
build) — so the HEIC branch is tested by mocking format detection and
conversion, per the comments in `backend/test/unit/heicConversion.test.ts`.

## Known tradeoffs

- **In-process background task instead of a real job queue** (Redis/BullMQ/
  SQS). An upload's validation runs as a fire-and-forget async function in
  the same process, not a durable queue — chosen to avoid needing a second
  always-on service on free hosting tiers (Render's free tier spins down).
  The real cost: a job in flight when the server restarts or redeploys is
  silently lost (the row stays `pending` forever). A real queue would
  survive that. See `backend/src/jobs/processUpload.ts`.
- **O(n) pHash comparison** against every accepted row's hash, for the
  similarity check. Fine at demo scale; a real system would bucket hashes
  (LSH) or use a vector index instead of a linear Hamming-distance scan. The
  comparison is deliberately isolated in `backend/src/validation/
  similarity.ts` so it's swappable later without touching call sites.
- **Local WASM face detection instead of a cloud vision API.** No cost, no
  external network dependency, but a lower accuracy ceiling than something
  like AWS Rekognition or Azure Face. We also use `@vladmandic/face-api`'s
  WASM backend rather than `tfjs-node` specifically to avoid a native-addon
  compile/download step — slower inference, but it installs and runs
  identically on any host (including Render's free tier).
- **Polling instead of WebSockets/SSE** for upload status updates. Simpler
  and more resilient to a free-tier connection dropping mid-request, at the
  cost of a little latency and some wasted requests every 1.5s while an
  image is pending.
- **Cursor pagination** on `GET /images`, keyed on `(createdAt, id)` rather
  than offset — stays correct under concurrent inserts and avoids Postgres
  scanning-and-discarding rows for a large `OFFSET`. Offset pagination would
  have been simpler to write and is arguably fine at this scale; cursor was
  chosen to demonstrate the tradeoff is understood, not because it was
  strictly necessary here.
- **No auth / rate limiting.** Out of scope for the spec's scope, but would
  be needed before this could be a public-facing service — noted rather than
  silently ignored. Rate limiting on `POST /images` in particular would be a
  first addition given more time.
- **CORS is wide open by default** (`FRONTEND_ORIGIN=*`). There are no
  cookies or credentials involved anywhere in this app, so an open default
  isn't a meaningful security hole, but a real deployment should set
  `FRONTEND_ORIGIN` to the actual frontend origin.

## Deployment

- **Frontend → Vercel.** Root directory `frontend/`, framework preset Vite.
  Set `VITE_API_BASE_URL` to the deployed backend's URL.
- **Backend → Render** (free tier web service). Root directory `backend/`,
  build command `npm install --include=dev && npm run build`, start command
  `npm start`. Set the env vars from `backend/.env.example` (`FRONTEND_ORIGIN`
  to the deployed frontend's URL — don't set `PORT`, Render injects its own)
  plus run `npm run db:migrate` once against the production `DATABASE_URL`
  before first use.
- **Database → Neon or Supabase Postgres.** If using Supabase, use the
  **Session pooler** connection string for `DATABASE_URL` — Render (like
  most hosts) has no outbound IPv6, and Supabase's direct connection host is
  IPv6-only. See the note in [Setup](#run-against-a-real-database--supabase-storage).
- **Storage → Supabase Storage** (private bucket).

Because the free tiers of Render/Neon/Supabase can cold-start or spin down,
the first request after idling may be slow — this is a known property of the
hosting choice, not a bug in the app.
