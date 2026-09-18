import { useCallback, useEffect, useRef, useState } from "react";
import { deleteImage as apiDeleteImage, getImage, listImages, uploadImage } from "../api/client.js";
import { isClientAllowedFile } from "../api/clientValidation.js";
import type { ImageRecord, UploadItem } from "../types/image.js";

// Polling instead of WebSockets/SSE: simpler, and resilient to free-tier
// connection drops, at the cost of a little latency + some wasted requests.
// See README for the fuller tradeoff writeup.
const POLL_INTERVAL_MS = 1500;

let tempIdCounter = 0;
function createTempId(): string {
  tempIdCounter += 1;
  return `local-${Date.now()}-${tempIdCounter}`;
}

function imageRecordToUploadItem(record: ImageRecord): UploadItem {
  return {
    id: record.id,
    localKey: record.id,
    originalFilename: record.originalFilename,
    status: record.status,
    rejectionReasons: record.rejectionReasons,
    createdAt: record.createdAt,
  };
}

export function useImageUpload() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const itemsRef = useRef<UploadItem[]>(items);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Hydrate with whatever the server already knows about, so a page reload
  // doesn't lose history. Only brand-new uploads made in this session start
  // out purely client-side (a local id + object-URL preview) before the
  // server has assigned them a real id.
  useEffect(() => {
    let cancelled = false;
    listImages({ limit: 50 })
      .then((page) => {
        if (cancelled) return;
        setItems((current) => {
          const existingIds = new Set(current.map((item) => item.id));
          const hydrated = page.items.filter((item) => !existingIds.has(item.id)).map(imageRecordToUploadItem);
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

  const updateItem = useCallback((localKey: string, patch: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.localKey === localKey ? { ...item, ...patch } : item)));
  }, []);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        const localKey = createTempId();
        const localPreviewUrl = URL.createObjectURL(file);
        const createdAt = new Date().toISOString();

        if (!isClientAllowedFile(file)) {
          setItems((current) => [
            {
              id: localKey,
              localKey,
              originalFilename: file.name,
              localPreviewUrl,
              status: "client-rejected",
              rejectionReasons: ["Unsupported file type (only JPEG, PNG, HEIC are accepted)"],
              createdAt,
            },
            ...current,
          ]);
          continue;
        }

        setItems((current) => [
          { id: localKey, localKey, originalFilename: file.name, localPreviewUrl, status: "uploading", rejectionReasons: [], createdAt },
          ...current,
        ]);

        uploadImage(file)
          .then(({ id }) => updateItem(localKey, { id, status: "pending" }))
          .catch((err) => {
            updateItem(localKey, { status: "rejected", rejectionReasons: [err instanceof Error ? err.message : "Upload failed"] });
          });
      }
    },
    [updateItem],
  );

  const removeItem = useCallback(async (localKey: string) => {
    const target = itemsRef.current.find((item) => item.localKey === localKey);
    if (!target) return;
    if (target.localPreviewUrl) URL.revokeObjectURL(target.localPreviewUrl);
    setItems((current) => current.filter((item) => item.localKey !== localKey));
    if (!target.id.startsWith("local-")) {
      await apiDeleteImage(target.id).catch(() => undefined);
    }
  }, []);

  // Poll every still-pending, server-known item until it leaves "pending".
  useEffect(() => {
    const interval = setInterval(() => {
      const pending = itemsRef.current.filter((item) => item.status === "pending" && !item.id.startsWith("local-"));
      for (const item of pending) {
        getImage(item.id)
          .then((record) => {
            if (record.status !== "pending") {
              updateItem(item.localKey, { status: record.status, rejectionReasons: record.rejectionReasons });
            }
          })
          .catch(() => undefined);
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [updateItem]);

  return { items, addFiles, removeItem };
}
