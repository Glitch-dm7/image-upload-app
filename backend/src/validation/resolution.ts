import { thresholds } from "../config.js";
import type { RuleResult } from "./types.js";

export interface ResolutionInput {
  fileSizeBytes: number;
  width: number;
  height: number;
}

/**
 * Pure function — takes already-known numbers, no image buffer or IO. This
 * keeps the rule itself trivially unit-testable without fixture images.
 */
export function checkResolution(
  input: ResolutionInput,
  config: Pick<typeof thresholds, "minFileSizeBytes" | "minWidthPx" | "minHeightPx"> = thresholds,
): RuleResult {
  if (input.fileSizeBytes < config.minFileSizeBytes) {
    return { pass: false, reason: `File size ${input.fileSizeBytes}B is below the ${config.minFileSizeBytes}B minimum` };
  }
  if (input.width < config.minWidthPx || input.height < config.minHeightPx) {
    return {
      pass: false,
      reason: `Image dimensions ${input.width}x${input.height} are below the ${config.minWidthPx}x${config.minHeightPx} minimum`,
    };
  }
  return { pass: true };
}
