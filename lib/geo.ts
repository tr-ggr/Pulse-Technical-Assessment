// Privacy offset: place the dot 1–3 km from the user's real location, never
// at it. Two defences against someone averaging many dots to find a user:
//
// 1. Snap first. The real location is snapped to the centre of a 1 km grid
//    cell, and the dot is offset from that centre on a ring sized so it still
//    lands 1–3 km from the real point. Averaging many dots from the same
//    place only ever recovers the cell centre, not the user.
// 2. One dot per session. The offset comes from a per-session seed (derived
//    from the session token), so re-joins after a reap land on the same spot
//    instead of leaking a fresh sample each time. A new session gets a new
//    seed, so the user lands somewhere different every time.

const KM_PER_DEG_LAT = 111.32;

export const GRID_CELL_KM = 1;
// Furthest the real point can be from its cell centre, plus a little slack
// for the flat-earth maths below.
const SNAP_MAX_KM = GRID_CELL_KM / Math.SQRT2 + 0.02;
const RING_MIN_KM = 1 + SNAP_MAX_KM;
const RING_MAX_KM = 3 - SNAP_MAX_KM;

function kmPerDegLng(lat: number): number {
  return KM_PER_DEG_LAT * Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
}

// Centre of the 1 km grid cell containing (lat, lng).
export function snapToGrid(lat: number, lng: number): { lat: number; lng: number } {
  const cellLat = GRID_CELL_KM / KM_PER_DEG_LAT;
  const centerLat = clamp((Math.floor(lat / cellLat) + 0.5) * cellLat, -90, 90);
  const cellLng = GRID_CELL_KM / kmPerDegLng(centerLat);
  const centerLng = (Math.floor(lng / cellLng) + 0.5) * cellLng;
  return { lat: centerLat, lng: wrapLng(centerLng) };
}

// `seed` is two uniform numbers in [0, 1): angle and radius.
export function placeDot(
  lat: number,
  lng: number,
  seed: [number, number],
): { lat: number; lng: number } {
  const center = snapToGrid(lat, lng);
  const bearing = seed[0] * 2 * Math.PI;
  // Uniform over the ring's area, not its radius, so dots don't bunch inward.
  const distanceKm = Math.sqrt(
    RING_MIN_KM ** 2 + seed[1] * (RING_MAX_KM ** 2 - RING_MIN_KM ** 2),
  );

  const dLat = (distanceKm * Math.cos(bearing)) / KM_PER_DEG_LAT;
  const dLng = (distanceKm * Math.sin(bearing)) / kmPerDegLng(center.lat);

  return {
    lat: clamp(center.lat + dLat, -90, 90),
    lng: wrapLng(center.lng + dLng),
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function wrapLng(lng: number): number {
  // Keep longitude in [-180, 180].
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

// ── Client-side helpers for the map UI ──────────────────────────────────────

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

// Great-circle distance in kilometres.
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Initial compass bearing from a to b, in degrees clockwise from north [0, 360).
export function bearingDeg(a: LatLng, b: LatLng): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Points along the great circle from a to b as [lng, lat] pairs. Longitudes
// are unwrapped (may leave [-180, 180]) so consecutive points never jump
// across the antimeridian — Mapbox then draws one continuous line.
export function greatCircle(a: LatLng, b: LatLng, steps = 64): [number, number][] {
  const φ1 = toRad(a.lat);
  const λ1 = toRad(a.lng);
  const φ2 = toRad(b.lat);
  const λ2 = toRad(b.lng);
  const d = haversineKm(a, b) / EARTH_RADIUS_KM;
  if (d < 1e-6) return [[a.lng, a.lat], [b.lng, b.lat]];

  const points: [number, number][] = [];
  let prevLng = a.lng;
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    const lat = toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)));
    let lng = toDeg(Math.atan2(y, x));
    while (lng - prevLng > 180) lng -= 360;
    while (lng - prevLng < -180) lng += 360;
    prevLng = lng;
    points.push([lng, lat]);
  }
  return points;
}
