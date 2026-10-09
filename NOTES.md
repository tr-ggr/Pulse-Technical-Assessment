# NOTES

## Phase 1 — Make it run

Full log with root causes and file references: [`docs/phase-1.md`](docs/phase-1.md).

**How I found them:**
- Read the whole lifecycle end to end (join → heartbeat → reaper → request/accept →
  SDP/ICE → data channel → video → end/leave).
- Compared each handler's code with its own comments and `docs/requirements.md`.
- For every state flag, asked "who clears this, and when?"
- Verified with two browsers: a manual playwright-cli run of two sessions on the real
  Neon + Mapbox stack, plus an automated two-context Playwright test (`npm run e2e`).
  The manual run found B6, which the first automated run had missed.

**What was broken → fix (one commit each):**
- **Dots never disappeared:** the poll heartbeat ran `updateMany({ where: {} })`,
  refreshing *everyone* on every poll, so the stale reaper never fired.
  → Heartbeat only the caller.
- **Chat never arrived:** the sender tagged messages `"msg"` but the receiver
  only accepted `"chat"`. → Use one tag.
- **Connections/video could fail to establish:** queued ICE candidates were
  flushed *before* `setRemoteDescription`, so they all threw (silently caught)
  and were lost. → Apply the remote description first, then flush.
- **Users stuck "busy" after one call:** `busy` was cleared on `decline` but not
  on `end`. → Clear on both. Pairing is now tracked in a `Presence.peerId`
  column, and only the actual pair is freed, so a stray decline can't free
  someone who is in another call.
- **Map broke silently without a token:** a fake fallback Mapbox token hid the
  "set your token" hint. → Removed it.
- **Couldn't end a video call on a laptop screen:** the remote video's intrinsic
  height pushed "End video" off-screen in a page that can't scroll. → `min-h-0`
  and an absolutely positioned video. The e2e test now asserts the control is in
  the viewport.

**Reliability fixes needed for "reliably connect":**
- **Leaving mid-chat stranded the partner:** leave and the stale reaper now free
  the partner and send them `end`. Leave no longer deletes the leaver's unsent
  `end`. The client also tears down as soon as the data channel closes.
- **A late accept after a timeout locked both users:** the requester now replies
  `end` to an accept it isn't waiting for.
- **A reaped user (throttled background tab, bfcache restore) was invisible for
  good:** poll returns `410 Gone`, and the client re-joins.

**Known, deferred:**
- Signals aren't sequenced, so offer/ICE can race. Perfect negotiation recovers
  in practice.
- Join failures aren't surfaced in the UI.
- No authentication on session ids. This is Phase 3.

**Schema change:** run `npx prisma migrate deploy` (or `db push`) to add
`Presence.peerId`. The Prisma CLI uses `DATABASE_URL_UNPOOLED` (the direct
connection) when it's set; the app uses the pooled `DATABASE_URL`.
