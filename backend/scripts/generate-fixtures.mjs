// One-off generator for backend/test/fixtures/*. Not run in CI or by the
// test suite itself — re-run manually (`node scripts/generate-fixtures.mjs`)
// if fixtures ever need regenerating. Kept in the repo so fixture provenance
// is documented instead of being unexplained binary blobs.
//
// We do not ship real photographs of people (consent/licensing concerns for
// a public repo, and no camera-original samples on hand for the take-home).
// Face fixtures are synthetic (drawn ellipses standing in for faces) — see
// test/unit/faceDetection.test.ts for how the face-detection *rule logic*
// is actually unit-tested (against literal bounding boxes, not these
// images). A real .heic sample is not generated here either: sharp's
// prebuilt binaries don't include an HEIC/H.265 encoder (patent-encumbered,
// excluded from the default build), so there's no straightforward way to
// produce a valid one without third-party tooling. The HEIC branch is
// instead tested by mocking format detection + conversion.
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "test", "fixtures");

function seededNoise(width, height, seed) {
  // Deterministic pseudo-random RGB noise buffer (xorshift32).
  let state = seed >>> 0 || 1;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
  const data = Buffer.alloc(width * height * 3);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(next() * 256);
  return data;
}

function checkerboard(width, height, blockSize, colorA, colorB) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isA = (Math.floor(x / blockSize) + Math.floor(y / blockSize)) % 2 === 0;
      const color = isA ? colorA : colorB;
      const idx = (y * width + x) * 3;
      data[idx] = color[0];
      data[idx + 1] = color[1];
      data[idx + 2] = color[2];
    }
  }
  return data;
}

async function ellipseOverlaySvg(width, height, ellipses) {
  const shapes = ellipses
    .map((e) => `<ellipse cx="${e.cx}" cy="${e.cy}" rx="${e.rx}" ry="${e.ry}" fill="#d8a878" />`)
    .join("");
  return Buffer.from(`<svg width="${width}" height="${height}">${shapes}</svg>`);
}

async function main() {
  await mkdir(OUT, { recursive: true });

  // --- resolution rule fixtures ---
  // Below both the min-file-size (10KB) and min-dimensions (400x400) thresholds.
  await sharp(seededNoise(50, 50, 1), { raw: { width: 50, height: 50, channels: 3 } })
    .png()
    .toFile(path.join(OUT, "too-small.png"));

  // Comfortably above every threshold; used as a generic "should pass resolution/blur" fixture.
  await sharp(seededNoise(800, 800, 2), { raw: { width: 800, height: 800, channels: 3 } })
    .jpeg({ quality: 95 })
    .toFile(path.join(OUT, "valid-large.jpg"));

  // --- blur rule fixtures ---
  // High-frequency noise -> high Laplacian variance -> "sharp".
  await sharp(seededNoise(800, 800, 3), { raw: { width: 800, height: 800, channels: 3 } })
    .jpeg({ quality: 95 })
    .toFile(path.join(OUT, "sharp.jpg"));

  // Same kind of source, heavily gaussian-blurred -> low Laplacian variance.
  await sharp(seededNoise(800, 800, 3), { raw: { width: 800, height: 800, channels: 3 } })
    .blur(20)
    .jpeg({ quality: 95 })
    .toFile(path.join(OUT, "blurry.jpg"));

  // --- face rule fixtures (synthetic, see header comment) ---
  const bg = checkerboard(800, 800, 40, [235, 220, 200], [225, 210, 190]);
  const bgImg = () => sharp(bg, { raw: { width: 800, height: 800, channels: 3 } });

  await bgImg().composite([{ input: await ellipseOverlaySvg(800, 800, []) }]).jpeg({ quality: 90 }).toFile(path.join(OUT, "no-face.jpg"));

  await bgImg()
    .composite([{ input: await ellipseOverlaySvg(800, 800, [{ cx: 400, cy: 400, rx: 220, ry: 260 }]) }])
    .jpeg({ quality: 90 })
    .toFile(path.join(OUT, "one-face.jpg"));

  await bgImg()
    .composite([
      {
        input: await ellipseOverlaySvg(800, 800, [
          { cx: 150, cy: 400, rx: 90, ry: 110 },
          { cx: 400, cy: 400, rx: 90, ry: 110 },
          { cx: 650, cy: 400, rx: 90, ry: 110 },
        ]),
      },
    ])
    .jpeg({ quality: 90 })
    .toFile(path.join(OUT, "multiple-faces.jpg"));

  await bgImg()
    .composite([{ input: await ellipseOverlaySvg(800, 800, [{ cx: 700, cy: 700, rx: 30, ry: 35 }]) }])
    .jpeg({ quality: 90 })
    .toFile(path.join(OUT, "tiny-face.jpg"));

  // --- similarity rule fixtures ---
  const base = checkerboard(640, 640, 80, [40, 120, 200], [220, 60, 40]);
  await sharp(base, { raw: { width: 640, height: 640, channels: 3 } }).jpeg({ quality: 95 }).toFile(path.join(OUT, "duplicate-base.jpg"));
  // "Near duplicate": same pattern, recompressed at low quality (introduces
  // compression artifacts) and very slightly darkened - close enough in
  // block-averaged luminance that its pHash should land within the
  // similarity threshold of the base image's pHash.
  await sharp(base, { raw: { width: 640, height: 640, channels: 3 } })
    .modulate({ brightness: 0.97 })
    .jpeg({ quality: 40 })
    .toFile(path.join(OUT, "duplicate-near.jpg"));
  // Clearly different pattern -> should NOT be flagged as similar.
  const different = checkerboard(640, 640, 53, [10, 200, 10], [200, 200, 10]);
  await sharp(different, { raw: { width: 640, height: 640, channels: 3 } }).jpeg({ quality: 95 }).toFile(path.join(OUT, "duplicate-different.jpg"));

  // --- format check fixtures ---
  // Real JPEG bytes, but named with a .png extension - proves the format
  // check trusts magic bytes over the filename extension. (JPEG is an
  // allowed format, so this correctly *passes* format validation despite
  // the misleading name - it demonstrates the check isn't extension-based,
  // not that mismatched extensions are themselves rejected.)
  const jpegBytes = await sharp(seededNoise(400, 400, 4), { raw: { width: 400, height: 400, channels: 3 } }).jpeg().toBuffer();
  await writeFile(path.join(OUT, "spoofed-extension.png"), jpegBytes);

  // A file with an image extension but content that isn't an image at all -
  // must be rejected by the format check regardless of its .jpg name.
  await writeFile(path.join(OUT, "not-actually-an-image.jpg"), Buffer.from("this is plain text, not an image\n"));

  console.log("Fixtures written to", OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
