import sharp from "sharp";
import { bmvbhash } from "blockhash-core";
import { thresholds } from "../config.js";
import type { RuleResult } from "./types.js";

// 8x8 blocks = 64-bit hash, matching the "out of 64 bits" framing in the
// spec's Hamming-distance threshold.
const HASH_BITS = 8;

/**
 * Perceptual hash via blockhash (chosen over sharp-phash: sharp-phash is
 * unmaintained and pulls in its own image decoding; blockhash-core is a
 * small, dependency-free, actively-referenced implementation that we feed
 * pixels into directly using the sharp decode we already have).
 */
export async function computePhash(imageBuffer: Buffer): Promise<string> {
  const { data, info } = await sharp(imageBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return bmvbhash({ width: info.width, height: info.height, data }, HASH_BITS);
}

/** Pure, no image IO — operates on two hex hash strings. */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) {
    throw new Error(`Cannot compare hashes of different lengths: ${a.length} vs ${b.length}`);
  }
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    const xor = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    distance += xor.toString(2).split("").filter((bit) => bit === "1").length;
  }
  return distance;
}

/**
 * Pure comparison against a list of existing hashes. Isolated on purpose
 * (per spec) so the O(n) linear scan below is swappable later for an
 * LSH/bucketing strategy without touching call sites — at real scale,
 * comparing against every accepted row's hash doesn't stay cheap.
 */
export function checkSimilarity(
  newHash: string,
  existingHashes: string[],
  config: Pick<typeof thresholds, "maxSimilarityHammingDistance"> = thresholds,
): RuleResult {
  for (const existing of existingHashes) {
    const distance = hammingDistance(newHash, existing);
    if (distance <= config.maxSimilarityHammingDistance) {
      return { pass: false, reason: `Too similar to an existing accepted image (Hamming distance ${distance})` };
    }
  }
  return { pass: true };
}
