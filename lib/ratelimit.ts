import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

// Server-only. Fixed-window rate limits kept in Postgres: the app has to run
// on Vercel with no external services, and serverless instances share
// nothing in memory. Each hit is one atomic upsert, so concurrent instances
// can't both slip under a limit.

export interface Rule {
  key: string;
  limit: number;
  windowMs: number;
}

const MINUTE = 60_000;

// Normal use: one poll every 1.5 s (40/min), a handful of SDP/ICE signals per
// connection. Each fake dot needs ~40 polls/min to stay alive, so the per-IP
// budget also caps how many dots one address can keep on the map (~15).
export const rules = {
  ip: (ip: string): Rule => ({ key: `ip:${ip}`, limit: 600, windowMs: MINUTE }),
  join: (ip: string): Rule => ({ key: `join:${ip}`, limit: 10, windowMs: MINUTE }),
  poll: (id: string): Rule => ({ key: `poll:${id}`, limit: 60, windowMs: MINUTE }),
  signal: (id: string): Rule => ({ key: `signal:${id}`, limit: 120, windowMs: MINUTE }),
  request: (id: string): Rule => ({ key: `request:${id}`, limit: 6, windowMs: MINUTE }),
  requestCooldown: (id: string): Rule => ({
    key: `request-cd:${id}`,
    limit: 1,
    windowMs: 3_000,
  }),
};

// Longest window above; counters older than this are dead and can be swept.
export const RATE_WINDOW_MAX_MS = MINUTE;

// Vercel's proxy sets x-real-ip itself (client values are overwritten), so it
// can't be spoofed there. x-forwarded-for is only the local-dev fallback.
// Stored hashed: a raw IP is personal data the app has no reason to keep.
export function clientIp(request: Request): string {
  const ip =
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  return createHash("sha256").update(`pulse:ip:${ip}`).digest("base64url");
}

// Counts one hit against every rule. Returns a 429 response for the first
// rule over its limit, or null when the request may proceed.
export async function limit(...list: Rule[]): Promise<Response | null> {
  const results = await Promise.all(list.map(hit));
  const blocked = results.find((r) => r.count > r.rule.limit);
  if (!blocked) return null;
  const retryMs = blocked.windowStart.getTime() + blocked.rule.windowMs - Date.now();
  return tooMany(Math.max(1, Math.ceil(retryMs / 1000)));
}

export function tooMany(retryAfterSec: number): Response {
  return Response.json(
    { error: "rate limited" },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}

async function hit(rule: Rule) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - rule.windowMs);
  const rows = await prisma.$queryRaw<{ count: number; windowStart: Date }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count")
    VALUES (${rule.key}, ${now}, 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."windowStart" <= ${cutoff}
                THEN 1 ELSE "RateLimit"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimit"."windowStart" <= ${cutoff}
                      THEN ${now} ELSE "RateLimit"."windowStart" END
    RETURNING "count", "windowStart"`;
  return { rule, count: Number(rows[0].count), windowStart: rows[0].windowStart };
}

// A global "only one of you" lease on the same table: returns true for
// exactly one caller per `ms`, across every serverless instance.
export async function tryLease(key: string, ms: number): Promise<boolean> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - ms);
  const rows = await prisma.$queryRaw<{ key: string }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count")
    VALUES (${key}, ${now}, 1)
    ON CONFLICT ("key") DO UPDATE SET "windowStart" = ${now}
    WHERE "RateLimit"."windowStart" <= ${cutoff}
    RETURNING "key"`;
  return rows.length > 0;
}
