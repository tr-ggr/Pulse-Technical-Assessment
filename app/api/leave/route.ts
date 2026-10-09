import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { releaseUsers } from "@/lib/pairing";
import { authenticate, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/leave (Authorization: Bearer <token>). Ends any active pairing,
// then removes the caller's presence row and pending inbox. Sent as a
// keepalive fetch on tab close (sendBeacon can't carry the auth header).
export async function POST(request: NextRequest) {
  const id = authenticate(request);
  if (!id) return unauthorized();

  // Free and notify the partner (if any) before the row disappears.
  await releaseUsers([id]);

  // Independent cleanup deletes — no atomicity needed (and interactive
  // transactions are unreliable over a PgBouncer pooler). Only drop this
  // user's inbox: signals it sent (e.g. a final `end`) must still reach the
  // peer; undelivered ones expire via SIGNAL_TTL_MS.
  await prisma.signal.deleteMany({ where: { toId: id } });
  await prisma.presence.deleteMany({ where: { id } });

  return Response.json({ ok: true });
}
