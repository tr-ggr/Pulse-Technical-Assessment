import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isValidLatLng, placeDot } from "@/lib/geo";
import { isToken, newToken, offsetSeed, sessionIdFor } from "@/lib/session";
import { clientIp, limit, rules } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/join — body { lat, lng, token? } (raw coords).
// Issues a session token (or reuses the one presented, so a reaped client
// comes back as the same stranger, on the same spot), places the dot 1–3 km
// away (lib/geo.ts placeDot) and upserts the presence row. Raw coordinates are never stored. Returns
// { id, token }: the id is public, the token stays in the client's memory.
export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  const blocked = await limit(rules.ip(ip), rules.join(ip));
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const { lat, lng, token: presented } = (body ?? {}) as Record<
    string,
    unknown
  >;

  if (presented !== undefined && !isToken(presented)) {
    return Response.json({ error: "invalid token" }, { status: 400 });
  }
  if (!isValidLatLng(lat, lng)) {
    return Response.json({ error: "invalid coordinates" }, { status: 400 });
  }

  const token = presented ?? newToken();
  const id = sessionIdFor(token);
  const offset = placeDot(lat as number, lng as number, offsetSeed(token));

  await prisma.presence.upsert({
    where: { id },
    create: {
      id,
      lat: offset.lat,
      lng: offset.lng,
      busy: false,
      lastSeen: new Date(),
    },
    update: {
      lat: offset.lat,
      lng: offset.lng,
      lastSeen: new Date(),
    },
  });

  return Response.json({ id, token });
}
