import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { releaseUsers } from "@/lib/pairing";
import { STALE_MS, SIGNAL_TTL_MS } from "@/lib/presence";
import type { PollResponse } from "@/lib/types";
import { authenticate, unauthorized } from "@/lib/session";
import { clientIp, limit, rules } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/poll (Authorization: Bearer <token>) — the single endpoint that
// drives the live map. It (1) heartbeats the caller, (2) reaps stale presence
// + orphan signals, (3) returns the filtered online peers, and (4) drains the
// caller's mailbox. The caller is whoever the token says, never a query param.
export async function GET(request: NextRequest) {
  const id = authenticate(request);
  if (!id) return unauthorized();
  const blocked = await limit(rules.ip(clientIp(request)), rules.poll(id));
  if (blocked) return blocked;

  const now = Date.now();
  const staleCutoff = new Date(now - STALE_MS);
  const signalCutoff = new Date(now - SIGNAL_TTL_MS);

  // 1) Heartbeat — refresh lastSeen for the caller.
  // No row means we were reaped (throttled background tab, bfcache restore…):
  // tell the client to re-join instead of silently polling while invisible.
  const { count } = await prisma.presence.updateMany({
    where: { id },
    data: { lastSeen: new Date(now) },
  });
  if (count === 0) {
    return Response.json({ error: "session gone" }, { status: 410 });
  }

  // 2) Reap stale presence rows and orphaned signals (independent deletes —
  // no atomicity needed, and avoids transactions over a PgBouncer pooler).
  // Stale users who were mid-connection free + notify their partner first.
  const stale = await prisma.presence.findMany({
    where: { lastSeen: { lt: staleCutoff } },
    select: { id: true },
  });
  if (stale.length > 0) {
    const staleIds = stale.map((p) => p.id);
    await releaseUsers(staleIds);
    await prisma.presence.deleteMany({
      where: { id: { in: staleIds }, lastSeen: { lt: staleCutoff } },
    });
  }
  await prisma.signal.deleteMany({ where: { createdAt: { lt: signalCutoff } } });

  // 3) Online peers, excluding self.
  const peers = await prisma.presence.findMany({
    where: {
      id: { not: id },
      lastSeen: { gte: staleCutoff },
    },
    select: { id: true, lat: true, lng: true, busy: true },
  });

  // 4) Drain this user's mailbox: read, then delete exactly what we read so a
  // concurrently-inserted signal is never lost.
  const inbox = await prisma.signal.findMany({
    where: { toId: id },
    orderBy: { createdAt: "asc" },
  });
  if (inbox.length > 0) {
    await prisma.signal.deleteMany({
      where: { id: { in: inbox.map((s) => s.id) } },
    });
  }

  const response: PollResponse = {
    peers: peers.map((p) => ({
      id: p.id,
      lat: p.lat,
      lng: p.lng,
      busy: p.busy,
    })),
    signals: inbox.map((s) => ({
      id: s.id,
      fromId: s.fromId,
      toId: s.toId,
      type: s.type as PollResponse["signals"][number]["type"],
      payload: s.payload,
      createdAt: s.createdAt.toISOString(),
    })),
  };

  return Response.json(response);
}
