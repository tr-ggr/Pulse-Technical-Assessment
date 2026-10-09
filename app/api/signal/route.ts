import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { SignalType } from "@/lib/types";
import { authenticate, isSessionId, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TYPES: SignalType[] = [
  "request",
  "accept",
  "decline",
  "offer",
  "answer",
  "ice",
  "end",
];

const MAX_PAYLOAD = 64 * 1024; // SDP/ICE are small; cap to be safe.

// POST /api/signal (Authorization: Bearer <token>) — body { toId, type, payload? }
// Drops one message into the recipient's mailbox. Also manages the `busy`
// flag so a user can only be in one connection at a time. The sender is
// whoever the token says; a `fromId` in the body is ignored.
export async function POST(request: NextRequest) {
  const fromId = authenticate(request);
  if (!fromId) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const { toId, type, payload } = (body ?? {}) as Record<string, unknown>;

  if (!isSessionId(toId) || toId === fromId) {
    return Response.json({ error: "invalid toId" }, { status: 400 });
  }
  if (typeof type !== "string" || !VALID_TYPES.includes(type as SignalType)) {
    return Response.json({ error: "invalid type" }, { status: 400 });
  }
  if (
    payload !== undefined &&
    payload !== null &&
    (typeof payload !== "string" || payload.length > MAX_PAYLOAD)
  ) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }

  const signalType = type as SignalType;
  const payloadStr = typeof payload === "string" ? payload : null;

  // Enforce "one active connection at a time": if the target is already busy,
  // auto-decline the request instead of delivering it.
  if (signalType === "request") {
    const target = await prisma.presence.findUnique({
      where: { id: toId },
      select: { busy: true },
    });
    if (!target) {
      // Target went offline — tell the initiator it was declined.
      await sendDecline(toId, fromId);
      return Response.json({ ok: true, autoDeclined: true });
    }
    if (target.busy) {
      await sendDecline(toId, fromId);
      return Response.json({ ok: true, autoDeclined: true });
    }
  }

  // Busy transitions:
  // - accept: the connection is now active → mark BOTH peers busy and pair them.
  // - decline/end: free both peers — but only rows paired with each other, so a
  //   stray decline/end can't free someone who is in a different connection.
  if (signalType === "accept") {
    await prisma.presence.updateMany({
      where: { id: fromId },
      data: { busy: true, peerId: toId },
    });
    await prisma.presence.updateMany({
      where: { id: toId },
      data: { busy: true, peerId: fromId },
    });
  } else if (signalType === "decline" || signalType === "end") {
    await prisma.presence.updateMany({
      where: {
        OR: [
          { id: fromId, peerId: toId },
          { id: toId, peerId: fromId },
        ],
      },
      data: { busy: false, peerId: null },
    });
  }

  await prisma.signal.create({
    data: { fromId, toId, type: signalType, payload: payloadStr },
  });

  return Response.json({ ok: true });
}

// Helper: deliver an auto-decline from `target` back to `initiator`.
async function sendDecline(targetId: string, initiatorId: string) {
  await prisma.signal.create({
    data: { fromId: targetId, toId: initiatorId, type: "decline", payload: null },
  });
}
