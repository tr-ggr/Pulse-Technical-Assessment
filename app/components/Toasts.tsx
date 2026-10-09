"use client";

import { AnimatePresence, motion } from "motion/react";
import type { Toast } from "@/app/hooks/useToasts";

export default function Toasts({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    // The live region stays mounted so screen readers hear every new toast.
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center gap-2"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            layout
            type="button"
            onClick={() => onDismiss(t.id)}
            initial={{ opacity: 0, y: -14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.18 } }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="glass pointer-events-auto flex items-center gap-2.5 rounded-full py-2.5 pl-3.5 pr-4.5 text-sm text-ink"
          >
            <span aria-hidden className="size-1.5 rounded-full bg-ink-muted" />
            {t.text}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
