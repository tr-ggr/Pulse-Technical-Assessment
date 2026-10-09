// A stranger's visual identity, derived only from their ephemeral session id:
// the same stranger keeps one colour everywhere (dot, orb, arc, chat tint) for
// as long as their session lives, and gets a new one next session.
//
// Colours are hsl() strings with commas because Mapbox paint properties (the
// arc's line-gradient) can't parse oklch() or space-separated syntax.

import { bearingDeg, haversineKm, type LatLng } from "@/lib/geo";

export function hashId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

// Strangers live in the cool band (teal → violet). Warm ember is reserved for
// "you" and your actions, so the two never get confused on the globe.
const HUE_MIN = 165;
const HUE_SPAN = 135;

export function peerHue(id: string): number {
  return HUE_MIN + (hashId(id) % HUE_SPAN);
}

export function peerColor(id: string, alpha = 1): string {
  const h = peerHue(id);
  return alpha >= 1
    ? `hsl(${h}, 85%, 68%)`
    : `hsla(${h}, 85%, 68%, ${alpha})`;
}

// Negative animation delay so every dot breathes out of phase with its
// neighbours instead of the whole map pulsing in lockstep.
export function pulseDelayMs(id: string): number {
  return -((hashId(id) >> 4) % 2600);
}

const kmFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

// Deliberately coarse: dots are already offset 1–3 km, so anything finer
// would be false precision.
export function formatDistance(km: number): string {
  if (km < 15) return "Nearby";
  const step = km < 100 ? 5 : km < 1000 ? 10 : 50;
  return `~${kmFormat.format(Math.round(km / step) * step)} km away`;
}

const COMPASS = [
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
] as const;

export function compassLabel(deg: number): string {
  return COMPASS[Math.round(deg / 45) % 8];
}

export interface Stranger {
  id: string;
  color: string;
  glow: string;
  // null when we don't know where they (or we) are.
  distanceLabel: string | null;
  direction: string | null;
}

export function describeStranger(
  id: string,
  peer: LatLng | null,
  me: LatLng | null,
): Stranger {
  let distanceLabel: string | null = null;
  let direction: string | null = null;
  if (peer && me) {
    const km = haversineKm(me, peer);
    distanceLabel = formatDistance(km);
    if (km >= 15) direction = `to the ${compassLabel(bearingDeg(me, peer))}`;
  }
  return {
    id,
    color: peerColor(id),
    glow: peerColor(id, 0.55),
    distanceLabel,
    direction,
  };
}
