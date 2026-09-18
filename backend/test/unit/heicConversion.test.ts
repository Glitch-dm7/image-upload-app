import { describe, it, expect, vi } from "vitest";

// No real .heic fixture ships in this repo - sharp's prebuilt binaries don't
// include an HEIC/H.265 encoder (patent-encumbered, excluded from the
// default build), so there's no simple way to generate a valid one here.
// This test only verifies the wrapper's plumbing (it calls `convert` with
// the right shape of args and returns a Buffer) via a mock; the real
// conversion path is exercised manually against an actual phone photo
// before each deploy - see README.
vi.mock("heic-convert", () => ({
  default: vi.fn(async ({ buffer }: { buffer: Buffer }) => new Uint8Array(Buffer.concat([Buffer.from("JPEG:"), buffer]))),
}));

describe("convertHeicToJpeg", () => {
  it("delegates to heic-convert and returns a Buffer", async () => {
    const { convertHeicToJpeg } = await import("../../src/validation/heicConversion.js");
    const input = Buffer.from("fake-heic-bytes");
    const output = await convertHeicToJpeg(input);
    expect(Buffer.isBuffer(output)).toBe(true);
    expect(output.toString()).toBe("JPEG:fake-heic-bytes");
  });
});
