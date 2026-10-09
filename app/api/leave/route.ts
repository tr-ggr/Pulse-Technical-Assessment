import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { releaseUsers } from "@/lib/pairing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/leave — body { id }. Ends any active pairing, then removes the
// presence row and this user's pending inbox. Called via navigator.sendBeacon on tab close, so
// the body may arrive as text — parse defensively.
export async function POST(request: NextRequest) {
  let id: string | undefined;
  try {
    const text = await request.text();
    id = text ? (JSON.parse(text)?.id as string | undefined) : undefined;
  } catch {
    id = undefined;
  }

  if (typeof id !== "string" || !id) {
    return Response.json({ error: "invalid id" }, { status: 400 });
  }

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
