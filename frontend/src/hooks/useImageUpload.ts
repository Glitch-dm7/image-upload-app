import { useCallback, useEffect, useState } from "react";
import { deleteImage as apiDeleteImage, listImages, submitImage, validateImage } from "../api/client.js";
import { isClientAllowedFile } from "../api/clientValidation.js";
import type { RejectedItem, StagedItem, SubmittedItem, ValidatingItem } from "../types/image.js";

let tempIdCounter = 0;
function createLocalKey(): string {
  tempIdCounter += 1;
  return `local-${Date.now()}-${tempIdCounter}`;
}

export function useImageUpload() {
  const [validating, setValidating] = useState<ValidatingItem[]>([]);
  const [staged, setStaged] = useState<StagedItem[]>([]);
  const [submitted, setSubmitted] = useState<SubmittedItem[]>([]);
  const [rejected, setRejected] = useState<RejectedItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Hydrate with whatever was already submitted in a previous session, so a
  // page reload doesn't lose history.
  useEffect(() => {
    let cancelled = false;
    listImages({ limit: 50 })
      .then((page) => {
        if (cancelled) return;
        setSubmitted((current) => {
          const existingIds = new Set(current.map((item) => item.id));
          const hydrated = page.items.filter((item) => !existingIds.has(item.id)).map((r) => ({ id: r.id, originalFilename: r.originalFilename, createdAt: r.createdAt }));
          return [...current, ...hydrated].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        });
      })
      .catch(() => {
        // Non-fatal: the upload flow still works even if history can't load.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const addFiles = useCallback((files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const localKey = createLocalKey();
      const localPreviewUrl = URL.createObjectURL(file);

      if (!isClientAllowedFile(file)) {
        setRejected((current) => [
          { localKey, originalFilename: file.name, localPreviewUrl, rejectionReasons: ["Unsupported file type (only JPEG, PNG, HEIC are accepted)"] },
          ...current,
        ]);
        continue;
      }

      setValidating((current) => [{ localKey, originalFilename: file.name, localPreviewUrl }, ...current]);

      validateImage(file)
        .then((outcome) => {
          setValidating((current) => current.filter((item) => item.localKey !== localKey));
          if (outcome.status === "accepted") {
            setStaged((current) => [{ localKey, file, originalFilename: file.name, localPreviewUrl, submitting: false }, ...current]);
          } else {
            setRejected((current) => [{ localKey, originalFilename: file.name, localPreviewUrl, rejectionReasons: outcome.rejectionReasons }, ...current]);
          }
        })
        .catch((err) => {
          setValidating((current) => current.filter((item) => item.localKey !== localKey));
          setRejected((current) => [
            { localKey, originalFilename: file.name, localPreviewUrl, rejectionReasons: [err instanceof Error ? err.message : "Could not validate this file"] },
            ...current,
          ]);
        });
    }
  }, []);

  /** The X-badge action on a staged (not-yet-submitted) thumbnail. Purely local - nothing was ever persisted. */
  const unstage = useCallback((localKey: string) => {
    setStaged((current) => {
      const target = current.find((item) => item.localKey === localKey);
      if (target) URL.revokeObjectURL(target.localPreviewUrl);
      return current.filter((item) => item.localKey !== localKey);
    });
  }, []);

  const dismissRejected = useCallback((localKey: string) => {
    setRejected((current) => {
      const target = current.find((item) => item.localKey === localKey);
      if (target?.localPreviewUrl) URL.revokeObjectURL(target.localPreviewUrl);
      return current.filter((item) => item.localKey !== localKey);
    });
  }, []);

  const deleteSubmitted = useCallback(async (id: string) => {
    setSubmitted((current) => current.filter((item) => item.id !== id));
    await apiDeleteImage(id).catch(() => undefined);
  }, []);

  /**
   * Submits every currently-staged item. The server re-validates each one
   * (see services/image.service.ts) rather than trusting the earlier
   * validate call, so a rare race (e.g. someone else just submitted a
   * near-duplicate) is still possible - that one moves to Rejected instead
   * of Accepted, with the server's reason.
   */
  const submit = useCallback(async () => {
    setSubmitting(true);
    const toSubmit = staged;
    const toSubmitKeys = new Set(toSubmit.map((item) => item.localKey));
    setStaged((current) => current.map((s) => (toSubmitKeys.has(s.localKey) ? { ...s, submitting: true, submitError: undefined } : s)));

    await Promise.all(
      toSubmit.map(async (item) => {
        try {
          const result = await submitImage(item.file);
          setStaged((current) => current.filter((s) => s.localKey !== item.localKey));
          URL.revokeObjectURL(item.localPreviewUrl);
          if (result.accepted) {
            setSubmitted((current) => [{ id: result.image.id, originalFilename: result.image.originalFilename, createdAt: result.image.createdAt }, ...current]);
          } else {
            setRejected((current) => [
              { localKey: item.localKey, originalFilename: item.originalFilename, rejectionReasons: result.outcome.rejectionReasons },
              ...current,
            ]);
          }
        } catch (err) {
          setStaged((current) =>
            current.map((s) => (s.localKey === item.localKey ? { ...s, submitting: false, submitError: err instanceof Error ? err.message : "Submit failed" } : s)),
          );
        }
      }),
    );
    setSubmitting(false);
  }, [staged]);

  return { validating, staged, submitted, rejected, submitting, addFiles, unstage, dismissRejected, deleteSubmitted, submit };
}
