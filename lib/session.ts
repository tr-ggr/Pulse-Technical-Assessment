import { createHash, randomBytes } from "node:crypto";

// Server-only. A session is a random bearer token that the server issues on
// join and the client keeps in memory. The public session id — the one every
// other user sees on the map — is a hash of that token, so knowing someone's
// id never lets you act as them, and the server never stores the token.

// 32 random bytes / a SHA-256 digest, both base64url without padding.
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function isSessionId(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value);
}

export function isToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value);
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function digest(label: string, token: string): Buffer {
  return createHash("sha256").update(`pulse:${label}:${token}`).digest();
}

export function sessionIdFor(token: string): string {
  return digest("id", token).toString("base64url");
}

// Two uniform numbers in [0, 1) that fix this session's dot (see placeDot).
export function offsetSeed(token: string): [number, number] {
  const d = digest("offset", token);
  return [d.readUInt32BE(0) / 2 ** 32, d.readUInt32BE(4) / 2 ** 32];
}

// The caller's session id, or null when the bearer token is missing/malformed.
export function authenticate(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return isToken(token) ? sessionIdFor(token) : null;
}

export function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
