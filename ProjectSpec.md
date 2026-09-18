# Image Upload & Validation App — Build Spec

This document is the source of truth for building this project. It captures the
requirements, architecture decisions already made, and what "done" looks like,
including tests. Follow it in order — sections are sequenced roughly the way the
project should be built.

---

## 1. Project Overview

A full-stack app where users upload images that get automatically categorized into
**Accepted** or **Rejected** based on a server-side validation pipeline (format,
size, blur, face detection, duplicate detection). Built as an interview take-home,
so code should be clean, well-organized, and defensible in a technical discussion —
not over-engineered, but not naive either. Where a real production system would do
something more robust than what we're doing here (e.g. a real job queue instead of
in-process background tasks), **say so in a code comment**, don't silently pretend
it's the final answer.

### Non-negotiables
- TypeScript everywhere (frontend and backend).
- Every validation rule must be independently unit-testable (pure functions where
  possible, decoupled from HTTP/DB/storage).
- No secrets committed to git. `.env.example` files with placeholder values only.

---

## 2. Tech Stack (final)

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript + Tailwind CSS |
| Frontend hosting | Vercel |
| Backend framework | Hono (Node runtime) |
| Backend hosting | Render (free tier) |
| Database | PostgreSQL, hosted on Neon (free tier) |
| ORM | Drizzle ORM + drizzle-kit for migrations |
| Object storage | Supabase Storage (S3-compatible API), private bucket |
| Image processing | `sharp` (resize/metadata/blur), `heic-convert` (HEIC→JPEG) |
| Face detection | `@vladmandic/face-api` (runs locally, no external API/cost) |
| Perceptual hashing | `sharp-phash` or `blockhash-core` (pick one, document choice) |
| Testing | Vitest (unit + integration, both frontend and backend), Testing Library (React) |
| CI | GitHub Actions |

### Explicitly rejected / out of scope (and why — be ready to explain these)
- **AWS S3 / Rekognition** — avoided to keep this card-free and avoid AWS account
  setup friction; Supabase Storage's S3-compatible API demonstrates the same
  integration pattern.
- **Redis + BullMQ real job queue** — real async processing is demonstrated via
  an in-process background task pattern (see §5) instead, to avoid needing a
  second always-on service on a free tier that spins down. Note this tradeoff in
  code comments near the job-processing code.
- **Cloud vision API for faces** — local model chosen for zero cost / no external
  network dependency; accuracy is "good enough for a demo," not production-grade,
  and that's fine here.

---

## 3. Architecture Overview

```
[React/Vite frontend] --HTTP--> [Hono API on Render] --> [Neon Postgres]
                                        |
                                        v
                              [Supabase Storage (S3 API)]
                                        |
                                        v
                         [Validation pipeline: sharp, heic-convert,
                          face-api, phash — runs as background task]
```

**Upload flow:**
1. Client validates file extension/MIME client-side (UX only, not trusted).
2. Client POSTs file to `POST /images`.
3. Server validates magic bytes, creates a DB row with `status: "pending"`,
   uploads the *original* file to a temp/staging location in storage, and
   returns `{ id, status: "pending" }` immediately (HTTP 202).
4. Server kicks off validation as a non-blocking background task (do not
   `await` it in the request handler — fire it and let the handler return).
5. Background task runs the validation pipeline in order (see §6), updates the
   DB row with final `status` (`accepted`/`rejected`), `rejection_reasons`,
   and computed metadata (width, height, phash, face_count, blur_score).
   On accept, the (possibly HEIC→JPEG converted) processed file is moved to
   its permanent storage key; on reject, keep or delete per your judgement
   (deleting is cleaner for storage limits — note the choice in a comment).
6. Client polls `GET /images/:id` (or a batch `GET /images?ids=...`) every
   1–2s until status leaves `pending`, then displays the result.

---

## 4. Environment Variables

Create `.env.example` in both `frontend/` and `backend/` with these keys
(values as placeholders, real values go in untracked `.env`):

**backend/.env.example**
```
DATABASE_URL=postgres://user:password@host/db?sslmode=require
DATABASE_URL_UNPOOLED=postgres://user:password@host/db?sslmode=require
SUPABASE_S3_ENDPOINT=https://<project-ref>.supabase.co/storage/v1/s3
SUPABASE_S3_REGION=us-east-1
SUPABASE_ACCESS_KEY_ID=
SUPABASE_SECRET_ACCESS_KEY=
SUPABASE_BUCKET_NAME=images
PORT=3000
MAX_UPLOAD_SIZE_BYTES=10485760
```

**frontend/.env.example**
```
VITE_API_BASE_URL=http://localhost:3000
```

---

## 5. Database Schema (Drizzle)

