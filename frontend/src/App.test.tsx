import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.js";
import * as apiClient from "./api/client.js";

vi.mock("./api/client.js", () => ({
  validateImage: vi.fn(),
  submitImage: vi.fn(),
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
function selectFiles(input: HTMLInputElement, files: File[]) {
  fireEvent.change(input, { target: { files } });
}

const acceptedOutcome = {
  status: "accepted" as const,
  rejectionReasons: [] as string[],
  width: 800,
  height: 800,
  phash: "abc123",
  faceCount: 0,
  blurScore: 500,
  mimeType: "image/jpeg",
};

// Every render kicks off useImageUpload's history-hydration call
// (listImages) as a side effect. Waiting for it up front keeps that
// resolution from landing in the middle of a later assertion, where React
// would otherwise warn about an update outside act().
async function renderApp() {
  const result = render(<App />);
  await waitFor(() => expect(mockedApi.listImages).toHaveBeenCalled());
  return result;
}

function getFileInput() {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.listImages.mockResolvedValue({ items: [], nextCursor: null });
});

describe("App layout", () => {
  it("renders the upload area and the Accepted/Rejected sections on one page", async () => {
    await renderApp();
    expect(screen.getByRole("button", { name: /upload images/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /accepted \(0\)/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /rejected \(0\)/i })).toBeInTheDocument();
  });
});

describe("validate-before-submit flow", () => {
  it("validates a dropped file and stages it as accepted, with a Submit button", async () => {
    mockedApi.validateImage.mockResolvedValue(acceptedOutcome);
    await renderApp();

    const file = new File(["bytes"], "photo.jpg", { type: "image/jpeg" });
    selectFiles(getFileInput(), [file]);

    expect(await screen.findByRole("button", { name: /remove photo\.jpg/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^submit 1$/i })).toBeInTheDocument();
    expect(mockedApi.submitImage).not.toHaveBeenCalled();
  });

  it("shows the disallowed-extension message client-side, without calling validateImage", async () => {
    await renderApp();

    const file = new File(["not an image"], "notes.txt", { type: "text/plain" });
    selectFiles(getFileInput(), [file]);

    expect(await screen.findByText(/unsupported file type/i)).toBeInTheDocument();
    expect(mockedApi.validateImage).not.toHaveBeenCalled();
  });

  it("shows a server rejection reason for a dropped file that fails validation", async () => {
    mockedApi.validateImage.mockResolvedValue({ ...acceptedOutcome, status: "rejected", rejectionReasons: ["Image is too blurry"] });
    await renderApp();

    selectFiles(getFileInput(), [new File(["bytes"], "blurry.jpg", { type: "image/jpeg" })]);

    expect(await screen.findByText("Image is too blurry")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^submit/i })).not.toBeInTheDocument();
  });
});

describe("unstage then submit", () => {
  it("only submits the file that wasn't unstaged, and moves it to Submitted", async () => {
    mockedApi.validateImage.mockResolvedValue(acceptedOutcome);
    await renderApp();

    const keep = new File(["keep"], "keep.jpg", { type: "image/jpeg" });
    const drop = new File(["drop"], "drop.jpg", { type: "image/jpeg" });
    selectFiles(getFileInput(), [keep, drop]);

    await screen.findByRole("button", { name: /remove keep\.jpg/i });
    await screen.findByRole("button", { name: /remove drop\.jpg/i });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /remove drop\.jpg/i }));
    expect(screen.queryByRole("button", { name: /remove drop\.jpg/i })).not.toBeInTheDocument();

    mockedApi.submitImage.mockResolvedValue({
      accepted: true,
      image: {
        id: "server-1",
        originalFilename: "keep.jpg",
        mimeType: "image/jpeg",
        fileSizeBytes: 4,
        width: 800,
        height: 800,
        status: "accepted",
        rejectionReasons: [],
        phash: "abc123",
        faceCount: 0,
        blurScore: 500,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    await user.click(screen.getByRole("button", { name: /^submit 1$/i }));

    await waitFor(() => expect(mockedApi.submitImage).toHaveBeenCalledTimes(1));
    expect(mockedApi.submitImage).toHaveBeenCalledWith(keep);
    expect(await screen.findByText(/^submitted$/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove keep\.jpg/i })).not.toBeInTheDocument();
  });
});
