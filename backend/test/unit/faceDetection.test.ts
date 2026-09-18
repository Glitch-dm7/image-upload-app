import { describe, it, expect } from "vitest";
import { evaluateFaces, detectFaces, type DetectedFace } from "../../src/validation/faceDetection.js";
import { normalizeImage } from "../../src/validation/normalize.js";
import { readFixture } from "../helpers/fixtures.js";

const config = { minFaceAreaRatio: 0.05 };
const IMAGE_SIZE = 800;

describe("evaluateFaces (pure decision logic)", () => {
  // Per spec: zero faces is deliberately NOT a rejection reason - only
  // "multiple faces" and "face too small" are.
  it("passes when no faces are detected", () => {
    expect(evaluateFaces([], IMAGE_SIZE, IMAGE_SIZE, config)).toEqual({ pass: true });
  });

  it("passes a single face whose bounding box is comfortably above the area threshold", () => {
    const faces: DetectedFace[] = [{ x: 200, y: 150, width: 300, height: 350 }]; // ~16% of frame
    expect(evaluateFaces(faces, IMAGE_SIZE, IMAGE_SIZE, config)).toEqual({ pass: true });
  });

  it("rejects a single face below the minimum area ratio", () => {
    const faces: DetectedFace[] = [{ x: 10, y: 10, width: 40, height: 40 }]; // 1600/640000 = 0.25%
    const result = evaluateFaces(faces, IMAGE_SIZE, IMAGE_SIZE, config);
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/too small/i);
  });

  it("rejects multiple faces regardless of their size", () => {
    const faces: DetectedFace[] = [
      { x: 50, y: 50, width: 300, height: 300 },
      { x: 400, y: 400, width: 300, height: 300 },
    ];
    const result = evaluateFaces(faces, IMAGE_SIZE, IMAGE_SIZE, config);
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/multiple faces/i);
  });

  it("reports multiple-faces before ever consulting the size threshold", () => {
    // Three tiny faces: still "multiple faces", not "too small".
    const faces: DetectedFace[] = [
      { x: 0, y: 0, width: 5, height: 5 },
      { x: 100, y: 100, width: 5, height: 5 },
      { x: 200, y: 200, width: 5, height: 5 },
    ];
    const result = evaluateFaces(faces, IMAGE_SIZE, IMAGE_SIZE, config);
    expect(result.reason).toMatch(/multiple faces/i);
  });
});

// These fixtures are synthetic drawings (see scripts/generate-fixtures.mjs),
// not real photographs, so a real face-detection model has no reason to
// recognize the drawn ellipses as faces. This is a smoke test that the WASM
// model loads and runs end-to-end without throwing - not a claim about
// detection accuracy on these images. Accuracy against real photos is a
// manual/demo-time check, documented in the README.
describe("detectFaces (smoke test, real model)", () => {
  it("runs without throwing and returns an array for each fixture", async () => {
    for (const name of ["no-face.jpg", "one-face.jpg", "multiple-faces.jpg", "tiny-face.jpg"]) {
      const decoded = await normalizeImage(await readFixture(name));
      const faces = await detectFaces(decoded.buffer, decoded.width, decoded.height);
      expect(Array.isArray(faces)).toBe(true);
    }
  });
});
