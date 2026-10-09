import { expect, test } from "@playwright/test";
import { haversineKm, placeDot, snapToGrid } from "../lib/geo";

// Pure checks on dot placement (no browser, no database): the dot is always
// 1–3 km from the real location, stable for a session, and averaging many
// sessions only recovers the 1 km grid cell, never the user's real spot.

// Deterministic PRNG so a failure reproduces.
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("every dot lands 1–3 km from the real location, at any latitude", () => {
  const rand = mulberry32(1);
  const outside: unknown[] = [];
  for (let i = 0; i < 10_000; i++) {
    const real = { lat: rand() * 170 - 85, lng: rand() * 360 - 180 };
    const dot = placeDot(real.lat, real.lng, [rand(), rand()]);
    const km = haversineKm(real, dot);
    if (km < 1 || km > 3) outside.push({ real, dot, km });
  }
  expect(outside).toEqual([]);
});

test("the same session seed puts the dot in the same place on re-join", () => {
  const seed: [number, number] = [0.3, 0.7];
  // Two GPS fixes a few metres apart, inside the same grid cell.
  const center = snapToGrid(14.5995, 120.9842);
  const a = placeDot(center.lat + 0.0001, center.lng, seed);
  const b = placeDot(center.lat - 0.0001, center.lng + 0.0001, seed);
  expect(a).toEqual(b);
});

test("averaging many sessions converges on the grid cell, not the user", () => {
  // Put the user well off-centre in their cell (~0.4 km away from the centre).
  const center = snapToGrid(14.5995, 120.9842);
  const real = { lat: center.lat + 0.0026, lng: center.lng + 0.0026 };
  expect(snapToGrid(real.lat, real.lng)).toEqual(center);

  const rand = mulberry32(2);
  const n = 5_000;
  let lat = 0;
  let lng = 0;
  for (let i = 0; i < n; i++) {
    const dot = placeDot(real.lat, real.lng, [rand(), rand()]);
    lat += dot.lat / n;
    lng += dot.lng / n;
  }
  const mean = { lat, lng };
  expect(haversineKm(mean, center)).toBeLessThan(0.1);
  expect(haversineKm(mean, real)).toBeGreaterThan(0.3);
});
