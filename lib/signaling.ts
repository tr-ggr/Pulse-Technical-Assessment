import { prisma } from "@/lib/prisma";
import { REQUEST_TIMEOUT_MS } from "@/lib/presence";
import type { SignalType } from "@/lib/types";

// Server-only. The connection state machine, enforced on the server so a
// client can't skip steps: you can only accept a request that was actually
// made to you, and SDP/ICE only flows between two users the server has paired.
//
//   idle ──request──▶ requesting ──accept──▶ paired ──end──▶ idle
//                         │ decline / end (cancel) / timeout ▲
//                         └──────────────────────────────────┘
//
// No interactive transactions (unreliable over a PgBouncer pooler): every
// step is a conditional updateMany whose `count` says whether it applied.

// The recipient's countdown starts when their poll delivers the request, up
// to a poll interval later, so the server keeps a little grace past it.
const REQUEST_GRACE_MS = 5_000;

export type Verdict =
  | { ok: true; deliver: boolean }
  | { ok: false; status: number; error: string };

const DELIVER: Verdict = { ok: true, deliver: true };

function reject(status: number, error: string): Verdict {
  return { ok: false, status, error };
}

function requestCutoff(): Date {
  return new Date(Date.now() - REQUEST_TIMEOUT_MS - REQUEST_GRACE_MS);
}

export async function transition(
  fromId: string,
  toId: string,
  type: SignalType,
): Promise<Verdict> {
  switch (type) {
    case "request":
      return request(fromId, toId);
    case "accept":
      return accept(fromId, toId);
    case "decline":
      return decline(fromId, toId);
    case "end":
      return end(fromId, toId);
    case "offer":
    case "answer":
    case "ice":
      return (await arePaired(fromId, toId))
        ? DELIVER
        : reject(403, "not connected");
  }
}

async function request(fromId: string, toId: string): Promise<Verdict> {
  const target = await prisma.presence.findUnique({
    where: { id: toId },
    select: { busy: true },
  });
  // Target offline or already in a connection: tell the initiator it was
  // declined instead of delivering the request.
  if (!target || target.busy) {
    await sendServerSignal(toId, fromId, "decline");
    return { ok: true, deliver: false };
  }

  const me = await prisma.presence.findUnique({
    where: { id: fromId },
    select: { requestTo: true, requestAt: true },
  });
  // One outgoing request at a time: a new one replaces the old.
  const { count } = await prisma.presence.updateMany({
    where: { id: fromId, busy: false },
    data: { requestTo: toId, requestAt: new Date() },
  });
  if (count === 0) return reject(409, "busy");

  // Clear the replaced request off its recipient's screen.
  if (
    me?.requestTo &&
    me.requestTo !== toId &&
    me.requestAt &&
    me.requestAt >= requestCutoff()
  ) {
    await sendServerSignal(fromId, me.requestTo, "end");
  }
  return DELIVER;
}

// `fromId` accepts the request that `toId` made.
async function accept(fromId: string, toId: string): Promise<Verdict> {
  const claimMe = await prisma.presence.updateMany({
    where: { id: fromId, busy: false },
    data: { busy: true, peerId: toId, requestTo: null, requestAt: null },
  });
  if (claimMe.count === 0) return reject(409, "busy");

  const claimInitiator = await prisma.presence.updateMany({
    where: {
      id: toId,
      busy: false,
      requestTo: fromId,
      requestAt: { gte: requestCutoff() },
    },
    data: { busy: true, peerId: fromId, requestTo: null, requestAt: null },
  });
  if (claimInitiator.count === 0) {
    // No live request from them (never made, cancelled or expired): undo.
    await prisma.presence.updateMany({
      where: { id: fromId, peerId: toId },
      data: { busy: false, peerId: null },
    });
    return reject(409, "no pending request");
  }
  return DELIVER;
}

// `fromId` declines the request that `toId` made.
async function decline(fromId: string, toId: string): Promise<Verdict> {
  const { count } = await prisma.presence.updateMany({
    where: { id: toId, requestTo: fromId },
    data: { requestTo: null, requestAt: null },
  });
  return count > 0 ? DELIVER : reject(409, "no pending request");
}

// Hang up an active pairing, or cancel your own pending request.
async function end(fromId: string, toId: string): Promise<Verdict> {
  // Free both peers, but only rows paired with each other, so a stray end
  // can't free someone who is in a different connection.
  const pair = await prisma.presence.updateMany({
    where: {
      OR: [
        { id: fromId, peerId: toId },
        { id: toId, peerId: fromId },
      ],
    },
    data: { busy: false, peerId: null },
  });
  const cancel = await prisma.presence.updateMany({
    where: { id: fromId, requestTo: toId },
    data: { requestTo: null, requestAt: null },
  });
  return pair.count + cancel.count > 0
    ? DELIVER
    : reject(409, "nothing to end");
}

async function arePaired(a: string, b: string): Promise<boolean> {
  const rows = await prisma.presence.count({
    where: {
      OR: [
        { id: a, peerId: b },
        { id: b, peerId: a },
      ],
    },
  });
  return rows === 2;
}

// A signal the server sends on a user's behalf (auto-decline, cancellation).
export async function sendServerSignal(
  fromId: string,
  toId: string,
  type: SignalType,
) {
  await prisma.signal.create({
    data: { fromId, toId, type, payload: null },
  });
}
