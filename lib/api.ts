// Client-side helpers for talking to the coordination API. Every call after
// join carries the session token as a bearer credential; the token lives only
// in memory and dies with the tab.
import type { PollResponse, SignalType } from "@/lib/types";

export interface Session {
  id: string;
  token: string;
}

function auth(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

// Pass the previous token to come back as the same stranger after being reaped.
export async function join(
  lat: number,
  lng: number,
  token?: string,
): Promise<Session> {
  const res = await fetch("/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lng, token }),
  });
  if (res.status === 403) {
    const body = await res.json().catch(() => ({}));
    if (body?.error === "paused") {
      throw new PausedError((Number(body.retryAfter) || 60) * 1000);
    }
  }
  if (!res.ok) throw new Error(`join failed: ${res.status}`);
  return res.json();
}

// Thrown by join() while this network is paused after reports from several
// different people (lib/safety.ts on the server).
export class PausedError extends Error {
  constructor(readonly retryAfterMs: number) {
    super("paused");
  }
}

// Block a stranger, and optionally report them. Resolves to the HTTP status
// (0 on a network error).
export async function blockStranger(
  token: string,
  toId: string,
  report: boolean,
): Promise<number> {
  try {
    const res = await fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth(token) },
      body: JSON.stringify({ toId, report }),
    });
    return res.status;
  } catch {
    return 0;
  }
}

// Thrown by poll() when the server no longer has our presence row (410) or
// doesn't accept our token (401) — either way, re-join.
export class SessionGoneError extends Error {}

// Thrown by poll() on 429: wait this long before polling again.
export class RateLimitedError extends Error {
  constructor(readonly retryAfterMs: number) {
    super("rate limited");
  }
}

export async function poll(token: string): Promise<PollResponse> {
  const res = await fetch("/api/poll", {
    cache: "no-store",
    headers: auth(token),
  });
  if (res.status === 410 || res.status === 401) {
    throw new SessionGoneError("session gone");
  }
  if (res.status === 429) {
    const seconds = Number(res.headers.get("Retry-After")) || 5;
    throw new RateLimitedError(seconds * 1000);
  }
  if (!res.ok) throw new Error(`poll failed: ${res.status}`);
  return res.json();
}

export interface SignalResult {
  status: number;
  // A request that met theirs: the server paired us on the spot.
  matched: boolean;
}

// Resolves to the HTTP status (0 on a network error) so callers can react to
// a rejected signal — e.g. an accept for a request that already expired.
export async function sendSignal(
  token: string,
  toId: string,
  type: SignalType,
  payload?: string,
): Promise<SignalResult> {
  try {
    const res = await fetch("/api/signal", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth(token) },
      body: JSON.stringify({ toId, type, payload }),
    });
    const body = res.ok ? await res.json().catch(() => null) : null;
    return { status: res.status, matched: body?.matched === true };
  } catch {
    return { status: 0, matched: false };
  }
}

// Fire-and-forget leave that survives the tab closing. A keepalive fetch
// rather than sendBeacon, because a beacon can't carry the auth header.
export function leave(token: string): void {
  void fetch("/api/leave", {
    method: "POST",
    headers: auth(token),
    keepalive: true,
  }).catch(() => {});
}
