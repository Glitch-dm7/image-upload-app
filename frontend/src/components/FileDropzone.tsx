import { useRef, useState } from "react";
import type { DragEvent } from "react";

interface FileDropzoneProps {
  onFilesSelected: (files: FileList) => void;
}

export function FileDropzone({ onFilesSelected }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingOver(false);
    if (event.dataTransfer.files.length > 0) onFilesSelected(event.dataTransfer.files);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload images"
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingOver(true);
      }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={handleDrop}
      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
        isDraggingOver ? "border-indigo-500 bg-indigo-50" : "border-slate-300 bg-slate-50 hover:border-slate-400"
      }`}
    >
      <p className="text-sm font-medium text-slate-700">Drag and drop images here, or click to browse</p>
      <p className="text-xs text-slate-500">JPEG, PNG, or HEIC</p>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) onFilesSelected(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
