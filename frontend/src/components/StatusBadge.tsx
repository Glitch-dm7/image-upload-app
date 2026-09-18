import type { UploadItem } from "../types/image.js";

const LABELS: Record<UploadItem["status"], string> = {
  uploading: "Uploading…",
  pending: "Processing…",
  accepted: "Accepted",
  rejected: "Rejected",
  "client-rejected": "Rejected",
};

const CLASSES: Record<UploadItem["status"], string> = {
  uploading: "bg-slate-100 text-slate-600",
  pending: "bg-amber-100 text-amber-700",
  accepted: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
  "client-rejected": "bg-rose-100 text-rose-700",
};

export function StatusBadge({ status }: { status: UploadItem["status"] }) {
  const isBusy = status === "uploading" || status === "pending";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${CLASSES[status]}`}>
      {isBusy && (
        <span
          className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
          role="status"
          aria-label="processing"
        />
      )}
      {LABELS[status]}
    </span>
  );
}
