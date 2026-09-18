import { existsSync } from "node:fs";
import dns from "node:dns";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Load backend/.env into process.env if present. Resolved relative to this
// file (not process.cwd()) so it works the same whether the process was
// started from the repo root, from inside backend/, or as a compiled
// dist/config.js - process.cwd() varies across those, this doesn't.
// Absent in CI/tests, where real env vars either aren't needed (thresholds
// are plain constants) or are always injected explicitly by the caller.
const envFilePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
if (existsSync(envFilePath)) {
  process.loadEnvFile(envFilePath);
}

// Neon hostnames (and Supabase's pooler host) resolve to both an IPv4 and
// an IPv6 address, and Node's default DNS ordering ("verbatim") doesn't
// prefer either. On hosts where outbound IPv6 is broken but DNS still
// returns an AAAA record - WSL2 is a common example - `pg` (which uses
// Node's own DNS resolution) picks the unreachable IPv6 address and fails
// with ENETUNREACH that has nothing to do with the credentials being wrong.
// Forcing IPv4-first avoids that class of failure everywhere, including on
// hosts with working IPv6, where it's a no-op.
//
// This does NOT help Supabase's *direct* db.<ref>.supabase.co host, which
// is IPv6-only (no IPv4 address to prefer) - that one needs the Session
// Pooler connection string instead. See the DATABASE_URL comment below.
dns.setDefaultResultOrder("ipv4first");

// Validation pipeline thresholds. Pure constants — no env/IO — so that
// validation rule unit tests never need to touch process.env at all.
// These are "start with a documented default, tune empirically" values
// per the project spec; see comments on each rule for rationale.
export interface Thresholds {
  minFileSizeBytes: number;
  minWidthPx: number;
  minHeightPx: number;
  blurVarianceMin: number;
  minFaceAreaRatio: number;
  maxSimilarityHammingDistance: number;
}

export const thresholds: Thresholds = {
  minFileSizeBytes: 10 * 1024, // 10KB
  minWidthPx: 400,
  minHeightPx: 400,
  // Laplacian-variance blur threshold. Untuned against real sample images —
  // this is a starting point, not a calibrated value. See validation/blur.ts.
  blurVarianceMin: 100,
  // A single face's bounding-box area must be at least this fraction of the
  // whole image's area, otherwise it's rejected as "face too small".
  minFaceAreaRatio: 0.05,
  // Hamming distance (out of 64 bits) at/below which two pHashes are
  // considered "too similar" and the upload is rejected as a duplicate.
  maxSimilarityHammingDistance: 5,
};

const envSchema = z.object({
  // If using Supabase Postgres: this must be the Session Pooler connection
  // string (Project Settings -> Database -> Connection string -> "Session
  // pooler", host like aws-0-<region>.pooler.supabase.com:5432), not the
  // direct db.<ref>.supabase.co:5432 host. The direct host is IPv6-only, and
  // most hosting platforms (Render included) and WSL2 don't have outbound
  // IPv6, which fails as ENETUNREACH with nothing wrong in the credentials.
  DATABASE_URL: z.string().min(1),
  SUPABASE_S3_ENDPOINT: z.string().min(1),
  SUPABASE_S3_REGION: z.string().min(1).default("us-east-1"),
  SUPABASE_ACCESS_KEY_ID: z.string().min(1),
  SUPABASE_SECRET_ACCESS_KEY: z.string().min(1),
  SUPABASE_BUCKET_NAME: z.string().min(1).default("images"),
  PORT: z.coerce.number().int().positive().default(3000),
  MAX_UPLOAD_SIZE_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  // Frontend and backend are deployed to different origins (Vercel/Render),
  // so the API needs an explicit CORS allow-list. Defaults to "*" for local
  // dev; there are no cookies/credentials in play here, so an open default
  // isn't a meaningful security risk, but production should set this to the
  // real frontend origin.
  FRONTEND_ORIGIN: z.string().min(1).default("*"),
});

// Parsed lazily (not at module load) so importing this file — e.g. from a
// validation-rule unit test that only needs `thresholds` — never requires a
// full environment to be present. Anything that actually needs `env` (the
// HTTP server, the storage client) calls this at startup.
let cached: z.infer<typeof envSchema> | undefined;
export function loadEnv(): z.infer<typeof envSchema> {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
    }
    cached = parsed.data;
  }
  return cached;
}
