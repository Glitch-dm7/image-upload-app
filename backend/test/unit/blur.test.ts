import { describe, it, expect } from "vitest";
import { computeBlurVariance, checkBlur } from "../../src/validation/blur.js";
import { normalizeImage } from "../../src/validation/normalize.js";
import { readFixture } from "../helpers/fixtures.js";

describe("computeBlurVariance", () => {
  it("scores a heavily-blurred image much lower than a high-frequency-noise image", async () => {
    const sharpDecoded = await normalizeImage(await readFixture("sharp.jpg"));
    const blurryDecoded = await normalizeImage(await readFixture("blurry.jpg"));

    const sharpVariance = await computeBlurVariance(sharpDecoded.buffer);
    const blurryVariance = await computeBlurVariance(blurryDecoded.buffer);

    expect(sharpVariance).toBeGreaterThan(blurryVariance * 100);
  });
});

describe("checkBlur", () => {
  it("passes variance at/above the threshold", () => {
    expect(checkBlur(150, { blurVarianceMin: 100 })).toEqual({ pass: true });
    expect(checkBlur(100, { blurVarianceMin: 100 })).toEqual({ pass: true });
  });

  it("rejects variance below the threshold", () => {
    const result = checkBlur(5, { blurVarianceMin: 100 });
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/blurry/i);
  });
});
