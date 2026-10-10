# NOTES

## Blockers and how I worked around them

Things I couldn't do the obvious way, what I did instead, and what's left.

- **IP privacy needs a TURN relay, which is an external service.** P2P WebRTC
  shows each peer the other's IP. → Documented as a known risk, not built
  (Phase 3, finding 6). → Left: run a TURN relay and force relay-only ICE.
- **Restricting the Mapbox token to the app's URL is a dashboard setting.** It
  can't be done in code. → Documented (Phase 3). → Left: set the URL
  restriction in the Mapbox account. The current key is a free-tier key I can
  no longer edit, and creating a new one requires a card.
- **No external services, so no Redis for rate limits.** → Postgres
  fixed-window counters that expire on their own, per IP and per session
  (Phase 3). → Left: the per-IP limits need tuning for carrier NAT.
- **HMAC session tokens would need a new secret on Vercel**, and couldn't be
  cancelled when a session ends. → The server issues a random token and the
  public id is SHA-256(token), so nothing secret is stored
  ([`docs/phase-3.md`](docs/phase-3.md)).
- **The only database is the live Neon DB the Vercel deployment uses**, with no
  separate dev database. → Every schema change in every phase is additive
  (`prisma db push` adds columns and tables only), and nothing destructive was
  run against it. → Left: a Neon branch per preview deployment.
- **The report-pause rule can't be tried by hand from one machine.** Two
  windows share a network, and by design a network can't pause itself. → The
  rule is exercised through the API in `e2e/safety.spec.ts` (Phase 4).

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
- ~~Join failures aren't surfaced in the UI.~~ Fixed in Phase 2: the entry gate
  shows the error and a retry.
- No authentication on session ids. This is Phase 3.

**Schema change:** run `npx prisma migrate deploy` (or `db push`) to add
`Presence.peerId`. The Prisma CLI uses `DATABASE_URL_UNPOOLED` (the direct
connection) when it's set; the app uses the pooled `DATABASE_URL`.

## Phase 2 — Make it good

Full write-up with screenshots: [`docs/phase-2.md`](docs/phase-2.md).

![Pulse entry gate](docs/screenshots/phase-2/desktop-1-gate.webp)

**Direction: "Nightfall".** Pulse is "a living globe of strangers", so the planet
is the hero. It's a 3D globe in starry space, the UI is frosted glass floating
over it, and the dots glow like bioluminescence.

**Design system:**
- **One colour rule:** warm ember means *you* (your beacon, your bubbles, your end
  of the arc, primary actions). Strangers get cool hues from their session id,
  and each keeps that colour everywhere: dot, orb, arc, chat tint.
- **Type:** Instrument Serif for personality, Geist for UI, Geist Mono for
  numbers. Fixed an `Arial` override that was hiding Geist.
- Tokens and a `glass` utility live in `globals.css` (`@theme`).

**What changed, and why:**
- **Map:** globe projection, atmosphere and stars, with `dark-v11` recoloured and
  decluttered. I chose this over Mapbox Standard/night: its 3D detail is
  invisible at Pulse's zooms and it renders slower.
- **Entry:** the gate floats over the live, spinning globe (opening on your side
  of the world), then flies you down to your beacon. Locating has its own state,
  and each error has specific copy and a retry.
- **Requests** say who and where: the stranger's orb, a coarse distance and
  direction, and a ring that drains over the real 30 s timeout. The incoming
  card is non-modal and sits at thumb height on phones.
- **The arc:** a great-circle line from you to the stranger, with a comet that
  searches, flies home when someone calls you, or pulses once connected. The
  map tells the same story as the panels.
- **Chat:** a glass card on desktop (globe still visible) or a bottom sheet on
  phones. Grouped, animated bubbles; connecting and empty states. Video
  negotiation is inline in the chat, and its accept card has no autofocus, so
  Enter mid-sentence can't turn on your camera.
- **Call:**
  - Layout: on desktop the stage sits beside the chat, so you can keep texting.
  - Controls: mute, camera off and a timer. Mute and camera state reach the other
    side over the data channel, so they see "Muted" or "Their camera is off"
    instead of a black frame.
  - The self-view is draggable and snaps to a corner.
- **Attention:** a background tab flashes its title and plays a soft synthesised
  chime when a request arrives.
- **HUD and notices:** live count, recenter, first-run hint, and one deduped
  `aria-live` toast stack.
