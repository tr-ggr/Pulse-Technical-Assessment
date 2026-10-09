"use client";

import { useEffect, useState, type RefObject } from "react";
import type { NSFWJS } from "nsfwjs/core";
import { loadGuardian, watchVideo } from "@/lib/guardian";

export type GuardianStatus = "loading" | "on" | "paused" | "unavailable";

// Runs the Guardian over the stranger's video for one call. The model starts
// loading as soon as the call stage opens, so it's ready by the time you
// both reveal; it only samples while `watching` (revealed, camera on).
//
// It fails open: no WebGL or a blocked download means "unavailable", shown
// as such, and the call carries on — the veil and consent still apply.
export function useGuardian(
  video: RefObject<HTMLVideoElement | null>,
  watching: boolean,
) {
  const [model, setModel] = useState<NSFWJS | null>(null);
  const [failed, setFailed] = useState(false);
  const [flagged, setFlagged] = useState(false);
  // "Show anyway" is your call for the rest of this video session.
  const [trusted, setTrusted] = useState(false);

  useEffect(() => {
    let live = true;
    loadGuardian().then(
      (m) => live && setModel(m),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const el = video.current;
    if (!model || !el || !watching || trusted || flagged) return;
    return watchVideo(model, el, () => setFlagged(true));
  }, [model, video, watching, trusted, flagged]);

  const status: GuardianStatus = failed
    ? "unavailable"
    : !model
      ? "loading"
      : trusted
        ? "paused"
        : "on";

  return {
    status,
    flagged,
    // Back to normal sampling (e.g. after you re-veil both cameras).
    clear: () => setFlagged(false),
    showAnyway: () => {
      setFlagged(false);
      setTrusted(true);
    },
  };
}
