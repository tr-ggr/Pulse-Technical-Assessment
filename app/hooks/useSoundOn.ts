"use client";

import { useSyncExternalStore } from "react";
import { isSoundOn, subscribeSound } from "@/lib/sound";

export function useSoundOn(): boolean {
  return useSyncExternalStore(subscribeSound, isSoundOn, () => true);
}
