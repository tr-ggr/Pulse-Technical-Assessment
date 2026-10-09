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
  if (!res.ok) throw new Error(`join failed: ${res.status}`);
  return res.json();
}

// Thrown by poll() when the server no longer has our presence row (410) or
// doesn't accept our token (401) — either way, re-join.
export class SessionGoneError extends Error {}

export async function poll(token: string): Promise<PollResponse> {
  const res = await fetch("/api/poll", {
    cache: "no-store",
    headers: auth(token),
  });
  if (res.status === 410 || res.status === 401) {
    throw new SessionGoneError("session gone");
  }
  if (!res.ok) throw new Error(`poll failed: ${res.status}`);
  return res.json();
}

// Resolves to the HTTP status (0 on a network error) so callers can react to
// a rejected signal — e.g. an accept for a request that already expired.
export async function sendSignal(
  token: string,
  toId: string,
  type: SignalType,
  payload?: string,
): Promise<number> {
  try {
    const res = await fetch("/api/signal", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth(token) },
      body: JSON.stringify({ toId, type, payload }),
    });
    return res.status;
  } catch {
    return 0;
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
