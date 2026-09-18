import sharp from "sharp";
import { thresholds } from "../config.js";
import type { RuleResult } from "./types.js";

// Classic "variance of Laplacian" sharpness metric: convolve a greyscale
// image with a Laplacian kernel (edge response), then measure how spread out
// the resulting pixel values are. Low variance = few/weak edges = blurry.
//
// Note: sharp's `convolve` clamps output to the 0-255 uint8 range with no
// offset applied here, so negative edge responses get clipped to 0. That's a
// simplification (a from-scratch float implementation wouldn't lose that
// signal) but it's a stable, cheap-to-compute relative metric, which is all
// this rule needs.
const LAPLACIAN_KERNEL = { width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] };

export async function computeBlurVariance(imageBuffer: Buffer): Promise<number> {
  const { data } = await sharp(imageBuffer).greyscale().convolve(LAPLACIAN_KERNEL).raw().toBuffer({ resolveWithObject: true });

  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i]!;
  const mean = sum / data.length;

  let variance = 0;
  for (let i = 0; i < data.length; i++) {
    const diff = data[i]! - mean;
    variance += diff * diff;
  }
  return variance / data.length;
}

/**
 * Pure decision. The variance threshold is an untuned starting default per
 * the project spec — it should be calibrated against a labeled sample set
 * before relying on it for real accept/reject decisions.
 */
export function checkBlur(variance: number, config: Pick<typeof thresholds, "blurVarianceMin"> = thresholds): RuleResult {
  if (variance < config.blurVarianceMin) {
    return { pass: false, reason: `Image is too blurry (Laplacian variance ${variance.toFixed(1)} < ${config.blurVarianceMin})` };
  }
  return { pass: true };
}