- **Accessibility:**
  - Reduced motion is respected everywhere (spin, comet, CSS and motion
    transforms). The request countdown keeps running because it carries
    information.
  - Esc backs out of pending requests but never hangs up.
  - Focus rings; 44px touch targets; alertdialog semantics on request cards.

**Bugs found along the way:**
- **Dots jumped on hover.** The hover `transform` overwrote Mapbox's positioning
  transform, and Mapbox also writes marker `opacity` on the globe. Styling now
  lives on child elements and `data-*` attributes.
- **The glass panels had no blur.** The CSS minifier kept only
  `-webkit-backdrop-filter`, which Chrome ignores.
- **A dropped call blamed "the network".** It now says the connection to the
  stranger was lost. The e2e asserts that the chat closes, instead of racing two
  toasts.

**Constraints I kept:**
- No server API changes.
- The conn/video state machine is untouched; new UI state is derived during
  render.
- Distance is computed in the browser from your location to their dot, which is
  already public and offset 1–3 km. Nothing new leaves the browser.

**Verification:** lint, `tsc`, `next build` and `npm run e2e` all pass. The e2e
now also checks the request distance and the mute round trip. I also did manual
two-browser runs at 1440×900 and 390×844.

**Deferred:**
- Delivery latency for requests in long-hidden (throttled) tabs.
- A fade-out when a dot leaves.
- A cheaper glass fallback for low-end phones.

## Phase 3 — Make it secure

Full threat table, design reasoning and trade-offs: [`docs/phase-3.md`](docs/phase-3.md).

**How I reviewed it:** I read the four API routes as an attacker who has the
app open in DevTools. Every user's id is in the poll response, and every call
is a plain `fetch`. I replayed each finding against the running app, and each
fix has a matching refusal check in `e2e/security.spec.ts`.

**Ranked findings → status:**
1. **Critical: no auth.** The public session id was the only credential. Anyone
   could read another user's inbox, kick them, move their dot or send signals as
   them. → **Fixed:** the server issues a bearer token, and the public id is
   SHA-256(token).
2. **Critical: signaling MITM.** Forged SDP/ICE could insert the attacker's
   DTLS fingerprint into anyone's call. → **Fixed:** a server-side state
   machine; SDP/ICE only flows between two users the server has paired.
3. **Critical: a forged `accept`** paired anyone and could grey out the whole
   map. → **Fixed:** an accept needs a live request made to you, and both sides
   are claimed with conditional updates.
4. **High: no rate limits.** Fake-dot spam, DB flooding, request harassment, and
   a reaper that ran on every poll. → **Fixed:** Postgres fixed-window counters
   per IP and per session, a mailbox cap, and a reaper that runs at most once
   every 5 s under a lease.
5. **High: location triangulation.** A fresh offset on every re-join and every
   reload let an attacker average their way to your real location. → **Fixed:**
   snap to a 1 km grid, then offset on a ring that keeps the dot 1–3 km away,
   seeded per session. Averaging finds only the 1 km cell.
6. **High: P2P exposes each peer's IP.** → **Documented.** Fixing it needs a
   TURN relay, which is an external service.
7. **Medium:**
   - Payload and shape validation → **fixed**.
   - Security headers and CSP (anti-clickjacking for the camera and location
     prompts) → **fixed**.
   - Mapbox token URL restriction → **documented** (dashboard setting).
   - Hardcoded ngrok dev origin → **fixed**.

**Constraints I kept:** no external services (so no Redis for rate limits),
nothing about a user outlives their session (no token is stored, counters
expire, IPs are hashed), and the dot is still 1–3 km away with a new spot each
session.

**Schema change:** `npx prisma db push` adds `Presence.requestTo/requestAt`
and the `RateLimit` table. It only adds fields and a table.

**Verification:** `npm run e2e` now runs 12 tests: privacy, security and the
two-user flow. The two-user flow and the CSP check also pass against
`next start`. Lint, `tsc` and `next build` are clean.

**Next with more time:** a TURN relay for IP privacy, offsetting in the browser
so raw coordinates never leave the device, block/report for strangers, and
tuning the per-IP limits for users behind carrier NAT.

## Phase 4 — Make it better: Safe Reveal

Full write-up with screenshots: [`docs/phase-4.md`](docs/phase-4.md).

