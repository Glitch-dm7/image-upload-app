import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.js";
import * as apiClient from "./api/client.js";

vi.mock("./api/client.js", () => ({
  uploadImage: vi.fn(),
  getImage: vi.fn(),
  listImages: vi.fn(),
  deleteImage: vi.fn(),
  getImageFileUrl: (id: string) => `https://fake-storage.test/${id}`,
}));

const mockedApi = vi.mocked(apiClient);

// user-event's `upload()` emulates a real OS file picker and filters out
// files that don't match the input's `accept` attribute - which is exactly
// what we need for a JPEG/PNG upload, but would silently swallow the
// disallowed-extension test case below. Plain fireEvent bypasses that
// emulation, matching what actually happens if a user drags in an
// arbitrary file (drag-and-drop isn't filtered by `accept` in real browsers).
function selectFile(input: HTMLInputElement, file: File) {
  fireEvent.change(input, { target: { files: [file] } });
}

// Every render kicks off useImageUpload's history-hydration call
// (listImages) as a side effect. Waiting for it up front keeps that
// resolution from landing in the middle of a later assertion/timer
// advance, where React would otherwise warn about an update outside act().
async function renderApp() {
  const result = render(<App />);
  await waitFor(() => expect(mockedApi.listImages).toHaveBeenCalled());
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.listImages.mockResolvedValue({ items: [], nextCursor: null });
});

describe("App upload flow", () => {
  it("renders the upload area and the Accepted/Rejected tabs", async () => {
    await renderApp();
    expect(screen.getByRole("button", { name: /upload images/i })).toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: /accepted/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /rejected/i })).toBeInTheDocument();
  });

  it("accepts a valid file, uploads it, and shows it as processing", async () => {
    mockedApi.uploadImage.mockResolvedValue({ id: "server-id-1", status: "pending" });
    mockedApi.getImage.mockResolvedValue({
      id: "server-id-1",
      originalFilename: "photo.jpg",
      mimeType: "image/jpeg",
      fileSizeBytes: 1000,
      width: 800,
      height: 800,
      status: "pending",
      rejectionReasons: [],
      phash: null,
      faceCount: null,
      blurScore: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await renderApp();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["bytes"], "photo.jpg", { type: "image/jpeg" });

    await selectFile(input, file);

    expect(await screen.findByText("photo.jpg")).toBeInTheDocument();
    await waitFor(() => expect(mockedApi.uploadImage).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/processing/i)).toBeInTheDocument();
  });

  it("shows the disallowed-extension message client-side, without calling the upload API", async () => {
    await renderApp();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["not an image"], "notes.txt", { type: "text/plain" });

    await selectFile(input, file);

    // Rejected items (client- or server-side) live under the Rejected tab.
    await userEvent.setup({ delay: null }).click(screen.getByRole("tab", { name: /rejected/i }));

    expect(await screen.findByText(/unsupported file type/i)).toBeInTheDocument();
    expect(mockedApi.uploadImage).not.toHaveBeenCalled();
  });
});

describe("status polling", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("transitions a card from processing to accepted once polling sees the final status", async () => {
    mockedApi.uploadImage.mockResolvedValue({ id: "server-id-2", status: "pending" });
    mockedApi.getImage.mockResolvedValueOnce({
      id: "server-id-2",
      originalFilename: "photo.jpg",
      mimeType: "image/jpeg",
      fileSizeBytes: 1000,
      width: 800,
      height: 800,
      status: "accepted",
      rejectionReasons: [],
      phash: "abc",
      faceCount: 0,
      blurScore: 500,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await renderApp();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["bytes"], "photo.jpg", { type: "image/jpeg" });
    const user = userEvent.setup({ delay: null });

    await user.upload(input, file);
    await vi.waitFor(() => expect(mockedApi.uploadImage).toHaveBeenCalledTimes(1));

    expect(screen.getByText(/processing/i)).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(1600);

    await vi.waitFor(() => expect(screen.queryByText(/processing/i)).not.toBeInTheDocument());
    expect(screen.getByText(/^accepted$/i)).toBeInTheDocument();
  });
});
