import { prisma } from "@/lib/prisma";

// Server-only. Call before deleting presence rows (leave / stale reap): any
// partner a departing user was paired with is freed and sent an `end`, so the
// chat ends for both even when the leaver crashed or closed the tab abruptly.
export async function releaseUsers(ids: string[]) {
  if (ids.length === 0) return;

  const paired = await prisma.presence.findMany({
    where: { id: { in: ids }, peerId: { not: null } },
    select: { id: true, peerId: true },
  });

  for (const { id, peerId } of paired) {
    if (!peerId) continue;
    // Only free the partner if it is still paired with this user; the count
    // also dedupes concurrent reapers so the `end` is sent once.
    const { count } = await prisma.presence.updateMany({
      where: { id: peerId, peerId: id },
      data: { busy: false, peerId: null },
    });
    if (count > 0) {
      await prisma.signal.create({
        data: { fromId: id, toId: peerId, type: "end", payload: null },
      });
    }
  }
}
