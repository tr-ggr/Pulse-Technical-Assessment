import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { releaseUsers } from "@/lib/pairing";
import { authenticate, isSessionId, unauthorized } from "@/lib/session";
import { sendServerSignal, transition } from "@/lib/signaling";
import { clientIp, limit, rules } from "@/lib/ratelimit";
import { pausedFor } from "@/lib/safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 1024;

// POST /api/report (Authorization: Bearer <token>) — body { toId, report? }
// Blocks a stranger, and with `report: true` also reports them (lib/safety.ts).
//
// You can only block someone you're talking to, talked to last, or who is
// asking to talk to you; you can only report someone you actually talked
// to. That keeps both from being aimed at arbitrary dots on the map.
// The stranger is never told: they see the call end, or their request
// declined, exactly as if you'd hung up or said no.
export async function POST(request: NextRequest) {
  const me = authenticate(request);
  if (!me) return unauthorized();

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) {
    return Response.json({ error: "body too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  const { toId, report = false } = (body ?? {}) as Record<string, unknown>;
  if (!isSessionId(toId) || toId === me) {
    return Response.json({ error: "invalid toId" }, { status: 400 });
  }
  if (typeof report !== "boolean") {
    return Response.json({ error: "invalid report" }, { status: 400 });
  }

  const ip = clientIp(request);
  const blocked = await limit(rules.ip(ip), rules.report(me));
  if (blocked) return blocked;

  const self = await prisma.presence.findUnique({
    where: { id: me },
    select: { peerId: true, lastPeerId: true, lastPeerIp: true },
  });
  if (!self) return Response.json({ error: "session gone" }, { status: 410 });

  const talked = self.peerId === toId || self.lastPeerId === toId;
  const asking =
    (await prisma.presence.count({ where: { id: toId, requestTo: me } })) > 0;
  if (report ? !talked : !talked && !asking) {
    return Response.json({ error: "not your stranger" }, { status: 403 });
  }

  await prisma.block.upsert({
    where: { blockerId_blockedId: { blockerId: me, blockedId: toId } },
    create: { blockerId: me, blockedId: toId },
    update: {},
  });

  // Out of the conversation, or their pending request, right away.
  if (self.peerId === toId) {
    const ended = await transition(me, toId, "end");
    if (ended.ok) await sendServerSignal(me, toId, "end");
  }
  if (asking) {
    const { count } = await prisma.presence.updateMany({
      where: { id: toId, requestTo: me },
      data: { requestTo: null, requestAt: null },
    });
    if (count > 0) await sendServerSignal(me, toId, "decline");
  }

  // Count the report against their network, once per reporting network, and
  // never from their own (two tabs behind one router can't pause each other).
  const targetIp = self.lastPeerId === toId ? self.lastPeerIp : null;
  if (report && targetIp && targetIp !== ip) {
    await prisma.report.upsert({
      where: { targetIp_reporterIp: { targetIp, reporterIp: ip } },
      create: { targetIp, reporterIp: ip },
      update: { createdAt: new Date() },
    });
    // Over the line: take their session off the map now. Their next poll
    // gets 410, and the re-join is refused while the pause lasts.
    if ((await pausedFor(targetIp)) > 0) {
      await releaseUsers([toId]);
      await prisma.presence.deleteMany({ where: { id: toId } });
      await prisma.signal.deleteMany({ where: { toId } });
    }
  }

  return Response.json({ ok: true });
}
