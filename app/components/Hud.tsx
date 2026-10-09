"use client";

import { motion } from "motion/react";
import { useSoundOn } from "../hooks/useSoundOn";
import { playSound, setSoundOn } from "@/lib/sound";

const EASE = [0.16, 1, 0.3, 1] as const;

export default function Hud({
  online,
  onRecenter,
}: {
  online: number;
  onRecenter: () => void;
}) {
  const soundOn = useSoundOn();

  function toggleSound() {
    setSoundOn(!soundOn);
    // Confirm with a sound only when there's sound to hear.
    if (!soundOn) playSound("toggleOn");
  }

  return (
    <>
      {/* Soft vignette so the HUD reads over busy map labels. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-32 bg-gradient-to-b from-space/80 via-space/30 to-transparent"
      />
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.6, ease: EASE }}
        className="pointer-events-none absolute left-0 top-0 z-20 flex items-center gap-3 pl-[max(1rem,env(safe-area-inset-left))] pt-[max(1rem,env(safe-area-inset-top))] md:gap-4 md:pl-6 md:pt-5"
      >
        <p className="font-display text-[26px] leading-none text-ink md:text-[30px]">
          Pulse<span className="text-ember">.</span>
        </p>

        <p className="glass flex h-9 items-center gap-2 rounded-full pl-3 pr-3.5 font-mono text-xs text-ink-muted">
          <span aria-hidden className="relative flex size-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-[hsl(180,85%,68%)]/60 [animation-duration:2.4s] motion-reduce:hidden" />
            <span className="relative size-2 rounded-full bg-[hsl(180,85%,68%)]" />
          </span>
          {online === 0 ? (
            "Just you, for now"
          ) : (
            <span>
              <span className="tabular-nums text-ink">{online}</span> online
            </span>
          )}
        </p>

        <button
          type="button"
          onClick={onRecenter}
          aria-label="Recenter on me"
          title="Recenter on me"
          className="glass pointer-events-auto grid size-9 place-items-center rounded-full text-ink-muted transition hover:text-ember focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/70 pointer-coarse:size-11"
        >
          <svg
            viewBox="0 0 20 20"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          >
            <circle cx="10" cy="10" r="5.5" />
            <circle cx="10" cy="10" r="1.6" fill="currentColor" stroke="none" />
            <path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3" />
          </svg>
        </button>

        <button
          type="button"
          onClick={toggleSound}
          aria-pressed={soundOn}
          aria-label="Sound"
          title={soundOn ? "Turn sound off" : "Turn sound on"}
          data-sound="none"
          className="glass pointer-events-auto grid size-9 place-items-center rounded-full text-ink-muted transition hover:text-ember focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/70 pointer-coarse:size-11"
        >
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 8v4h3l4.5 3.5v-11L6 8H3Z" />
            {soundOn ? (
              <path d="M13.5 7.5a3.5 3.5 0 0 1 0 5M15.5 5a7 7 0 0 1 0 10" />
            ) : (
              <path d="m13.5 7.5 5 5M18.5 7.5l-5 5" />
            )}
          </svg>
        </button>
      </motion.header>
    </>
  );
}
