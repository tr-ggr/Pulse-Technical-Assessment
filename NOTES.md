# NOTES

## Phase 1 — Make it run

Full log with root causes and file references: [`docs/phase-1.md`](docs/phase-1.md).

**How I found them:**
- Read the whole lifecycle end to end (join → heartbeat → reaper → request/accept →
  SDP/ICE → data channel → video → end/leave).
- Compared each handler's code with its own comments and `docs/requirements.md`.
- For every state flag, asked "who clears this, and when?"
- Verification uses two browsers: a manual pass plus an automated two-context
  Playwright run (`npm run e2e`).

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

**Schema change:** run `npx prisma db push` (or `prisma migrate deploy`) to add
`Presence.peerId`.
