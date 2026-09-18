import { describe, it, expect } from "vitest";
import { checkResolution } from "../../src/validation/resolution.js";

const config = { minFileSizeBytes: 10 * 1024, minWidthPx: 400, minHeightPx: 400 };

describe("checkResolution", () => {
  it("passes an image comfortably above every threshold", () => {
    expect(checkResolution({ fileSizeBytes: 500_000, width: 800, height: 800 }, config)).toEqual({ pass: true });
  });

  it("rejects a file below the minimum size", () => {
    const result = checkResolution({ fileSizeBytes: 1024, width: 800, height: 800 }, config);
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/file size/i);
  });

  it("rejects an image below the minimum width or height", () => {
    const result = checkResolution({ fileSizeBytes: 500_000, width: 100, height: 100 }, config);
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/dimensions/i);
  });

  it("treats width/height thresholds as inclusive lower bounds", () => {
    expect(checkResolution({ fileSizeBytes: 500_000, width: 400, height: 400 }, config)).toEqual({ pass: true });
  });
});
