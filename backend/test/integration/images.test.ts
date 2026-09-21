import { describe, it, expect, afterEach } from "vitest";
import type { Hono } from "hono";
import { buildTestApp } from "../helpers/testApp.js";
import { readFixture } from "../helpers/fixtures.js";
import { createAcceptedJpeg, createNearDuplicatePair } from "../helpers/syntheticImages.js";

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function uploadBuffer(app: Hono, path: string, bytes: Buffer, filename: string, mime: string) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], filename, { type: mime }));
  return app.request(path, { method: "POST", body: form });
}

async function uploadFixture(app: Hono, path: string, filename: string, mime: string) {
  return uploadBuffer(app, path, await readFixture(filename), filename, mime);
}

function json<T = any>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}

describe("POST /images/validate", () => {
  it("reports an accepted image without creating any DB row or storage object", async () => {
    const test = await buildTestApp();
    cleanup = test.close;

    const res = await uploadFixture(test.app, "/images/validate", "sharp.jpg", "image/jpeg");
    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body.status).toBe("accepted");
    expect(body.width).toBe(800);
    expect(typeof body.phash).toBe("string");

    const list = await json<any>(await test.app.request("/images"));
    expect(list.items).toHaveLength(0);
    expect((test.storage as any).objects.size).toBe(0);
  });

  it("reports a rejected image (too small) without creating any DB row", async () => {
    const test = await buildTestApp();
    cleanup = test.close;

    const res = await uploadFixture(test.app, "/images/validate", "too-small.png", "image/png");
    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body.status).toBe("rejected");
    expect(body.rejectionReasons.length).toBeGreaterThan(0);

    const list = await json<any>(await test.app.request("/images"));
    expect(list.items).toHaveLength(0);
  });

  it("reports an unrecognized format as a plain rejection (200), not a request error", async () => {
    const test = await buildTestApp();
    cleanup = test.close;

    const res = await uploadFixture(test.app, "/images/validate", "not-actually-an-image.jpg", "image/jpeg");
    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body.status).toBe("rejected");
  });

  it("still errors on a missing file field", async () => {
    const test = await buildTestApp();
    cleanup = test.close;

    const res = await test.app.request("/images/validate", { method: "POST", body: new FormData() });
    expect(res.status).toBe(400);
  });

  it("still errors when the file exceeds the size cap", async () => {
    const test = await buildTestApp({ maxUploadSizeBytes: 100 });
    cleanup = test.close;

    const res = await uploadFixture(test.app, "/images/validate", "sharp.jpg", "image/jpeg");
    expect(res.status).toBe(413);
  });
});

describe("POST /images/submit", () => {
  it("on an accepted image, creates exactly one DB row and one storage object", async () => {
    const test = await buildTestApp();
    cleanup = test.close;

    const res = await uploadFixture(test.app, "/images/submit", "sharp.jpg", "image/jpeg");
    expect(res.status).toBe(201);
    const body = await json<any>(res);
    expect(body.status).toBe("accepted");
    expect(body.id).toBeTruthy();

    const getRes = await test.app.request(`/images/${body.id}`);
    expect(getRes.status).toBe(200);
    expect((await json<any>(getRes)).status).toBe("accepted");
    expect((test.storage as any).objects.size).toBe(1);
  });

  it("on a rejected image, creates no row and uploads nothing", async () => {
    const test = await buildTestApp();
    cleanup = test.close;

    const res = await uploadFixture(test.app, "/images/submit", "too-small.png", "image/png");
    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body.status).toBe("rejected");

    const list = await json<any>(await test.app.request("/images"));
    expect(list.items).toHaveLength(0);
    expect((test.storage as any).objects.size).toBe(0);
  });

  it("rejects a near-duplicate of an already-submitted accepted image", async () => {
    const test = await buildTestApp();
    cleanup = test.close;

    const { base, near } = await createNearDuplicatePair();

    const first = await uploadBuffer(test.app, "/images/submit", base, "base.jpg", "image/jpeg");
    expect((await json<any>(first)).status).toBe("accepted");

    const second = await uploadBuffer(test.app, "/images/submit", near, "near.jpg", "image/jpeg");
    const secondBody = await json<any>(second);
    expect(secondBody.status).toBe("rejected");
    expect(secondBody.rejectionReasons.some((r: string) => /similar/i.test(r))).toBe(true);

    const list = await json<any>(await test.app.request("/images"));
    expect(list.items).toHaveLength(1);
  });

  it("still errors on a missing file field", async () => {
    const test = await buildTestApp();
    cleanup = test.close;

    const res = await test.app.request("/images/submit", { method: "POST", body: new FormData() });
    expect(res.status).toBe(400);
  });
});

