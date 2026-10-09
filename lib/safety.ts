import { prisma } from "@/lib/prisma";

// Server-only. Block and report, without accounts.
//
// A block is between two sessions: neither sees the other's dot again and
// requests between them are auto-declined, for as long as both are online.
//
// A report also blocks, and counts against the reported stranger's network
// (hashed IP). Reports from REPORT_THRESHOLD different networks within
// PAUSE_MS pause that network: its session is removed and joins are refused
// until the window passes. Requiring distinct networks — and a real
// conversation with the target (see app/api/report) — means one person
// can't get someone paused alone, however many tabs they open.

export const REPORT_THRESHOLD = 2;
export const PAUSE_MS = 30 * 60_000;

// Everyone this session must not see: blocked by it, or blocking it.
export async function blockedIdsFor(id: string): Promise<string[]> {
  const rows = await prisma.block.findMany({
    where: { OR: [{ blockerId: id }, { blockedId: id }] },
    select: { blockerId: true, blockedId: true },
  });
  return rows.map((r) => (r.blockerId === id ? r.blockedId : r.blockerId));
}

export async function isBlockedPair(a: string, b: string): Promise<boolean> {
  const n = await prisma.block.count({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
  });
  return n > 0;
}

// Milliseconds left on this network's pause, or 0 when it isn't paused. The
// pause lasts while REPORT_THRESHOLD reports are inside the window, i.e.
// until the THRESHOLD-th most recent one expires.
export async function pausedFor(ipKey: string): Promise<number> {
  const now = Date.now();
  const recent = await prisma.report.findMany({
    where: { targetIp: ipKey, createdAt: { gte: new Date(now - PAUSE_MS) } },
    orderBy: { createdAt: "desc" },
    take: REPORT_THRESHOLD,
    select: { createdAt: true },
  });
  if (recent.length < REPORT_THRESHOLD) return 0;
  const oldest = recent[REPORT_THRESHOLD - 1].createdAt.getTime();
  return Math.max(0, oldest + PAUSE_MS - now);
}

// Reaper housekeeping: blocks die with either session, reports with the window.
export async function sweepSafety(now: number) {
  await prisma.$executeRaw`
    DELETE FROM "Block" b
    WHERE NOT EXISTS (SELECT 1 FROM "Presence" p WHERE p."id" = b."blockerId")
       OR NOT EXISTS (SELECT 1 FROM "Presence" p WHERE p."id" = b."blockedId")`;
  await prisma.report.deleteMany({
    where: { createdAt: { lt: new Date(now - PAUSE_MS) } },
  });
}
