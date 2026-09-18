import { describe, it, expect, afterEach } from "vitest";
import type { Hono } from "hono";
import { buildTestApp } from "../helpers/testApp.js";
import { readFixture } from "../helpers/fixtures.js";

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function uploadFixture(app: Hono, filename: string, mime: string) {
  const bytes = await readFixture(filename);
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], filename, { type: mime }));
  return app.request("/images", { method: "POST", body: form });
}

// Hono's Response#json() is typed as Promise<unknown> for safety; these
// tests know the shape they expect back, so assert it once here instead of
// casting at every call site.
function json<T = any>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}

describe("POST /images + GET /images/:id", () => {
  it("accepts a valid large image, processes it in the background, and it ends up accepted", async () => {
    const test = await buildTestApp();
    cleanup = test.close;

    const res = await uploadFixture(test.app, "sharp.jpg", "image/jpeg");
    expect(res.status).toBe(202);
    const body = await json<{ id: string; status: string }>(res);
    expect(body.status).toBe("pending");
    expect(body.id).toBeTruthy();

    await test.flushBackgroundJobs();

    const getRes = await test.app.request(`/images/${body.id}`);
    expect(getRes.status).toBe(200);
    const image = await json<any>(getRes);
    expect(image.status).toBe("accepted");
    expect(image.width).toBe(800);
    expect(image.height).toBe(800);
    expect(typeof image.phash).toBe("string");
  });

  it("rejects a too-small image and records the rejection reason", async () => {
    const test = await buildTestApp();
    cleanup = test.close;

    const res = await uploadFixture(test.app, "too-small.png", "image/png");
    expect(res.status).toBe(202);
    const { id } = await json<{ id: string }>(res);

    await test.flushBackgroundJobs();

    const image = await json<any>(await test.app.request(`/images/${id}`));
    expect(image.status).toBe("rejected");
    expect(image.rejectionReasons.length).toBeGreaterThan(0);
    expect(image.rejectionReasons.some((r: string) => /dimensions|file size/i.test(r))).toBe(true);
  });

  it("deletes the staging object once processing finishes, whether accepted or rejected", async () => {
    const test = await buildTestApp();
    cleanup = test.close;

    const res = await uploadFixture(test.app, "too-small.png", "image/png");
    const { id } = await json<{ id: string }>(res);
    await test.flushBackgroundJobs();

    // Rejected images have no permanent storage key, and the staging copy
    // (keyed under "staging/...") should have been cleaned up.
    const image = await json<any>(await test.app.request(`/images/${id}`));
    expect(image.storageKey).toBeFalsy();
    const stagingKeys = [...(test.storage as any).objects.keys()].filter((k: string) => k.startsWith("staging/"));
    expect(stagingKeys).toHaveLength(0);
  });

  it("rejects an unrecognized format synchronously, before creating any DB row", async () => {
    const test = await buildTestApp();
    cleanup = test.close;

    const res = await uploadFixture(test.app, "not-actually-an-image.jpg", "image/jpeg");
    expect(res.status).toBe(400);
    const body = await json<{ error: string }>(res);
    expect(body.error).toBeTruthy();

    const list = await json<{ items: unknown[] }>(await test.app.request("/images"));
    expect(list.items).toHaveLength(0);
  });

  it("returns 404 for a nonexistent image id", async () => {
    const test = await buildTestApp();
    cleanup = test.close;

    const res = await test.app.request("/images/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });
});

describe("GET /images pagination and filtering", () => {
  it("filters by status", async () => {
    const test = await buildTestApp();
    cleanup = test.close;

    await uploadFixture(test.app, "sharp.jpg", "image/jpeg");
    await uploadFixture(test.app, "too-small.png", "image/png");
    await test.flushBackgroundJobs();

    const accepted = await json<any>(await test.app.request("/images?status=accepted"));
    const rejected = await json<any>(await test.app.request("/images?status=rejected"));
    expect(accepted.items).toHaveLength(1);
    expect(rejected.items).toHaveLength(1);
    expect(accepted.items[0].status).toBe("accepted");
    expect(rejected.items[0].status).toBe("rejected");
  });

  it("paginates with a cursor, returning every item exactly once across pages", async () => {
    const test = await buildTestApp();
    cleanup = test.close;

    for (let i = 0; i < 5; i++) {
      await uploadFixture(test.app, "sharp.jpg", "image/jpeg");
    }
    await test.flushBackgroundJobs();

    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = cursor ? `/images?limit=2&cursor=${encodeURIComponent(cursor)}` : "/images?limit=2";
      const page: { items: { id: string }[]; nextCursor: string | null } = await json(await test.app.request(url));
      for (const item of page.items) seen.add(item.id);
      cursor = page.nextCursor;
      pages++;
      expect(pages).toBeLessThan(10); // guard against an infinite loop bug
    } while (cursor);

    expect(seen.size).toBe(5);
  });

  it("rejects an invalid status filter", async () => {
    const test = await buildTestApp();
    cleanup = test.close;

    const res = await test.app.request("/images?status=bogus");
    expect(res.status).toBe(400);
  });
});

describe("DELETE /images/:id", () => {
  it("deletes the DB row and the stored object", async () => {
    const test = await buildTestApp();
    cleanup = test.close;

    const res = await uploadFixture(test.app, "sharp.jpg", "image/jpeg");
    const { id } = await json<{ id: string }>(res);
    await test.flushBackgroundJobs();

    const del = await test.app.request(`/images/${id}`, { method: "DELETE" });
    expect(del.status).toBe(204);

    const getRes = await test.app.request(`/images/${id}`);
    expect(getRes.status).toBe(404);
  });
});

describe("GET /images/:id/file", () => {
  it("redirects to a signed URL for an accepted image", async () => {
    const test = await buildTestApp();
    cleanup = test.close;

    const res = await uploadFixture(test.app, "sharp.jpg", "image/jpeg");
    const { id } = await json<{ id: string }>(res);
    await test.flushBackgroundJobs();

    const fileRes = await test.app.request(`/images/${id}/file`, { redirect: "manual" });
    expect(fileRes.status).toBe(302);
    expect(fileRes.headers.get("location")).toMatch(/^https:\/\/fake-storage\.test\//);
  });

  it("404s for a rejected image with no stored file", async () => {
    const test = await buildTestApp();
    cleanup = test.close;

    const res = await uploadFixture(test.app, "too-small.png", "image/png");
    const { id } = await json<{ id: string }>(res);
    await test.flushBackgroundJobs();

    const fileRes = await test.app.request(`/images/${id}/file`, { redirect: "manual" });
    expect(fileRes.status).toBe(404);
  });
});