describe("GET /images/:id", () => {
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

    await uploadFixture(test.app, "/images/submit", "sharp.jpg", "image/jpeg");

    const accepted = await json<any>(await test.app.request("/images?status=accepted"));
    const rejected = await json<any>(await test.app.request("/images?status=rejected"));
    expect(accepted.items).toHaveLength(1);
    expect(rejected.items).toHaveLength(0);
  });

  it("paginates with a cursor, returning every item exactly once", async () => {
    const test = await buildTestApp();
    cleanup = test.close;

    // Five mutually-dissimilar images - reusing the same fixture five times
    // would trip the duplicate-detection rule from the second submission on.
    for (let i = 0; i < 5; i++) {
      await uploadBuffer(test.app, "/images/submit", await createAcceptedJpeg(i), `photo-${i}.jpg`, "image/jpeg");
    }

    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = cursor ? `/images?limit=2&cursor=${encodeURIComponent(cursor)}` : "/images?limit=2";
      const page: { items: { id: string }[]; nextCursor: string | null } = await json(await test.app.request(url));
      for (const item of page.items) seen.add(item.id);
      cursor = page.nextCursor;
      pages++;
      expect(pages).toBeLessThan(10);
    } while (cursor);

    expect(seen.size).toBe(5);
  });

  it("rejects an invalid status filter", async () => {
    const test = await buildTestApp();
    cleanup = test.close;

    const res = await test.app.request("/images?status=bogus");
    expect(res.status).toBe(400);
  });

  it("rejects an invalid cursor", async () => {
    const test = await buildTestApp();
    cleanup = test.close;

    const res = await test.app.request("/images?cursor=not-a-real-cursor");
    expect(res.status).toBe(400);
  });
});

describe("DELETE /images/:id", () => {
  it("deletes the DB row and the stored object", async () => {
    const test = await buildTestApp();
    cleanup = test.close;

    const res = await uploadFixture(test.app, "/images/submit", "sharp.jpg", "image/jpeg");
    const { id } = await json<{ id: string }>(res);

    const del = await test.app.request(`/images/${id}`, { method: "DELETE" });
    expect(del.status).toBe(204);

    const getRes = await test.app.request(`/images/${id}`);
    expect(getRes.status).toBe(404);
    expect((test.storage as any).objects.size).toBe(0);
  });

  it("returns 404 for a nonexistent image id", async () => {
    const test = await buildTestApp();
    cleanup = test.close;

    const res = await test.app.request("/images/00000000-0000-0000-0000-000000000000", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("GET /images/:id/file", () => {
  it("redirects to a signed URL for a submitted image", async () => {
    const test = await buildTestApp();
    cleanup = test.close;

    const res = await uploadFixture(test.app, "/images/submit", "sharp.jpg", "image/jpeg");
    const { id } = await json<{ id: string }>(res);

    const fileRes = await test.app.request(`/images/${id}/file`, { redirect: "manual" });
    expect(fileRes.status).toBe(302);
    expect(fileRes.headers.get("location")).toMatch(/^https:\/\/fake-storage\.test\//);
  });

  it("404s for a nonexistent image", async () => {
    const test = await buildTestApp();
    cleanup = test.close;

    const fileRes = await test.app.request("/images/00000000-0000-0000-0000-000000000000/file", { redirect: "manual" });
    expect(fileRes.status).toBe(404);
  });
});