```ts
// backend/src/db/schema.ts
import { pgTable, uuid, text, integer, bigint, jsonb, timestamp, real, pgEnum } from "drizzle-orm/pg-core";

export const imageStatusEnum = pgEnum("image_status", ["pending", "accepted", "rejected"]);

export const images = pgTable("images", {
  id: uuid("id").defaultRandom().primaryKey(),
  originalFilename: text("original_filename").notNull(),
  storageKey: text("storage_key"),              // null until finalized
  mimeType: text("mime_type").notNull(),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }).notNull(),
  width: integer("width"),
  height: integer("height"),
  status: imageStatusEnum("status").notNull().default("pending"),
  rejectionReasons: jsonb("rejection_reasons").$type<string[]>().default([]),
  phash: text("phash"),
  faceCount: integer("face_count"),
  blurScore: real("blur_score"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

Index `phash` (btree on text is fine for exact/prefix lookups; note in a comment
that at real scale you'd want an LSH/bucketing strategy instead of O(n) Hamming
distance comparison against every row — implement the straightforward O(n) version
for now, but write the comparison as an isolated function so it's swappable later).

---

## 6. Validation Pipeline (in order — cheap checks first, fail fast)

Implement each rule as an isolated, independently testable pure function that
takes a decoded image buffer/metadata and returns `{ pass: boolean, reason?: string }`
or similar. The pipeline orchestrator composes them and short-circuits appropriately
(format check must pass before anything else can run).

1. **Format check** — validate via magic bytes (use the `file-type` package),
   not extension or client MIME. Accept: JPEG, PNG, HEIC only.
2. **HEIC conversion** — if HEIC, convert to JPEG via `heic-convert` before any
   further processing. Everything downstream operates on the converted buffer.
3. **Resolution/size check** — reject if file size or width/height falls below
   a threshold. Suggested defaults (put these in a `config.ts`, make them easy
   to tune): min file size `10KB`, min dimensions `400x400px`.
4. **Blur check** — grayscale + Laplacian variance via `sharp`'s convolution
   kernel; reject below a variance threshold. This threshold needs empirical
   tuning — start with a documented default (e.g. `100`) and note in a comment
   that it should be calibrated against real sample images.
5. **Face detection** — run `@vladmandic/face-api`. Reject if `faces.length === 0`
   is *not* itself a rejection rule per the spec (re-check: the given rules are
   "face too small" and "multiple faces" — a zero-face image isn't explicitly
   listed as a rejection reason, so don't invent one; only reject on the two
   stated conditions). Reject if `faces.length > 1`. Reject if the single face's
   bounding box area is below a threshold relative to image area (suggested
   default: face bbox area < 5% of total image area).
6. **Similarity check** — compute pHash of the processed image, compare (Hamming
   distance) against `phash` of all existing `accepted` rows. Reject if distance
   is below a threshold (suggested default: ≤5 out of 64 bits = "too similar").

Store every computed value (even for rejected images) so the DB row is useful
for debugging/demo purposes.

---

## 7. API Endpoints

RESTful, JSON. Suggested minimum surface:

| Method | Path | Purpose |
|---|---|---|
| POST | `/images` | Upload one image (multipart/form-data). Returns `{id, status: "pending"}`, HTTP 202. |
| GET | `/images/:id` | Get one image's current status/metadata. |
| GET | `/images?status=&limit=&cursor=` | List images, filterable by status, paginated. |
| DELETE | `/images/:id` | Delete an image (DB row + storage object). |
| GET | `/images/:id/file` | Stream/redirect to the actual image (signed URL from Supabase, or proxy). |

Keep pagination cursor-based (not offset) if you want to demonstrate query
optimization awareness — offset pagination is fine too for this scope, just be
ready to explain the tradeoff.

---

## 8. Frontend Requirements

- File picker (drag-and-drop + click-to-browse), client-side extension/MIME
  pre-check before upload (UX only — server is the source of truth).
- Upload state managed via React hooks (`useState`/`useReducer`, or a small
  custom hook like `useImageUpload()` — no need for Redux/Zustand at this scale,
  but a custom hook keeps components clean).
- Real-time-ish feedback: each uploaded file shows a spinner/"processing" state,
  then transitions to Accepted/Rejected with the rejection reason(s) shown if
  rejected. Implement via polling (see §3).
- Image previews: use `URL.createObjectURL()` for the immediate local preview
  before the server responds; swap to the server-hosted image once available.
- Two clearly separated sections/tabs: **Accepted** and **Rejected**.
- Tailwind for styling — keep it clean and simple, this isn't a design exercise.

---

## 9. Security Requirements

- Server-side magic-byte validation (never trust client-supplied MIME type or
  file extension).
- Server-side file size cap enforced independently of the frontend's check.
- Randomized storage keys (e.g. `uuid + extension`), never use the user-supplied
  filename as the storage key (path traversal / collision risk). Original
  filename is stored as metadata only.
- Strip EXIF metadata from the final stored image (also relevant to correctness:
  EXIF orientation can misrepresent actual pixel dimensions during the
  resolution check — normalize orientation before checking dimensions).
- Private storage bucket; serve files via signed URLs or a backend proxy route,
  not public bucket URLs.
- Basic rate limiting on `POST /images` if time allows (not a hard requirement,
  mention as a "would add with more time" if skipped).

---

## 10. Testing Requirements (mandatory — don't skip this)

Use **Vitest** for both frontend and backend to keep tooling consistent.

### Backend unit tests
Each validation rule function gets its own test file with fixture images under
`backend/test/fixtures/`:
- `too-small.png`, `valid-large.jpg`
- `blurry.jpg`, `sharp.jpg`
- `no-face.jpg`, `one-face.jpg`, `multiple-faces.jpg`, `tiny-face.jpg`
- A near-duplicate pair for the similarity check
- A `.heic` sample for conversion testing
- A file with a `.png` extension but JPEG magic bytes (to test format-spoofing rejection)

Test the pipeline orchestrator separately from individual rules (mock the rule
functions to verify short-circuit/ordering behavior without needing real images).

### Backend integration tests
Use Hono's built-in `app.request()` test helper (no need for supertest) against
a test database (a separate Neon branch or a local Postgres via Docker/testcontainers
— pick whichever is simpler to set up and document the choice) and a mocked
storage client (don't hit real Supabase Storage in CI). Cover:
- Upload → poll → eventually `accepted` or `rejected` (may need to await the
  background task directly in tests rather than actually polling, since tests
  shouldn't sleep — expose the pipeline function so tests can call it synchronously)
- Rejected-format upload returns appropriate error
- `GET /images/:id` for a nonexistent id returns 404
- Pagination/filtering on `GET /images`

### Frontend tests
Testing Library + Vitest:
- Upload component renders and accepts a file
- Client-side format rejection shows the right message for a disallowed extension
- Status polling transitions a card from "processing" → "accepted"/"rejected" UI state
  (mock the API client)

### CI pipeline (GitHub Actions)
Add `.github/workflows/ci.yml` that runs on every push/PR:
- Install deps (frontend + backend, or a single workspace install if using a
  monorepo tool)
- Lint (ESLint/TS check) both packages
- Run backend unit + integration tests
- Run frontend tests
- Build both packages (`tsc`/`vite build`) to catch type errors that tests might miss

Fail the workflow on any step failure. This is a real requirement, not optional —
have it in place before considering the project "done."

---

## 11. Suggested Repo Structure

```
/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/            # useImageUpload, etc.
│   │   ├── api/               # API client functions
│   │   └── types/
│   ├── .env.example
│   └── vite.config.ts
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   ├── validation/        # one file per rule + orchestrator
│   │   ├── db/                # schema.ts, migrations/
│   │   ├── storage/           # Supabase S3 client wrapper
│   │   └── config.ts          # thresholds, env parsing
│   ├── test/
│   │   ├── fixtures/
│   │   ├── unit/
│   │   └── integration/
│   ├── .env.example
│   └── drizzle.config.ts
├── .github/workflows/ci.yml
└── PROJECT_SPEC.md            # this file
```

---

## 12. Build Order

1. Backend: DB schema + Drizzle migrations against Neon. Verify connection works.
2. Backend: storage wrapper (upload/get/delete against Supabase Storage), test
   against the real bucket manually once.
3. Backend: validation rule functions + unit tests, fixture images included.
   Get this fully green before touching HTTP routes.
4. Backend: pipeline orchestrator + its own tests.
5. Backend: Hono routes wired to DB + storage + pipeline. Integration tests.
6. CI pipeline set up and green.
7. Frontend: upload UI, hooks, polling, preview, accepted/rejected sections.
8. Frontend tests.
9. Deploy: backend → Render, frontend → Vercel. Wire real env vars in both
   dashboards. Smoke-test the deployed version end-to-end.
10. README pass: document setup, env vars, how to run tests, architecture
    tradeoffs (especially the in-process-background-task-instead-of-a-queue
    decision — be ready to talk about this in the interview).

---

## 13. Known Tradeoffs to Be Ready to Discuss

- In-process background task instead of a real job queue (Redis/BullMQ/SQS) —
  chosen to avoid a second always-on service on free hosting tiers; would not
  survive a server restart mid-job in production, a real queue would.
- O(n) pHash comparison against all accepted images — fine at demo scale,
  would need bucketing/LSH or a vector index at real scale.
- Local JS face detection model instead of a cloud vision API — no cost, no
  external dependency, but lower accuracy ceiling than AWS Rekognition/Azure Face.
- Polling instead of WebSockets/SSE for status updates — simpler and more
  resilient to free-tier connection drops, at the cost of slight latency and
  some wasted requests.