import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "../helpers/testDb.js";
import { createImageRepository, InvalidCursorError, type NewAcceptedImage } from "../../src/repositories/image.repository.js";

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

function sampleImage(overrides: Partial<NewAcceptedImage> = {}): NewAcceptedImage {
  return {
    originalFilename: "photo.jpg",
    storageKey: "abc123.jpg",
    mimeType: "image/jpeg",
    fileSizeBytes: 12345,
    width: 800,
    height: 800,
    phash: "aa55aa55aa55aa55",
    faceCount: 0,
    blurScore: 500,
    ...overrides,
  };
}

async function buildRepo() {
  const { db, close } = await createTestDb();
  cleanup = close;
  return createImageRepository(db);
}

describe("createImageRepository", () => {
  it("insertAccepted always writes status accepted with empty rejectionReasons", async () => {
    const repo = await buildRepo();
    const image = await repo.insertAccepted(sampleImage());
    expect(image.status).toBe("accepted");
    expect(image.rejectionReasons).toEqual([]);
    expect(image.originalFilename).toBe("photo.jpg");
    expect(image.id).toBeTruthy();
  });

  it("findById returns the row, or null when it doesn't exist", async () => {
    const repo = await buildRepo();
    const inserted = await repo.insertAccepted(sampleImage());

    expect(await repo.findById(inserted.id)).toMatchObject({ id: inserted.id });
    expect(await repo.findById("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("deleteById removes the row and returns it, or null if it didn't exist", async () => {
    const repo = await buildRepo();
    const inserted = await repo.insertAccepted(sampleImage());

    const deleted = await repo.deleteById(inserted.id);
    expect(deleted?.id).toBe(inserted.id);
    expect(await repo.findById(inserted.id)).toBeNull();
    expect(await repo.deleteById(inserted.id)).toBeNull();
  });

  it("getAcceptedPhashes returns every stored phash", async () => {
    const repo = await buildRepo();
    await repo.insertAccepted(sampleImage({ phash: "hash1" }));
    await repo.insertAccepted(sampleImage({ phash: "hash2" }));

    const hashes = await repo.getAcceptedPhashes();
    expect(hashes.sort()).toEqual(["hash1", "hash2"]);
  });

  it("list paginates with a cursor, returning every item exactly once, newest first", async () => {
    const repo = await buildRepo();
    for (let i = 0; i < 5; i++) {
      await repo.insertAccepted(sampleImage({ originalFilename: `photo-${i}.jpg` }));
    }

    const seen = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await repo.list({ limit: 2, cursor });
      for (const item of page.items) seen.add(item.id);
      cursor = page.nextCursor ?? undefined;
      pages++;
      expect(pages).toBeLessThan(10);
    } while (cursor);

    expect(seen.size).toBe(5);
  });

  it("list filters by status", async () => {
    const repo = await buildRepo();
    await repo.insertAccepted(sampleImage());

    expect((await repo.list({ status: "accepted", limit: 20 })).items).toHaveLength(1);
    expect((await repo.list({ status: "rejected", limit: 20 })).items).toHaveLength(0);
  });

  it("list throws InvalidCursorError for a malformed cursor", async () => {
    const repo = await buildRepo();
    await expect(repo.list({ limit: 20, cursor: "not-a-real-cursor" })).rejects.toThrow(InvalidCursorError);
  });
});
