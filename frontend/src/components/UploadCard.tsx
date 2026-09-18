import { getImageFileUrl } from "../api/client.js";
import type { UploadItem } from "../types/image.js";
import { StatusBadge } from "./StatusBadge.js";

interface UploadCardProps {
  item: UploadItem;
  onRemove: (localKey: string) => void;
}

export function UploadCard({ item, onRemove }: UploadCardProps) {
  // Prefer the local object-URL preview until the server has a permanently
  // stored, accepted file to show instead.
  const imageSrc = item.status === "accepted" && !item.id.startsWith("local-") ? getImageFileUrl(item.id) : item.localPreviewUrl;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-slate-100">
        {imageSrc && <img src={imageSrc} alt={item.originalFilename} className="h-full w-full object-cover" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-800">{item.originalFilename}</p>
        <div className="mt-1">
          <StatusBadge status={item.status} />
        </div>
        {item.rejectionReasons.length > 0 && (
          <ul className="mt-1 list-inside list-disc text-xs text-rose-600">
            {item.rejectionReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        onClick={() => onRemove(item.localKey)}
        aria-label={`Remove ${item.originalFilename}`}
        className="shrink-0 rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      >
        Remove
      </button>
    </div>
  );
}
