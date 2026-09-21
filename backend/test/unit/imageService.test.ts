import { describe, it, expect, vi, beforeEach } from "vitest";

// The service is tested against fakes for both dependencies, so this file
// never touches a real DB or the real validation pipeline's ML/image work -
// only the orchestration logic (when does it call storage/repository, and
// with what) is under test here.
const mocks = vi.hoisted(() => ({ runValidationPipeline: vi.fn() }));
vi.mock("../../src/validation/pipeline.js", () => ({ runValidationPipeline: mocks.runValidationPipeline }));

const { createImageService, NotFoundError } = await import("../../src/services/image.service.js");

function fakeRepository() {
  return {
    insertAccepted: vi.fn(async (data) => ({
      id: "new-id",
      status: "accepted" as const,
      rejectionReasons: [] as string[],
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    })),
    findById: vi.fn(async () => null),
    list: vi.fn(async () => ({ items: [], nextCursor: null })),
    deleteById: vi.fn(async () => null),
    getAcceptedPhashes: vi.fn(async () => [] as string[]),
  };
}

function fakeStorage() {
  return {
    upload: vi.fn(async () => undefined),
    getSignedDownloadUrl: vi.fn(async () => "https://fake.test/signed"),
    delete: vi.fn(async () => undefined),
  };
}

const acceptedPipelineResult = {
  status: "accepted" as const,
  rejectionReasons: [] as string[],
  mimeType: "image/jpeg",
  width: 800,
  height: 800,
  phash: "abc123",
  faceCount: 0,
  blurScore: 500,
  processedBuffer: Buffer.from("decoded"),
};

const rejectedPipelineResult = {
  status: "rejected" as const,
  rejectionReasons: ["too blurry"],
  mimeType: "image/jpeg",
  width: 800,
  height: 800,
  phash: "abc123",
  faceCount: 0,
  blurScore: 2,
  processedBuffer: Buffer.from("decoded"),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createImageService.validate", () => {
  it("returns the pipeline's verdict without touching storage or the repository's writes", async () => {
    mocks.runValidationPipeline.mockResolvedValue(acceptedPipelineResult);
    const repository = fakeRepository();
    const storage = fakeStorage();
    const service = createImageService({ repository, storage });

    const outcome = await service.validate(Buffer.from("raw"));

    expect(outcome.status).toBe("accepted");
    expect(storage.upload).not.toHaveBeenCalled();
    expect(repository.insertAccepted).not.toHaveBeenCalled();
  });

  it("reports a rejection without touching storage or the repository's writes", async () => {
    mocks.runValidationPipeline.mockResolvedValue(rejectedPipelineResult);
    const repository = fakeRepository();
    const storage = fakeStorage();
    const service = createImageService({ repository, storage });

    const outcome = await service.validate(Buffer.from("raw"));

    expect(outcome.status).toBe("rejected");
    expect(outcome.rejectionReasons).toEqual(["too blurry"]);
    expect(storage.upload).not.toHaveBeenCalled();
    expect(repository.insertAccepted).not.toHaveBeenCalled();
  });

  it("passes the repository's accepted-phash lookup through to the pipeline", async () => {
    mocks.runValidationPipeline.mockResolvedValue(acceptedPipelineResult);
    const repository = fakeRepository();
    repository.getAcceptedPhashes.mockResolvedValue(["hash1"]);
    const service = createImageService({ repository, storage: fakeStorage() });

    await service.validate(Buffer.from("raw"));

    const deps = mocks.runValidationPipeline.mock.calls[0]![1];
    await expect(deps.getExistingAcceptedHashes()).resolves.toEqual(["hash1"]);
  });
});

describe("createImageService.submit", () => {
  it("on acceptance, uploads the processed buffer and inserts exactly one row", async () => {
    mocks.runValidationPipeline.mockResolvedValue(acceptedPipelineResult);
    const repository = fakeRepository();
    const storage = fakeStorage();
    const service = createImageService({ repository, storage });

    const result = await service.submit(Buffer.from("raw"), "photo.jpg");

    expect(result.accepted).toBe(true);
    expect(storage.upload).toHaveBeenCalledTimes(1);
    expect(storage.upload).toHaveBeenCalledWith(expect.stringContaining(".jpg"), acceptedPipelineResult.processedBuffer, "image/jpeg");
    expect(repository.insertAccepted).toHaveBeenCalledTimes(1);
    expect(repository.insertAccepted).toHaveBeenCalledWith(
      expect.objectContaining({ originalFilename: "photo.jpg", mimeType: "image/jpeg", width: 800, height: 800 }),
    );
  });

  it("on rejection, uploads nothing and inserts no row", async () => {
    mocks.runValidationPipeline.mockResolvedValue(rejectedPipelineResult);
    const repository = fakeRepository();
    const storage = fakeStorage();
    const service = createImageService({ repository, storage });

    const result = await service.submit(Buffer.from("raw"), "photo.jpg");

    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(result.outcome.rejectionReasons).toEqual(["too blurry"]);
    expect(storage.upload).not.toHaveBeenCalled();
    expect(repository.insertAccepted).not.toHaveBeenCalled();
  });

  it("re-runs the pipeline itself rather than trusting a prior result", async () => {
    mocks.runValidationPipeline.mockResolvedValue(acceptedPipelineResult);
    const service = createImageService({ repository: fakeRepository(), storage: fakeStorage() });

    await service.submit(Buffer.from("raw"), "photo.jpg");

    expect(mocks.runValidationPipeline).toHaveBeenCalledTimes(1);
  });
});

describe("createImageService other methods", () => {
  it("getById throws NotFoundError when the repository returns null", async () => {
    const repository = fakeRepository();
    const service = createImageService({ repository, storage: fakeStorage() });
    await expect(service.getById("missing")).rejects.toThrow(NotFoundError);
  });

  it("remove deletes the row and best-effort deletes its storage object", async () => {
    const repository = fakeRepository();
    repository.deleteById.mockResolvedValue({ id: "x", storageKey: "key.jpg" } as any);
    const storage = fakeStorage();
    const service = createImageService({ repository, storage });

    await service.remove("x");

    expect(storage.delete).toHaveBeenCalledWith("key.jpg");
  });

  it("remove throws NotFoundError when nothing was deleted", async () => {
    const repository = fakeRepository();
    const service = createImageService({ repository, storage: fakeStorage() });
    await expect(service.remove("missing")).rejects.toThrow(NotFoundError);
  });

  it("getFileUrl throws NotFoundError when the image has no storage key", async () => {
    const repository = fakeRepository();
    repository.findById.mockResolvedValue({ id: "x", storageKey: null } as any);
    const service = createImageService({ repository, storage: fakeStorage() });
    await expect(service.getFileUrl("x")).rejects.toThrow(NotFoundError);
  });
});
