import { useMemo, useState } from "react";
import { FileDropzone } from "./components/FileDropzone.js";
import { UploadCard } from "./components/UploadCard.js";
import { useImageUpload } from "./hooks/useImageUpload.js";

type Tab = "accepted" | "rejected";

function App() {
  const { items, addFiles, removeItem } = useImageUpload();
  const [tab, setTab] = useState<Tab>("accepted");

  const inProgress = useMemo(() => items.filter((item) => item.status === "uploading" || item.status === "pending"), [items]);
  const accepted = useMemo(() => items.filter((item) => item.status === "accepted"), [items]);
  const rejected = useMemo(() => items.filter((item) => item.status === "rejected" || item.status === "client-rejected"), [items]);

  const visible = tab === "accepted" ? accepted : rejected;

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-slate-900">Image Upload & Validation</h1>
        <p className="mt-1 text-sm text-slate-500">
          Uploads are checked for format, size, blur, and faces on the server before being accepted.
        </p>

        <div className="mt-6">
          <FileDropzone onFilesSelected={addFiles} />
        </div>

        {inProgress.length > 0 && (
          <div className="mt-6">
            <h2 className="mb-2 text-sm font-semibold text-slate-600">In progress</h2>
            <div className="flex flex-col gap-2">
              {inProgress.map((item) => (
                <UploadCard key={item.localKey} item={item} onRemove={removeItem} />
              ))}
            </div>
          </div>
        )}

        <div className="mt-8">
          <div className="flex gap-1 border-b border-slate-200" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "accepted"}
              onClick={() => setTab("accepted")}
              className={`px-4 py-2 text-sm font-medium ${
                tab === "accepted" ? "border-b-2 border-indigo-600 text-indigo-600" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Accepted ({accepted.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "rejected"}
              onClick={() => setTab("rejected")}
              className={`px-4 py-2 text-sm font-medium ${
                tab === "rejected" ? "border-b-2 border-indigo-600 text-indigo-600" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Rejected ({rejected.length})
            </button>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            {visible.length === 0 && <p className="text-sm text-slate-400">Nothing here yet.</p>}
            {visible.map((item) => (
              <UploadCard key={item.localKey} item={item} onRemove={removeItem} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
