export type StatusVariant = "busy" | "success" | "error";

const CLASSES: Record<StatusVariant, string> = {
  busy: "bg-amber-100 text-amber-700",
  success: "bg-emerald-100 text-emerald-700",
  error: "bg-rose-100 text-rose-700",
};

export function StatusBadge({ label, variant }: { label: string; variant: StatusVariant }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${CLASSES[variant]}`}>
      {variant === "busy" && (
        <span
          className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
          role="status"
          aria-label="processing"
        />
      )}
      {label}
    </span>
  );
}
