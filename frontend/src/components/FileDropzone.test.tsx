import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileDropzone } from "./FileDropzone.js";

describe("FileDropzone", () => {
  it("renders a file picker with upload instructions", () => {
    render(<FileDropzone onFilesSelected={vi.fn()} />);
    expect(screen.getByRole("button", { name: /upload images/i })).toBeInTheDocument();
    expect(screen.getByText(/drag and drop/i)).toBeInTheDocument();
  });

  it("calls onFilesSelected when a file is chosen via the input", () => {
    const onFilesSelected = vi.fn();
    render(<FileDropzone onFilesSelected={onFilesSelected} />);

    const file = new File(["bytes"], "photo.jpg", { type: "image/jpeg" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(onFilesSelected).toHaveBeenCalledTimes(1);
    const passedFiles = onFilesSelected.mock.calls[0][0] as FileList;
    expect(passedFiles[0]?.name).toBe("photo.jpg");
  });

  it("calls onFilesSelected on drop", () => {
    const onFilesSelected = vi.fn();
    render(<FileDropzone onFilesSelected={onFilesSelected} />);

    const file = new File(["bytes"], "dropped.png", { type: "image/png" });
    fireEvent.drop(screen.getByRole("button", { name: /upload images/i }), {
      dataTransfer: { files: [file] },
    });

    expect(onFilesSelected).toHaveBeenCalledTimes(1);
  });
});