![Both cameras veiled until both say yes](docs/screenshots/phase-4/desktop-2-they-are-ready.webp)

**What I built:** safety without surveillance. The riskiest moment on a
random-stranger app is the first frame of video, and until now you only had
the End button, after you'd already seen it. Every check below runs on your
device or is agreed peer to peer. The server never sees chat or video.

- **Veil:** cameras start blurred *at the source*. Each frame is shrunk to
  12 px wide before it's encoded, so no detail ever leaves the device. Video
  clears only when **both** people tap Reveal. Either person can veil both
  again at any time, and the receiver also blurs in CSS in case a modified
  client skips the veil. Uses `replaceTrack`, so there's no renegotiation.
- **Guardian:** after reveal, an on-device classifier (nsfwjs + TF.js,
  self-hosted model, lazy-loaded) checks the stranger's video about once a
  second.
  - Two explicit frames in a row blur it again and offer: keep it blurred,
    show anyway, or report.
  - Nothing is uploaded, and the stranger isn't told.
  - It fails open, and the chip says so.
- **Block and report without accounts:**
  - **Block:** both dots disappear for each other, and requests are silently
    declined like a busy stranger.
  - **Report:** reports from **2 different networks** of people who
    **actually talked to** the stranger pause that network for 30 minutes.
    Their session is removed and joins are refused. One person can't abuse
    it: a network counts once, the target's own network never counts, and
    reports work even after the stranger fled.
- **Chat guard:** one "a stranger can't unsee this" prompt before you send a
  phone number, email, handle, link or address. Incoming links, "add me on
  WhatsApp" and money talk get a quiet caption. The patterns are
  conservative so the prompt stays meaningful.

**Why this:** it's the feature a real stranger-chat product would need before
launch. It turns Phase 3's deferred block/report into something with real
consequences, and it keeps Pulse's promise: no accounts, nothing stored past
the session or the 30-minute report window.

**Trade-offs:**
- The Guardian is about 90 % accurate and fails open; the veil is the primary
  protection.
- A pause can hit carrier-grade-NAT neighbours. It's bounded by the
  2-network rule, the conversation requirement and the 30-minute window.
- Audio flows before reveal, on purpose: talking first is what makes revealing
  feel safe.
- Blocks last a session; reports are what follow a network.

**Schema change:** `npx prisma db push` adds `Presence.ipKey/lastPeerId/
lastPeerIp` and the `Block` and `Report` tables. All additive.

**Verification:**
- `npm run e2e` runs 22 tests, also against the production build with
  `E2E_SERVER=start`. They cover:
  - veiled video stays ≤ 160 px wide until both reveal
  - the Guardian loads under the real CSP
  - the chat guard prompt
  - block from the UI
  - the report and pause rules via the API, plus pure tests of the patterns
- Lint, `tsc` and `build` are clean.
- Manual two-browser runs at 1440×900 and 390×844 found three layout bugs,
  all fixed.
- Two windows on one machine can't pause each other, by design (same
  network). The pause is exercised in `e2e/safety.spec.ts`.

**Next with more time:**
- a Guardian check of *your own* camera before you reveal
- run inference in a Worker
- escalating pauses for repeat offenders
- on-device text-toxicity softening
- TURN for IP privacy

## Phase 4+ — Extras

**Sound** (PR #6). One WebAudio engine in `lib/sound.ts` synthesises
everything, so there are no audio files and nothing for the CSP to block.
- Buttons tap, and mouse hovers tick quietly. Messages, connecting, hang-ups,
  notices and requests each get their own cue.
- A generative ambient pad plays while you're live and fades out during video
  calls, so it never competes with the other person's voice.
- A HUD toggle turns all sound off. The choice is remembered in
  `localStorage`.

**Mutual tap** (PR #7). Before, if two people requested each other at once,
each client auto-declined the other's request because it wasn't idle, and
both saw "Request declined".
- Now a request that meets a live request coming the other way pairs both
  users on the spot, in one atomic `UPDATE`, so it holds even when both
  arrive at the same instant.
- Tapping the dot of someone whose request card is showing accepts it.
- **Verification:** new e2e tests in `e2e/security.spec.ts` and
  `e2e/two-users.spec.ts`. They check that crossing requests pair without an
  accept, that simultaneous requests pair exactly once, and that two
  strangers tapping each other connect.
