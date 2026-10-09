"use client";

import { useCallback, useRef, useState } from "react";

export interface Toast {
  id: number;
  text: string;
}

const TOAST_MS = 4000;
const MAX_TOASTS = 3;

// A small stack of transient notices. Re-pushing the same text replaces the
// old copy (no duplicate "Stranger disconnected." lines stacking up).
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (text: string) => {
      const id = nextId.current++;
      setToasts((prev) =>
        [...prev.filter((t) => t.text !== text), { id, text }].slice(
          -MAX_TOASTS,
        ),
      );
      window.setTimeout(() => dismiss(id), TOAST_MS);
    },
    [dismiss],
  );

  return { toasts, push, dismiss };
}
