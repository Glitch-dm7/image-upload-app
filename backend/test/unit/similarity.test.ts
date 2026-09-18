import { describe, it, expect } from "vitest";
import { computePhash, hammingDistance, checkSimilarity } from "../../src/validation/similarity.js";
import { normalizeImage } from "../../src/validation/normalize.js";
import { readFixture } from "../helpers/fixtures.js";

describe("hammingDistance", () => {
  it("is 0 for identical hashes", () => {
    expect(hammingDistance("aa55aa55aa55aa55", "aa55aa55aa55aa55")).toBe(0);
  });

  it("counts differing bits", () => {
    // 0x0 vs 0xf differ in all 4 bits of that nibble.
    expect(hammingDistance("0000000000000000", "f000000000000000")).toBe(4);
  });

  it("throws on mismatched lengths", () => {
    expect(() => hammingDistance("aa", "aaaa")).toThrow();
  });
});

describe("checkSimilarity", () => {
  const config = { maxSimilarityHammingDistance: 5 };

  it("passes when there are no existing images to compare against", () => {
    expect(checkSimilarity("aa55aa55aa55aa55", [], config)).toEqual({ pass: true });
  });

  it("passes when every existing hash is far away", () => {
    expect(checkSimilarity("0000000000000000", ["ffffffffffffffff"], config)).toEqual({ pass: true });
  });

  it("rejects when an existing hash is within the threshold", () => {
    const result = checkSimilarity("0000000000000000", ["0000000000000001"], config);
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/similar/i);
  });
});

describe("computePhash (near-duplicate detection, real images)", () => {
  it("produces a near-duplicate's hash within the similarity threshold of the original", async () => {
    const base = await normalizeImage(await readFixture("duplicate-base.jpg"));
    const near = await normalizeImage(await readFixture("duplicate-near.jpg"));

    const baseHash = await computePhash(base.buffer);
    const nearHash = await computePhash(near.buffer);

    expect(hammingDistance(baseHash, nearHash)).toBeLessThanOrEqual(5);
  });

  it("produces a clearly-different image's hash well outside the similarity threshold", async () => {
    const base = await normalizeImage(await readFixture("duplicate-base.jpg"));
    const different = await normalizeImage(await readFixture("duplicate-different.jpg"));

    const baseHash = await computePhash(base.buffer);
    const differentHash = await computePhash(different.buffer);

    expect(hammingDistance(baseHash, differentHash)).toBeGreaterThan(5);
  });
});
