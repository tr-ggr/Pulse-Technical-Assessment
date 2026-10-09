"use client";

import { useState } from "react";
import { motion, useIsPresent } from "motion/react";

type Status = "idle" | "locating" | "error";

const EASE = [0.16, 1, 0.3, 1] as const;

// Staggered entrance for the gate's copy, top to bottom.
const rise = (i: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.9, delay: 0.25 + i * 0.09, ease: EASE },
});

function locationError(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return "Pulse needs your location to place your dot. Allow location for this site from your browser’s address bar, then try again.";
    case err.TIMEOUT:
      return "Finding you took too long. Move somewhere with a better signal, or try again.";
    default:
      return "We couldn’t get a fix on your location. Check that location services are on, then try again.";
  }
}

export default function EntryGate({
  onReady,
}: {
  // Rejects if we couldn't join (network / server); the gate shows a retry.
  onReady: (lat: number, lng: number) => Promise<void>;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const isPresent = useIsPresent();

  function fail(message: string) {
    setStatus("error");
    setError(message);
  }

  function enter() {
    if (!("geolocation" in navigator)) {
      fail(
        "This browser can’t share its location, so Pulse can’t place you on the globe.",
      );
      return;
    }
    setStatus("locating");
    setError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onReady(pos.coords.latitude, pos.coords.longitude).catch(() =>
          fail("Couldn’t reach Pulse. Check your connection and try again."),
        );
      },
      (err) => fail(locationError(err)),
      // High accuracy + maximumAge:0 forces a fresh fix (Wi-Fi/GPS scan)
      // instead of reusing the browser's cached IP-based location.
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  const locating = status === "locating";

  return (
    <motion.section
      aria-labelledby="gate-title"
      inert={!isPresent}
      className="pointer-events-none absolute inset-0 z-40 flex items-end md:items-center"
      exit={{
        opacity: 0,
        filter: "blur(10px)",
        transition: { duration: 0.7, ease: EASE },
      }}
    >
      {/* Scrim: lets the copy sit directly on space without a boxed card. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(to_top,var(--color-space)_38%,transparent_75%)] md:bg-[linear-gradient(to_right,var(--color-space)_22%,rgb(4_5_11/0.7)_42%,transparent_62%)]"
      />

      <div className="pointer-events-auto relative w-full max-w-xl px-6 pb-[max(2rem,env(safe-area-inset-bottom))] md:px-14 md:pb-0 lg:px-20">
        <motion.p
          {...rise(0)}
          className="flex items-center gap-2 font-mono text-label uppercase text-ink-muted"
        >
          <span className="relative flex size-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-ember/70 motion-reduce:hidden" />
            <span className="relative size-2 rounded-full bg-ember" />
          </span>
          A living globe of strangers
        </motion.p>

        <motion.h1
          {...rise(1)}
          id="gate-title"
          className="mt-4 font-display text-display text-ink"
        >
          Pulse<span className="text-ember">.</span>
        </motion.h1>

        <motion.p
          {...rise(2)}
          className="mt-5 max-w-md text-lg leading-relaxed text-ink-muted text-pretty"
        >
          Every glowing dot is a real person, somewhere, right now.{" "}
          <span className="font-display text-xl italic text-ink">
            Tap one and say hello.
          </span>
        </motion.p>

        <motion.div {...rise(3)} className="mt-9 flex items-center gap-5">
          <button
            onClick={enter}
            disabled={locating}
            className="group relative inline-flex h-14 items-center gap-3 rounded-full bg-ember pl-7 pr-6 text-[15px] font-semibold text-night-900 shadow-ember transition duration-300 ease-out-expo hover:bg-ember-bright active:scale-[0.97] disabled:cursor-progress focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:ring-offset-4 focus-visible:ring-offset-space"
          >
            {locating && (
              <span aria-hidden className="absolute inset-0 -z-10">
                <span className="radar-ring" />
                <span className="radar-ring [animation-delay:0.8s]" />
              </span>
            )}
            {locating
              ? "Finding you…"
              : status === "error"
                ? "Try again"
                : "Enter Pulse"}
            <svg
              aria-hidden
              viewBox="0 0 20 20"
              className={`size-4 transition-transform duration-300 ease-out-expo ${
                locating ? "animate-spin" : "group-hover:translate-x-0.5"
              }`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {locating ? (
                <path d="M10 2.5a7.5 7.5 0 1 1-7.5 7.5" />
              ) : (
                <path d="M4 10h11m-4.5-5 5 5-5 5" />
              )}
            </svg>
          </button>
        </motion.div>

        <div role="status" aria-live="polite" className="min-h-0">
          {status === "error" && (
            <motion.p
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-5 max-w-md rounded-2xl border border-danger/25 bg-danger/10 px-4 py-3 text-sm leading-relaxed text-[#ffc9c9]"
            >
              {error}
            </motion.p>
          )}
        </div>

        <motion.ul
          {...rise(4)}
          className="mt-10 flex flex-wrap gap-x-6 gap-y-2 font-mono text-label uppercase text-ink-faint"
        >
          <li>No accounts</li>
          <li>Nothing stored</li>
          <li>Dot offset 1–3 km</li>
        </motion.ul>
      </div>
    </motion.section>
  );
}
