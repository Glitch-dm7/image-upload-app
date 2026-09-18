import { describe, it, expect, vi, beforeEach } from "vitest";

// The orchestrator is tested in isolation from the real rules: every rule
// module is mocked so we can assert ordering/short-circuit behavior without
// needing real images or a real ML model in this file (those live in each
// rule's own unit test).
const mocks = vi.hoisted(() => ({
  detectFormat: vi.fn(),
  checkFormat: vi.fn(),
  isHeic: vi.fn(),
  convertHeicToJpeg: vi.fn(),
  normalizeImage: vi.fn(),
  checkResolution: vi.fn(),
  computeBlurVariance: vi.fn(),
  checkBlur: vi.fn(),
  detectFaces: vi.fn(),
  evaluateFaces: vi.fn(),
  computePhash: vi.fn(),
  checkSimilarity: vi.fn(),
}));

vi.mock("../../src/validation/format.js", () => ({
  detectFormat: mocks.detectFormat,
  checkFormat: mocks.checkFormat,
  isHeic: mocks.isHeic,
}));
vi.mock("../../src/validation/heicConversion.js", () => ({ convertHeicToJpeg: mocks.convertHeicToJpeg }));
vi.mock("../../src/validation/normalize.js", () => ({ normalizeImage: mocks.normalizeImage }));
vi.mock("../../src/validation/resolution.js", () => ({ checkResolution: mocks.checkResolution }));
vi.mock("../../src/validation/blur.js", () => ({ computeBlurVariance: mocks.computeBlurVariance, checkBlur: mocks.checkBlur }));
vi.mock("../../src/validation/faceDetection.js", () => ({ detectFaces: mocks.detectFaces, evaluateFaces: mocks.evaluateFaces }));
vi.mock("../../src/validation/similarity.js", () => ({ computePhash: mocks.computePhash, checkSimilarity: mocks.checkSimilarity }));

const { runValidationPipeline } = await import("../../src/validation/pipeline.js");

function setupHappyPath() {
  mocks.detectFormat.mockResolvedValue({ ext: "jpg", mime: "image/jpeg" });
  mocks.checkFormat.mockReturnValue({ pass: true });
  mocks.isHeic.mockReturnValue(false);
  mocks.normalizeImage.mockResolvedValue({ buffer: Buffer.from("decoded"), width: 800, height: 800, mimeType: "image/jpeg" });
  mocks.checkResolution.mockReturnValue({ pass: true });
  mocks.computeBlurVariance.mockResolvedValue(500);
  mocks.checkBlur.mockReturnValue({ pass: true });
  mocks.detectFaces.mockResolvedValue([]);
  mocks.evaluateFaces.mockReturnValue({ pass: true });
  mocks.computePhash.mockResolvedValue("abc123");
  mocks.checkSimilarity.mockReturnValue({ pass: true });
}

const deps = { getExistingAcceptedHashes: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  setupHappyPath();
  deps.getExistingAcceptedHashes.mockResolvedValue([]);
});

describe("runValidationPipeline", () => {
  it("accepts when every rule passes", async () => {
    const result = await runValidationPipeline(Buffer.from("raw"), deps);
    expect(result.status).toBe("accepted");
    expect(result.rejectionReasons).toEqual([]);
  });

  it("short-circuits on format failure: no other rule runs and no metadata is computed", async () => {
    mocks.checkFormat.mockReturnValue({ pass: false, reason: "bad format" });

    const result = await runValidationPipeline(Buffer.from("raw"), deps);

    expect(result.status).toBe("rejected");
    expect(result.rejectionReasons).toEqual(["bad format"]);
    expect(result.width).toBeNull();
    expect(mocks.normalizeImage).not.toHaveBeenCalled();
    expect(mocks.checkResolution).not.toHaveBeenCalled();
    expect(mocks.computeBlurVariance).not.toHaveBeenCalled();
    expect(mocks.detectFaces).not.toHaveBeenCalled();
    expect(mocks.computePhash).not.toHaveBeenCalled();
  });

  it("converts HEIC input to the working buffer before normalizing", async () => {
    mocks.detectFormat.mockResolvedValue({ ext: "heic", mime: "image/heic" });
    mocks.isHeic.mockReturnValue(true);
    mocks.convertHeicToJpeg.mockResolvedValue(Buffer.from("converted-jpeg"));

    await runValidationPipeline(Buffer.from("raw-heic"), deps);

    expect(mocks.convertHeicToJpeg).toHaveBeenCalledWith(Buffer.from("raw-heic"));
    expect(mocks.normalizeImage).toHaveBeenCalledWith(Buffer.from("converted-jpeg"));
  });

  it("skips HEIC conversion entirely for non-HEIC formats", async () => {
    await runValidationPipeline(Buffer.from("raw"), deps);
    expect(mocks.convertHeicToJpeg).not.toHaveBeenCalled();
    expect(mocks.normalizeImage).toHaveBeenCalledWith(Buffer.from("raw"));
  });

  it("runs every remaining rule even after an earlier one fails, collecting all reasons", async () => {
    mocks.checkResolution.mockReturnValue({ pass: false, reason: "too small" });
    mocks.checkBlur.mockReturnValue({ pass: false, reason: "too blurry" });

    const result = await runValidationPipeline(Buffer.from("raw"), deps);

    expect(result.status).toBe("rejected");
    expect(result.rejectionReasons).toEqual(["too small", "too blurry"]);
    // Face + similarity still ran, and their (passing) metadata is still recorded.
    expect(mocks.detectFaces).toHaveBeenCalled();
    expect(mocks.computePhash).toHaveBeenCalled();
    expect(result.faceCount).toBe(0);
    expect(result.phash).toBe("abc123");
  });

  it("threads the injected existing-hashes dependency through to the similarity check", async () => {
    deps.getExistingAcceptedHashes.mockResolvedValue(["hash1", "hash2"]);
    await runValidationPipeline(Buffer.from("raw"), deps);
    expect(mocks.checkSimilarity).toHaveBeenCalledWith("abc123", ["hash1", "hash2"]);
  });

  it("rejects with a clear reason when the image can't be decoded, without running later rules", async () => {
    mocks.normalizeImage.mockRejectedValue(new Error("boom"));

    const result = await runValidationPipeline(Buffer.from("raw"), deps);

    expect(result.status).toBe("rejected");
    expect(result.rejectionReasons[0]).toMatch(/corrupt|unreadable/i);
    expect(mocks.checkResolution).not.toHaveBeenCalled();
  });
});
