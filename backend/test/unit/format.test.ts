import { describe, it, expect } from "vitest";
import { detectFormat, checkFormat, isHeic } from "../../src/validation/format.js";
import { readFixture as fixture } from "../helpers/fixtures.js";

describe("detectFormat", () => {
  it("identifies JPEG by magic bytes regardless of the .png extension on disk", async () => {
    const buffer = await fixture("spoofed-extension.png");
    const detected = await detectFormat(buffer);
    expect(detected?.mime).toBe("image/jpeg");
  });

  it("identifies PNG", async () => {
    const buffer = await fixture("too-small.png");
    const detected = await detectFormat(buffer);
    expect(detected?.mime).toBe("image/png");
  });

  it("returns null for non-image content", async () => {
    const buffer = await fixture("not-actually-an-image.jpg");
    const detected = await detectFormat(buffer);
    expect(detected).toBeNull();
  });
});

describe("checkFormat", () => {
  it("passes JPEG even though the fixture's extension claims PNG (extension is never trusted)", () => {
    expect(checkFormat({ ext: "jpg", mime: "image/jpeg" })).toEqual({ pass: true });
  });

  it("passes PNG", () => {
    expect(checkFormat({ ext: "png", mime: "image/png" })).toEqual({ pass: true });
  });

  it("passes HEIC", () => {
    expect(checkFormat({ ext: "heic", mime: "image/heic" }).pass).toBe(true);
  });

  it("rejects an unsupported format", () => {
    const result = checkFormat({ ext: "gif", mime: "image/gif" });
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/unsupported/i);
  });

  it("rejects when no format could be detected at all", () => {
    const result = checkFormat(null);
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/unrecognized|corrupt/i);
  });
});

describe("isHeic", () => {
  it("is true for image/heic and image/heif", () => {
    expect(isHeic({ ext: "heic", mime: "image/heic" })).toBe(true);
    expect(isHeic({ ext: "heif", mime: "image/heif" })).toBe(true);
  });

  it("is false for jpeg/png", () => {
    expect(isHeic({ ext: "jpg", mime: "image/jpeg" })).toBe(false);
  });
});
