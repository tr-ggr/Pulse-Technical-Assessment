"use client";

import { useId } from "react";
import { motion, useIsPresent } from "motion/react";
import StrangerOrb from "./StrangerOrb";
import type { Stranger } from "@/lib/identity";
import { REQUEST_TIMEOUT_MS } from "@/lib/presence";

// "A stranger wants to connect": floats at the top on desktop, docks to the
// bottom (thumb reach) on phones. Non-modal — the globe stays explorable, and
// the arc on the map shows where the request is coming from.
export default function RequestCard({
  stranger,
  onAccept,
  onDecline,
  onBlock,
}: {
  stranger: Stranger;
  onAccept: () => void;
  onDecline: () => void;
  onBlock: () => void;
}) {
  const isPresent = useIsPresent();
  const titleId = useId();
  const metaId = useId();
  const meta = [stranger.distanceLabel, stranger.direction]
    .filter(Boolean)
    .join(" · ");

  return (
    <motion.div
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={meta ? metaId : undefined}
      inert={!isPresent}
      initial={{ opacity: 0, y: 24, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.97, transition: { duration: 0.22 } }}
      transition={{ type: "spring", stiffness: 340, damping: 30 }}
      className="glass absolute inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 rounded-card p-5 md:inset-x-auto md:bottom-auto md:left-1/2 md:top-5 md:w-[380px] md:-translate-x-1/2 md:p-6"
    >
      <div className="flex items-start gap-4">
        <StrangerOrb
          stranger={stranger}
          size={56}
          countdownMs={REQUEST_TIMEOUT_MS}
        />
        <div className="min-w-0 pt-0.5">
          <p className="font-mono text-label uppercase text-ink-faint">
            Incoming
          </p>
          <h2
            id={titleId}
            className="mt-1 font-display text-title text-ink text-balance"
          >
            A stranger wants to connect
          </h2>
          {meta && (
            <p id={metaId} className="mt-1.5 text-sm text-ink-muted">
              {meta}
            </p>
          )}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onDecline}
          className="h-12 rounded-full border border-hairline-strong text-sm font-medium text-ink-muted transition hover:border-ink-faint hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/70"
        >
          Decline
        </button>
        <button
          type="button"
          onClick={onAccept}
          autoFocus
          className="h-12 rounded-full bg-ember text-sm font-semibold text-night-900 shadow-ember transition hover:bg-ember-bright active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:ring-offset-2 focus-visible:ring-offset-night-900"
        >
          Accept
        </button>
      </div>
      {/* For the stranger who keeps asking: decline and never hear from them. */}
      <button
        type="button"
        onClick={onBlock}
        className="mx-auto mt-3 block rounded-full px-3 py-1.5 text-xs text-ink-faint transition hover:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/70"
      >
        Block this stranger
      </button>
    </motion.div>
  );
}
