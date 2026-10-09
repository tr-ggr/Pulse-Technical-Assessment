import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { SignalType } from "@/lib/types";
import { authenticate, isSessionId, unauthorized } from "@/lib/session";
import { transition } from "@/lib/signaling";
import { clientIp, limit, rules, tooMany } from "@/lib/ratelimit";

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

// Undelivered signals one recipient may hold. A real handshake needs a few
// dozen at most; anything beyond this is someone flooding their inbox.
const MAILBOX_MAX = 100;

// POST /api/signal (Authorization: Bearer <token>) — body { toId, type, payload? }
// Drops one message into the recipient's mailbox, if the connection state
// machine allows that step (which also manages `busy`/pairing). The sender is
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

  const blocked = await limit(
    rules.ip(clientIp(request)),
    rules.signal(fromId),
    ...(signalType === "request"
      ? [rules.request(fromId), rules.requestCooldown(fromId)]
      : []),
  );
  if (blocked) return blocked;

  const pending = await prisma.signal.count({ where: { toId } });
  if (pending >= MAILBOX_MAX) return tooMany(5);

  // The state machine decides whether this step is legal (lib/signaling.ts).
  const verdict = await transition(fromId, toId, signalType);
  if (!verdict.ok) {
    return Response.json({ error: verdict.error }, { status: verdict.status });
  }
  if (!verdict.deliver) {
    return Response.json({ ok: true, autoDeclined: true });
  }

  await prisma.signal.create({
    data: { fromId, toId, type: signalType, payload: payloadStr },
  });

  return Response.json({ ok: true });
}
