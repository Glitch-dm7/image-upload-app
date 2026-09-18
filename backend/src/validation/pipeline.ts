import { detectFormat, checkFormat, isHeic } from "./format.js";
import { convertHeicToJpeg } from "./heicConversion.js";
import { normalizeImage } from "./normalize.js";
import { checkResolution } from "./resolution.js";
import { computeBlurVariance, checkBlur } from "./blur.js";
import { detectFaces, evaluateFaces } from "./faceDetection.js";
import { computePhash, checkSimilarity } from "./similarity.js";

export interface PipelineDeps {
  /** pHashes of all currently-accepted images, for the similarity check. */
  getExistingAcceptedHashes: () => Promise<string[]>;
}

export interface PipelineResult {
  status: "accepted" | "rejected";
  rejectionReasons: string[];
  mimeType: string | null;
  width: number | null;
  height: number | null;
  phash: string | null;
  faceCount: number | null;
  blurScore: number | null;
  /** EXIF-stripped, orientation-normalized, (converted-if-HEIC) image bytes. Present whenever the image could be decoded, regardless of accept/reject. */
  processedBuffer: Buffer | null;
}

function rejected(reasons: string[], partial: Partial<PipelineResult> = {}): PipelineResult {
  return {
    status: "rejected",
    rejectionReasons: reasons,
    mimeType: null,
    width: null,
    height: null,
    phash: null,
    faceCount: null,
    blurScore: null,
    processedBuffer: null,
    ...partial,
  };
}

/**
 * Runs the full validation pipeline, in order, against a raw uploaded file.
 *
 * Short-circuit policy: only the format check (and the HEIC-conversion /
 * decode step that depends on it) can stop the pipeline outright — without a
 * successfully decoded image there's nothing for the remaining rules to run
 * against. Once we have a decoded image, every remaining rule
 * (resolution/blur/face/similarity) runs regardless of earlier failures, and
 * all resulting reasons are collected. A stricter production system under
 * real load might stop at the first failure to save CPU; here we run
 * everything so every rejected row still has full computed metadata for
 * debugging/demo purposes, per spec.
 */
export async function runValidationPipeline(rawBuffer: Buffer, deps: PipelineDeps): Promise<PipelineResult> {
  const detected = await detectFormat(rawBuffer);
  const formatResult = checkFormat(detected);
  if (!formatResult.pass) {
    return rejected([formatResult.reason!]);
  }

  let workingBuffer = rawBuffer;
  try {
    if (isHeic(detected!)) {
      workingBuffer = await convertHeicToJpeg(rawBuffer);
    }
  } catch {
    return rejected(["Could not convert HEIC file (corrupt or unsupported variant)"]);
  }

  let decoded;
  try {
    decoded = await normalizeImage(workingBuffer);
  } catch {
    return rejected(["Corrupt or unreadable image data"]);
  }

  const reasons: string[] = [];

  const resolutionResult = checkResolution({ fileSizeBytes: rawBuffer.length, width: decoded.width, height: decoded.height });
  if (!resolutionResult.pass) reasons.push(resolutionResult.reason!);

  const blurScore = await computeBlurVariance(decoded.buffer);
  const blurResult = checkBlur(blurScore);
  if (!blurResult.pass) reasons.push(blurResult.reason!);

  const faces = await detectFaces(decoded.buffer, decoded.width, decoded.height);
  const faceResult = evaluateFaces(faces, decoded.width, decoded.height);
  if (!faceResult.pass) reasons.push(faceResult.reason!);

  const phash = await computePhash(decoded.buffer);
  const existingHashes = await deps.getExistingAcceptedHashes();
  const similarityResult = checkSimilarity(phash, existingHashes);
  if (!similarityResult.pass) reasons.push(similarityResult.reason!);

  return {
    status: reasons.length === 0 ? "accepted" : "rejected",
    rejectionReasons: reasons,
    mimeType: decoded.mimeType,
    width: decoded.width,
    height: decoded.height,
    phash,
    faceCount: faces.length,
    blurScore,
    processedBuffer: decoded.buffer,
  };
}
