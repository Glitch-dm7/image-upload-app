import { createRequire } from "node:module";
import path from "node:path";
import sharp from "sharp";
import { thresholds } from "../config.js";
import type { RuleResult } from "./types.js";

const require = createRequire(import.meta.url);

// @vladmandic/face-api ships several Node builds. We use the WASM-backend
// build (`face-api.node-wasm.js`) instead of the default `face-api.node.js`,
// which requires @tensorflow/tfjs-node — a native addon that needs to be
// compiled/downloaded per-platform. The WASM backend runs pure JS + a
// prebuilt .wasm binary, so it installs and runs identically on any host
// (including Render's free tier) with no native build step, at some
// inference-speed cost. Fine for demo-scale traffic; a production system
// with real throughput requirements would likely want tfjs-node or a GPU.
const faceapi = require("@vladmandic/face-api/dist/face-api.node-wasm.js");
const tf = require("@tensorflow/tfjs");
require("@tensorflow/tfjs-backend-wasm");

export interface DetectedFace {
  x: number;
  y: number;
  width: number;
  height: number;
}

let modelsReady: Promise<void> | undefined;

async function ensureModelsLoaded(): Promise<void> {
  if (!modelsReady) {
    modelsReady = (async () => {
      await tf.setBackend("wasm");
      await tf.ready();
      const modelPath = path.join(path.dirname(require.resolve("@vladmandic/face-api/package.json")), "model");
      await faceapi.nets.tinyFaceDetector.loadFromDisk(modelPath);
    })();
  }
  return modelsReady;
}

/**
 * Runs the actual ML model. Deliberately thin: it just converts pixels to a
 * tensor and calls detectAllFaces. All accept/reject *decision* logic lives
 * in the pure `evaluateFaces` below, which is what the unit tests target —
 * we don't ship real photographs of people as test fixtures (consent/
 * licensing concerns for a public repo), so this function itself is covered
 * by a manual smoke check rather than fixture-based unit tests. See
 * test/unit/faceDetection.test.ts for details.
 */
export async function detectFaces(imageBuffer: Buffer, width: number, height: number): Promise<DetectedFace[]> {
  await ensureModelsLoaded();

  const { data } = await sharp(imageBuffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const tensor = tf.tensor3d(new Int32Array(data), [height, width, 3], "int32");
  try {
    const results = await faceapi.detectAllFaces(tensor, new faceapi.TinyFaceDetectorOptions());
    return results.map((r: { box: { x: number; y: number; width: number; height: number } }) => ({
      x: r.box.x,
      y: r.box.y,
      width: r.box.width,
      height: r.box.height,
    }));
  } finally {
    tensor.dispose();
  }
}

/**
 * Pure decision logic, fully unit-testable with synthetic bounding boxes.
 *
 * Per spec: a *zero-face* image is not itself a rejection reason (not one of
 * the two stated conditions) — only "multiple faces" and "face too small"
 * are. So this function only ever returns a failure for those two cases.
 */
export function evaluateFaces(
  faces: DetectedFace[],
  imageWidth: number,
  imageHeight: number,
  config: Pick<typeof thresholds, "minFaceAreaRatio"> = thresholds,
): RuleResult {
  if (faces.length > 1) {
    return { pass: false, reason: `Multiple faces detected (${faces.length})` };
  }
  if (faces.length === 1) {
    const face = faces[0]!;
    const faceArea = face.width * face.height;
    const imageArea = imageWidth * imageHeight;
    const ratio = imageArea > 0 ? faceArea / imageArea : 0;
    if (ratio < config.minFaceAreaRatio) {
      return { pass: false, reason: `Face is too small (${(ratio * 100).toFixed(1)}% of image area < ${config.minFaceAreaRatio * 100}%)` };
    }
  }
  return { pass: true };
}
