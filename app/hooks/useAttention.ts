"use client";

import { useEffect } from "react";

const FLASH_MS = 1000;

// While `message` is set and the tab is hidden, alternate the tab title with
// it so a waiting request is visible from the tab strip. Restores the title
// as soon as the tab is focused or the request goes away.
export function useAttention(message: string | null): void {
  useEffect(() => {
    if (!message) return;
    const original = document.title;
    let timer: ReturnType<typeof setInterval> | undefined;
    let showing = false;

    const stop = () => {
      clearInterval(timer);
      timer = undefined;
      document.title = original;
    };
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        showing = !showing;
        document.title = showing ? message : original;
      }, FLASH_MS);
    };
    const sync = () => (document.hidden ? start() : stop());

    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      stop();
    };
  }, [message]);
}
