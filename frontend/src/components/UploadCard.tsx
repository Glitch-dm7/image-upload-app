import { StatusBadge, type StatusVariant } from "./StatusBadge.js";

interface UploadCardProps {
  title: string;
  thumbnailUrl?: string;
  statusLabel: string;
  statusVariant: StatusVariant;
  rejectionReasons?: string[];
  onRemove?: () => void;
  removeLabel?: string;
}

/** Generic list row used for the Submitted and Rejected sections (and the transient Validating list). */
export function UploadCard({ title, thumbnailUrl, statusLabel, statusVariant, rejectionReasons = [], onRemove, removeLabel = "Remove" }: UploadCardProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-slate-100">
        {thumbnailUrl && <img src={thumbnailUrl} alt={title} className="h-full w-full object-cover" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-800">{title}</p>
        <div className="mt-1">
          <StatusBadge label={statusLabel} variant={statusVariant} />
        </div>
        {rejectionReasons.length > 0 && (
          <ul className="mt-1 list-inside list-disc text-xs text-rose-600">
            {rejectionReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`${removeLabel} ${title}`}
          className="shrink-0 rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          {removeLabel}
        </button>
      )}
    </div>
  );
}
