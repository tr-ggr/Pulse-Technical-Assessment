import { prisma } from "@/lib/prisma";
import { sendServerSignal } from "@/lib/signaling";

// Server-only. Call before deleting presence rows (leave / stale reap): any
// partner a departing user was paired with is freed and sent an `end`, so the
// chat ends for both even when the leaver crashed or closed the tab abruptly.
// Pending requests to or from a departing user are settled the same way.
export async function releaseUsers(ids: string[]) {
  if (ids.length === 0) return;

  const leaving = await prisma.presence.findMany({
    where: {
      id: { in: ids },
      OR: [{ peerId: { not: null } }, { requestTo: { not: null } }],
    },
    select: { id: true, peerId: true, requestTo: true },
  });

  for (const { id, peerId, requestTo } of leaving) {
    if (peerId) {
      // Only free the partner if it is still paired with this user; the count
      // also dedupes concurrent reapers so the `end` is sent once.
      const { count } = await prisma.presence.updateMany({
        where: { id: peerId, peerId: id },
        data: { busy: false, peerId: null },
      });
      if (count > 0) await sendServerSignal(id, peerId, "end");
    }
    // Withdraw their outgoing request so the card leaves the recipient's screen.
    if (requestTo && !ids.includes(requestTo)) {
      await sendServerSignal(id, requestTo, "end");
    }
  }

  // Anyone still waiting on a departing user gets declined.
  const waiting = await prisma.presence.findMany({
    where: { requestTo: { in: ids }, id: { notIn: ids } },
    select: { id: true, requestTo: true },
  });
  for (const { id, requestTo } of waiting) {
    const { count } = await prisma.presence.updateMany({
      where: { id, requestTo },
      data: { requestTo: null, requestAt: null },
    });
    if (count > 0 && requestTo) await sendServerSignal(requestTo, id, "decline");
  }
}
