"use client";

import { useEffect } from "react";
import { playSound, primeAudio, type SoundName } from "@/lib/sound";

const CLICKABLE = 'button, [role="button"], a[href], summary';

// One listener for every button in the app, including the map dots Mapbox
// owns outside React. `data-sound="none"` silences an element, and
// `data-sound="<name>"` gives it its own sound instead of the default tap.
export function useInteractionSounds() {
  useEffect(() => {
    const target = (e: Event) =>
      e.target instanceof Element
        ? e.target.closest<HTMLElement>(CLICKABLE)
        : null;

    const onClick = (e: MouseEvent) => {
      const el = target(e);
      if (!el || el.getAttribute("aria-disabled") === "true") return;
      // Every click is a user gesture, so it can unlock audio on its own.
      primeAudio();
      const custom = el.dataset.sound;
      if (custom === "none") return;
      if (custom) return playSound(custom as SoundName);
      // Capture phase runs before the element's own handler, so this is the
      // state being left.
      const pressed = el.getAttribute("aria-pressed");
      if (pressed !== null) {
        playSound(pressed === "true" ? "toggleOff" : "toggleOn");
      } else {
        playSound("tap");
      }
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const el = target(e);
      if (!el || el.dataset.sound === "none") return;
      // Moving between a button's own children isn't a new hover.
      const from =
        e.relatedTarget instanceof Element
          ? e.relatedTarget.closest(CLICKABLE)
          : null;
      if (from === el) return;
      if ((el as HTMLButtonElement).disabled) return;
      playSound("hover");
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("pointerover", onOver, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("pointerover", onOver, true);
    };
  }, []);
}
