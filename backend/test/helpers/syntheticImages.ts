import sharp from "sharp";

// Deterministic, dependency-free "accepted-shaped" test images: large
// enough and sharp enough to clear resolution/blur, with no drawn faces
// (0 faces is never itself a rejection reason). Pure random noise clears
// blur easily but blockhash's block-average hash is *unstable* on it (every
// 100x100 block converges to ~the same mean by the CLT, so tiny per-pixel
// changes flip which side of the median a block lands on) - useless for
// testing "these are/aren't near-duplicates". A large-block checkerboard
// with per-pixel noise layered on top gives a hash that's dominated by the
// stable block-to-block color difference (robust to recompression/brightness
// tweaks) while the noise still supplies enough high-frequency edge content
// to pass the blur check.
type RgbColor = [number, number, number];

function noisyCheckerboard(blockSize: number, seed: number, colors: [RgbColor, RgbColor]): Buffer {
  const width = 800;
  const height = 800;
  let state = seed >>> 0 || 1;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isA = (Math.floor(x / blockSize) + Math.floor(y / blockSize)) % 2 === 0;
      const base = isA ? colors[0] : colors[1];
      const idx = (y * width + x) * 3;
      for (let c = 0; c < 3; c++) {
        const noise = (next() - 0.5) * 2 * 60;
        data[idx + c] = Math.max(0, Math.min(255, Math.round(base[c]! + noise)));
      }
    }
  }
  return data;
}

const VARIANTS: { blockSize: number; colors: [RgbColor, RgbColor] }[] = [
  { blockSize: 100, colors: [[60, 130, 200], [210, 70, 50]] },
  { blockSize: 133, colors: [[20, 200, 60], [200, 200, 20]] },
  { blockSize: 90, colors: [[200, 20, 180], [20, 180, 200]] },
  { blockSize: 267, colors: [[240, 240, 240], [10, 10, 10]] },
  { blockSize: 57, colors: [[255, 140, 0], [0, 90, 160]] },
];

/**
 * `variant` selects one of a handful of mutually-dissimilar generated
 * images (verified pairwise Hamming distance >> the similarity threshold),
 * for tests that need several distinct accepted images without tripping
 * the duplicate-detection rule against each other.
 */
export async function createAcceptedJpeg(variant = 0): Promise<Buffer> {
  const v = VARIANTS[variant % VARIANTS.length]!;
  const raw = noisyCheckerboard(v.blockSize, 7, v.colors);
  return sharp(raw, { raw: { width: 800, height: 800, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();
}

/** A pair of images that individually clear every check, and are near-duplicates of each other. */
export async function createNearDuplicatePair(): Promise<{ base: Buffer; near: Buffer }> {
  const raw = noisyCheckerboard(100, 7, [[60, 130, 200], [210, 70, 50]]);
  const base = await sharp(raw, { raw: { width: 800, height: 800, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();
  // Recompressed at a much lower quality and slightly darkened - close
  // enough in block-averaged luminance that its pHash lands within the
  // similarity threshold of the base image's pHash (verified empirically).
  const near = await sharp(raw, { raw: { width: 800, height: 800, channels: 3 } })
    .modulate({ brightness: 0.97 })
    .jpeg({ quality: 60 })
    .toBuffer();
  return { base, near };
}
