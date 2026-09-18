import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement Blob URLs; useImageUpload calls these for local
// image previews, so tests need a harmless stand-in.
if (!URL.createObjectURL) {
  URL.createObjectURL = () => "blob:mock-object-url";
}
if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = () => undefined;
}
