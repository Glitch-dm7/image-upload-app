import { FileDropzone } from "./components/FileDropzone.js";
import { StagedThumbnail } from "./components/StagedThumbnail.js";
import { UploadCard } from "./components/UploadCard.js";
import { getImageFileUrl } from "./api/client.js";
import { useImageUpload } from "./hooks/useImageUpload.js";

function App() {
  const { validating, staged, submitted, rejected, submitting, addFiles, unstage, dismissRejected, deleteSubmitted, submit } = useImageUpload();

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-slate-900">Image Upload & Validation</h1>
        <p className="mt-1 text-sm text-slate-500">
          Uploads are checked for format, size, blur, and faces before they're accepted. Nothing is saved until you submit it.
        </p>

        <div className="mt-6">
          <FileDropzone onFilesSelected={addFiles} />
        </div>

        {validating.length > 0 && (
          <div className="mt-6 flex flex-col gap-2">
            {validating.map((item) => (
              <UploadCard key={item.localKey} title={item.originalFilename} thumbnailUrl={item.localPreviewUrl} statusLabel="Validating…" statusVariant="busy" />
            ))}
          </div>
        )}

        <section className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-600">Accepted ({staged.length + submitted.length})</h2>
            {staged.length > 0 && (
              <button
                type="button"
                onClick={() => void submit()}
                disabled={submitting}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
              >
                {submitting ? "Submitting…" : `Submit ${staged.length}`}
              </button>
            )}
          </div>

          {staged.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-3">
              {staged.map((item) => (
                <StagedThumbnail key={item.localKey} item={item} onUnstage={unstage} />
              ))}
            </div>
          )}

          <div className="mt-3 flex flex-col gap-2">
            {staged.length === 0 && submitted.length === 0 && <p className="text-sm text-slate-400">Nothing here yet.</p>}
            {submitted.map((item) => (
              <UploadCard
                key={item.id}
                title={item.originalFilename}
                thumbnailUrl={getImageFileUrl(item.id)}
                statusLabel="Submitted"
                statusVariant="success"
                onRemove={() => void deleteSubmitted(item.id)}
                removeLabel="Delete"
              />
            ))}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-slate-600">Rejected ({rejected.length})</h2>
          <div className="mt-3 flex flex-col gap-2">
            {rejected.length === 0 && <p className="text-sm text-slate-400">Nothing here yet.</p>}
            {rejected.map((item) => (
              <UploadCard
                key={item.localKey}
                title={item.originalFilename}
                thumbnailUrl={item.localPreviewUrl}
                statusLabel="Rejected"
                statusVariant="error"
                rejectionReasons={item.rejectionReasons}
                onRemove={() => dismissRejected(item.localKey)}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export default App;
