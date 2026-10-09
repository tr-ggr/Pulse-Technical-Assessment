"use client";

import { motion, useIsPresent } from "motion/react";
import StrangerOrb from "./StrangerOrb";
import type { Stranger } from "@/lib/identity";
import { REQUEST_TIMEOUT_MS } from "@/lib/presence";

// Shown while your request is out: who you asked, how far away they are,
// how long they have left to answer, and a way to take it back.
export default function RequestingPill({
  stranger,
  onCancel,
}: {
  stranger: Stranger;
  onCancel: () => void;
}) {
  const isPresent = useIsPresent();
  return (
    <motion.div
      inert={!isPresent}
      initial={{ opacity: 0, y: -14, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.96, transition: { duration: 0.2 } }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      className="glass pointer-events-auto flex items-center gap-3 rounded-full py-2 pl-2 pr-2"
    >
      <StrangerOrb
        stranger={stranger}
        size={36}
        countdownMs={REQUEST_TIMEOUT_MS}
      />
      <div className="min-w-0 pr-1 leading-tight">
        <p className="text-sm font-medium text-ink">
          <span>Requesting connection…</span>
        </p>
        {stranger.distanceLabel && (
          <p className="mt-0.5 font-mono text-[11px] text-ink-muted">
            {stranger.distanceLabel}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="h-9 rounded-full border border-hairline-strong px-4 text-[13px] font-medium text-ink-muted transition hover:border-ink-faint hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/70 pointer-coarse:h-11"
      >
        Cancel
      </button>
    </motion.div>
  );
}
