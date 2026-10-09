import { prisma } from "@/lib/prisma";
import { releaseUsers } from "@/lib/pairing";
import { REQUEST_TIMEOUT_MS, SIGNAL_TTL_MS, STALE_MS } from "@/lib/presence";
import { RATE_WINDOW_MAX_MS, tryLease } from "@/lib/ratelimit";
import { sweepSafety } from "@/lib/safety";

// Server-only. Housekeeping used to run on every poll from every user, so
// load on the database grew with traffic and anyone polling fast could
// multiply it. Now polls race for a 5 s lease and only the winner reaps.
// Ghost dots don't depend on it (poll already filters by lastSeen); the lease
// only delays how soon a vanished user's partner gets `end`, by up to 5 s.
const REAP_EVERY_MS = 5_000;

export async function reapIfDue() {
  if (!(await tryLease("lease:reap", REAP_EVERY_MS))) return;

  const now = Date.now();
  const staleCutoff = new Date(now - STALE_MS);

  // Stale users who were mid-connection free + notify their partner first.
  // Independent deletes: no transactions over a PgBouncer pooler.
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

  await prisma.presence.updateMany({
    where: { requestAt: { lt: new Date(now - REQUEST_TIMEOUT_MS * 2) } },
    data: { requestTo: null, requestAt: null },
  });
  await prisma.signal.deleteMany({
    where: { createdAt: { lt: new Date(now - SIGNAL_TTL_MS) } },
  });
  await prisma.rateLimit.deleteMany({
    where: {
      windowStart: { lt: new Date(now - RATE_WINDOW_MAX_MS * 2) },
      NOT: { key: { startsWith: "lease:" } },
    },
  });
  await sweepSafety(now);
}
