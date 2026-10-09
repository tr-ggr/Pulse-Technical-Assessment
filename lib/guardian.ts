// Guardian: an on-device check of the *incoming* video once both cameras are
// revealed. A small image classifier (nsfwjs MobileNetV2, served from our own
// origin) samples a frame about once a second; if two samples in a row look
// explicit, the stage veils itself locally and asks you what to do. No frame,
// score or verdict ever leaves the browser, and the stranger isn't told.
//
// TensorFlow.js and the model are loaded lazily, the first time a call
// starts, so nobody pays for them just to look at the map.

import type { NSFWJS } from "nsfwjs/core";

export const GUARDIAN_MODEL_URL = "/models/nsfw/model.json";
export const GUARDIAN_INTERVAL_MS = 1_000;
// Probability mass on the explicit classes (Porn + Hentai) that counts as a hit.
export const EXPLICIT_THRESHOLD = 0.6;
// Consecutive hits needed, so one odd frame (a blur, a thumb over the lens)
// doesn't slam the veil down mid-conversation.
export const CONSECUTIVE_HITS = 2;

const EXPLICIT_CLASSES = new Set(["Porn", "Hentai"]);

export interface Prediction {
  className: string;
  probability: number;
}

export function explicitScore(predictions: Prediction[]): number {
  return predictions
    .filter((p) => EXPLICIT_CLASSES.has(p.className))
    .reduce((sum, p) => sum + p.probability, 0);
}

// True when the most recent CONSECUTIVE_HITS scores are all over the line.
export function shouldVeil(scores: number[]): boolean {
  if (scores.length < CONSECUTIVE_HITS) return false;
  return scores
    .slice(-CONSECUTIVE_HITS)
    .every((score) => score >= EXPLICIT_THRESHOLD);
}

let modelPromise: Promise<NSFWJS> | null = null;

// One model per tab, shared across calls. A failure (no WebGL, blocked
// download) rejects, and the next call may try again.
export function loadGuardian(): Promise<NSFWJS> {
  modelPromise ??= (async () => {
    const tf = await import("@tensorflow/tfjs");
    // WebGL keeps a 224 px inference to a few ms; the CPU backend still
    // works at one frame a second, just slower. No WASM: it would need
    // 'wasm-unsafe-eval' in the CSP.
    if (!(await tf.setBackend("webgl").catch(() => false))) {
      await tf.setBackend("cpu");
    }
    await tf.ready();
    const { load } = await import("nsfwjs/core");
    return load(GUARDIAN_MODEL_URL, { size: 224 });
  })().catch((err) => {
    modelPromise = null;
    throw err;
  });
  return modelPromise;
}

// Samples `video` until stopped. Calls onHit once per run of explicit frames.
export function watchVideo(
  model: NSFWJS,
  video: HTMLVideoElement,
  onHit: () => void,
): () => void {
  let stopped = false;
  let busy = false;
  let scores: number[] = [];

  const timer = setInterval(async () => {
    // Skip while hidden (nobody's looking) and before frames arrive.
    if (busy || document.hidden || video.readyState < 2 || !video.videoWidth) {
      return;
    }
    busy = true;
    try {
      const predictions = await model.classify(video);
      if (stopped) return;
      scores = [...scores, explicitScore(predictions)].slice(-CONSECUTIVE_HITS);
      if (shouldVeil(scores)) {
        scores = [];
        onHit();
      }
    } catch {
      // A frame that can't be read (track swapping, element detached) is
      // simply skipped.
    } finally {
      busy = false;
    }
  }, GUARDIAN_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
