import type { StagedItem } from "../types/image.js";

interface StagedThumbnailProps {
  item: StagedItem;
  onUnstage: (localKey: string) => void;
}

/** An accepted-but-not-yet-submitted photo: a thumbnail with an X badge to drop it from the batch before hitting Submit. */
export function StagedThumbnail({ item, onUnstage }: StagedThumbnailProps) {
  return (
    <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
      <img src={item.localPreviewUrl} alt={item.originalFilename} className="h-full w-full object-cover" />

      {item.submitting ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" role="status" aria-label="submitting" />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onUnstage(item.localKey)}
          aria-label={`Remove ${item.originalFilename}`}
          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-sm leading-none text-white hover:bg-black"
        >
          &times;
        </button>
      )}

      {item.submitError && (
        <p className="absolute inset-x-0 bottom-0 truncate bg-rose-600/90 px-1 py-0.5 text-[10px] text-white" title={item.submitError}>
          {item.submitError}
        </p>
      )}
    </div>
  );
}
