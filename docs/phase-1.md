# Phase 1 — Make it run

## What Phase 1 is

Pulse ships with several bugs, and together they stop the app working end-to-end.
Phase 1 means finding and fixing each of them until two strangers can **reliably**:

1. see each other's dot on the map, and see it disappear when they leave;
2. tap a dot, send a connection request, and have it accepted;
3. text chat in both directions over the WebRTC data channel;
4. start a video call, accept it, and end it again;
5. hang up and connect again, with each other or someone else.

The README gives one example ("our dots stayed on the map for ages") and says
there are more.

## How the bugs were hunted

- **Static read of every server and client file.** I followed the full lifecycle:
  join → poll heartbeat → reaper → request/accept → offer/answer/ICE → data channel →
  video renegotiation → end/leave.
- I checked every handler's code against what its own comment and
  `docs/requirements.md` say it should do. Several bugs are exactly that kind of
  mismatch, for example a comment saying "decline/end", or sender and receiver
  using different message tags.
- I traced each state flag (`busy`, `lastSeen`, signal mailbox) through every
  transition, asking "who clears this, and when?"
- I confirm fixes with two browsers: a manual pass (normal + incognito window,
  mocked geolocation), plus a Playwright test with two browser contexts that
  replays the whole flow (`npm run e2e`, see `e2e/two-users.spec.ts`).

## Pairing model (introduced by the B4/S2 fixes)

`Presence.peerId` records who each user is connected to. It's set for both
users on `accept` and cleared on `end`/`decline`, but only for the pair
itself. When a user leaves or goes stale, `releaseUsers` (`lib/pairing.ts`)
frees their partner and drops an `end` into the partner's inbox. With that,
"if either user disconnects, the chat ends for both" (`docs/requirements.md`)
holds even when a tab crashes rather than closing cleanly.

## Verification

Run against a fresh Neon project (`aws-ap-southeast-1`) after `prisma migrate deploy`.
`prisma migrate diff` shows no drift between the database and `schema.prisma`.

- **Static checks:** `npx tsc --noEmit` and `npm run lint` are clean.
- **Automated:** `npm run e2e` passes (about 40 s). It uses two Chromium contexts
  (Manila and Cebu) with fake camera and mic, and covers:
  - see each other, connect
  - chat both ways
  - video both ways, with "End video" in the viewport
  - end video, hang up, reconnect
  - close one context: the chat ends and the dot disappears

  With the B6 fix reverted, the test fails on `toBeInViewport()`.
- **Manual (playwright-cli, two headless sessions):**

  | Check | Result |
  |---|---|
  | Both dots visible on the real Mapbox map | ✅ |
  | Connect: request, accept, "Connected" | ✅ |
  | Chat A→B and B→A | ✅ |
  | Video: both sides receive live audio and video tracks | ✅ |
  | End video returns both to chat | ✅ |
  | Hang up frees both (dots back to full opacity), reconnect works | ✅ |
  | Clean leave (navigate away mid-chat): partner's chat ends in under 1.6 s, dot gone in about 3.7 s | ✅ |
  | Hard kill (browser killed, no leave beacon): partner's chat ends and dot disappears in about 20 s, via the stale reaper and `releaseUsers` | ✅ |
  | All presence rows deleted server-side: both clients get 410, re-join, and see each other again | ✅ |

## Findings

Status: ✅ fixed · 📝 logged for a later phase

### Planted bugs

| # | Symptom | Root cause | Fix | Status |
|---|---------|------------|-----|--------|
| B1 | Dots stay on the map long after users close the app (README example) | `app/api/poll/route.ts`: the heartbeat ran `updateMany({ where: {} })`, so **every** poll refreshed `lastSeen` for **every** user, and the stale reaper never found anything while anyone was online | Heartbeat only the caller: `where: { id }` | ✅ |
| B2 | Chat messages never appear for the other person (the sender sees their own) | `lib/webrtc.ts`: `sendChat` sent `{ t: "msg" }`, but `onmessage` only accepts `t === "chat"`, so every message was silently dropped | Send `t: "chat"` | ✅ |
| B3 | The peer connection or video sometimes fails to establish | `lib/webrtc.ts` `handleSignal`: queued ICE candidates were flushed **before** `setRemoteDescription`. `addIceCandidate` throws without a remote description, the empty `catch {}` hid it, and the candidates were lost | Set the remote description first, then flush the queue | ✅ |
| B4 | After one chat ends, both users stay greyed out as "busy" forever, and every new request to them is auto-declined | `app/api/signal/route.ts`: `busy` was set on `accept` but only cleared on `decline`, never on `end`, even though the comment says "decline/end: free both peers" | Clear on `end` too. `accept` now also records the pairing in a new `Presence.peerId` column | ✅ |
| B5 | With no Mapbox token the map is silently blank: no hint, just 401s in the console | `app/components/WorldMap.tsx`: `NEXT_PUBLIC_MAPBOX_TOKEN ?? "pk.eyJ…fake"`. The fake fallback is truthy, so the "Set NEXT_PUBLIC_MAPBOX_TOKEN" help banner never shows | Remove the fallback | ✅ |
| B6 | During a video call, "End video" is off-screen on a normal laptop (800 px tall), so the call can't be ended. Found in a manual two-browser run with playwright-cli | `app/components/VideoPanel.tsx`: the remote `<video>` sits in a `flex-1` item with the default `min-height: auto`. Its intrinsic 4:3 height (960 px at 1280 wide) grows the item and pushes the control bar to y≈976. The page is `fixed overflow-hidden`, so it can't be scrolled to | `min-h-0` on the flex item and an absolutely positioned video. The e2e test now asserts `toBeInViewport()`: `click()` auto-scrolls, which is why the first green run missed this | ✅ |

### Reliability issues fixed in Phase 1

| # | Symptom | Root cause | Fix | Status |
|---|---------|------------|-----|--------|
| S1 | A tab that was throttled in the background, or restored from the back/forward cache, becomes permanently invisible | Once the reaper deletes the row, the heartbeat updates nothing and the client never joins again | Poll returns `410 Gone` when the caller has no row, and the client re-joins | ✅ |
| S2 | Closing the tab mid-chat leaves the partner stuck in a dead chat, still marked busy | `leave` didn't tell the partner or clear their `busy`. It also deleted the leaver's **outgoing** unread signals, which could include the `end` it had just sent. The client only reacted to connectionState `failed` | Track pairing with a `peerId` column. Leave and the reaper free the partner and send them `end`. Leave only deletes signals addressed to the leaver. The client tears down on data-channel close or connectionState `closed` | ✅ |
| S3 | An `accept` that arrives just after the requester gave up locks both users as busy | The server marks both busy on any `accept`, and the client silently ignored an unexpected accept | The client answers an unexpected `accept` with `end` | ✅ |
| S4 | A user in a chat can be marked free by a stray `decline` (an auto-decline of a third party) | `decline` cleared `busy` on both ids unconditionally | `end`/`decline` only clear users who are paired with each other (`peerId`) | ✅ |

### Logged, not fixed in Phase 1

| # | Issue | Why deferred |
|---|-------|--------------|
| S5 | `handleSignal` calls are not serialized and `sendSignal` is fire-and-forget, so offer and ICE can race. Signal order relies on millisecond `createdAt` | B3 plus perfect negotiation make the connection recover in practice. A proper sequence number is a protocol change |
| S6 | Join failures are ignored on the client | Robustness / UX, to handle with the Phase 2 entry flow |
| SEC | No authentication: session ids are broadcast to every client, and any caller can poll, leave or signal as any id. No rate limiting | Phase 3 (security review) |
