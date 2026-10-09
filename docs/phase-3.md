# Phase 3 — Make it secure

## Scope and method

The API is four route handlers: `join`, `poll`, `signal` and `leave` (in
`app/api/`). It also includes the server helpers they call. I read each one as
an attacker who has the app open in DevTools. Every user's id is in the poll
response, and every request is a plain `fetch` that's easy to replay.

Constraints from `docs/requirements.md` shaped the fixes:
- deploy on Vercel with **no external services** (so no Redis or Upstash);
- **nothing kept** about a user once their session ends;
- the dot stays **1–3 km** from the real location, with a **different position
  each session**.

Each finding below was confirmed by replaying it against the running app.
Each fix has a matching check in `e2e/security.spec.ts`.

## Findings, ranked

Ranked by how bad the outcome is, then by how easy the attack is. Every
attack needs only a browser.

| # | Severity | Finding | Impact | Status |
|---|----------|---------|--------|--------|
| C1 | Critical | **No authentication.** The session id was the only credential, and `/api/poll` lists every user's id. | Anyone could read another user's inbox (`poll?id=`), kick them (`leave`), move their dot (`join`), or send any signal as them (`fromId`). | Fixed |
| C2 | Critical | **Signaling MITM.** The server forwarded `offer`/`answer`/`ice` between any two ids. | With C1, an attacker could swap in their own SDP. That puts their DTLS fingerprint in the handshake, so they can intercept chat and video. It also broke "no messaging before accept". | Fixed |
| C3 | Critical | **A forged `accept` needed no request.** It marked both ids busy and paired them. | Pair any two strangers, or loop over the map and grey out every dot, so nobody can connect. | Fixed |
| H1 | High | **No rate limits or quotas.** | Spam fake dots, fill the database with 64 KB signals (free-tier Neon), send one person a request every second, and multiply database load, because every poll also ran the reaper. | Fixed |
| H2 | High | **Location triangulation.** Every join picked a fresh random offset, and the client re-joins after a reap and on every reload. | Collect enough dots from one user and the average converges on their real location. | Fixed (bounded to a 1 km cell) |
| H3 | High | **P2P reveals each peer's public IP** to the other side. | IP-based geolocation and abuse. | Documented, not fixed. Needs a relay-only TURN server, which is an external service the requirements rule out. |
| M1 | Medium | **Loose input validation.** Ids weren't checked; any string up to 64 KB was stored as a payload; accept/busy updates could race. | Junk relayed to peers; inconsistent busy flags. | Fixed |
| M2 | Medium | **Unbounded mailbox** per recipient. | Flood one user's inbox and every poll they make. | Fixed |
| M3 | Medium | **No security headers.** | Any site could frame the page and clickjack the camera, microphone and location prompts. No `nosniff` or Referrer-Policy. | Fixed |
| M4 | Medium | **Public Mapbox token** (`NEXT_PUBLIC_*`) with no URL restriction. | Others can use our token and spend our quota. | Documented. It's a dashboard setting: restrict the token to the production domain. |
| L1 | Low | `allowedDevOrigins` hardcoded a personal ngrok host. | Dev-only exposure. | Fixed (comes from the `DEV_ORIGINS` env var) |

## Fixes

### C1 — Server-issued session tokens (`lib/session.ts`)
- `join` issues a random 256-bit token and returns `{ id, token }`. The public id
  is `SHA-256("pulse:id:" + token)`.
- Knowing an id doesn't help an attacker: used as a token, it hashes to a
  different id that has no session.
- The server never stores the token. Auth is just "does your token hash to an
  existing row".
- `poll`, `signal` and `leave` take the caller from `Authorization: Bearer`
  and ignore any id in the body or query.
- The token lives only in the tab's memory. Re-joining with it after a reap
  restores the same id.
- `leave` switched from `sendBeacon` to a `keepalive` fetch, because a beacon
  can't send headers.
- Why not a cookie: two tabs in one browser profile would share a session.
- Why not HMAC: it needs a new secret on Vercel, and the token couldn't be
  cancelled when the session ends.

### C2, C3 — Server-side connection state machine (`lib/signaling.ts`)
New `Presence.requestTo` and `requestAt` fields record the one outgoing request
a user can have.

| Signal | Allowed when |
|--------|--------------|
| `request` | You aren't busy. The target is offline or busy → auto-decline (unchanged). A new request replaces your previous one. |
| `accept` | The other user has a live request to **you** (30 s plus a 5 s grace). |
| `decline` | There's a pending request to you. |
| `end` | You're paired with them, or you're cancelling your own request. |
| `offer` / `answer` / `ice` | Both rows point at each other through `peerId`. |

- Each step is a conditional `updateMany`, and its row count says whether it
  applied. No interactive transactions, because they're unreliable over the
  PgBouncer pooler.
- `accept` claims the accepter first, then the initiator. If the second claim
  fails it undoes the first, so two racing accepts can't both pair.
- Leaving or being reaped withdraws your request and declines anyone waiting on
  you.
- On the client, a rejected accept now shows "That request expired" instead of
  hanging on "Connecting…".

### H1 — Rate limits in Postgres (`lib/ratelimit.ts`)
Fixed-window counters live in a `RateLimit` table. Each hit is one atomic
`INSERT … ON CONFLICT DO UPDATE … RETURNING`, so serverless instances can't
both slip under a limit.

| Scope | Limit | Why |
|-------|-------|-----|
| Per IP (hashed) | 600 req/min | Every fake dot must poll about 40/min to stay alive, so one IP can keep about 15 dots up |
| Per IP | 10 joins/min | Session creation |
| Per session | 60 polls/min | Normal use is 40 |
| Per session | 120 signals/min | ICE comes in bursts |
| Per session | 6 requests/min, 3 s apart | Request harassment |
| Per recipient | 100 undelivered signals | Mailbox flooding |

- The client IP comes from `x-real-ip`, which Vercel's proxy sets and overwrites,
  so it can't be spoofed in production. It's hashed before it's stored.
- Over the limit returns `429` with `Retry-After`. The poll loop waits that long,
  and a limited request shows a "wait a few seconds" toast.
- The reaper no longer runs on every poll. Polls race for a 5 s lease (a
  conditional upsert on the same table), and only the winner reaps: stale users,
  expired requests, old signals and dead counters (`lib/reaper.ts`). Ghost dots
  stay hidden right away, because poll already filters by `lastSeen`.
- Trade-off: many real users behind one NAT or carrier-grade NAT share the
  per-IP budget. The limits are constants in one file, so they're easy to tune
  with real traffic.

### H2 — Grid snap plus one dot per session (`lib/geo.ts` `placeDot`)
- The real location is snapped to the centre of a 1 km grid cell.
- The dot is then placed on a ring of [1 + 1/√2, 3 − 1/√2] ≈ [1.73, 2.27] km
  around that centre (with a little slack). The real point is at most 1/√2 km
  from the centre, so the dot is always 1–3 km from the user.
- Averaging any number of dots only recovers the **cell centre**.
- The offset is seeded from the session token. Re-joins land on the same spot,
  so one session leaks one sample. A new session gets a new seed and a new
  spot, as the requirements ask.
- `e2e/privacy.spec.ts` checks 10,000 placements at every latitude, re-join
  stability, and that averaging 5,000 sessions finds the cell rather than the
  user.

### M1, M2 — Validation (`app/api/signal/route.ts`)
- Control signals (`request`, `accept`, `decline`, `end`) must not carry a
  payload.
- `offer`/`answer` must be `{ type matching the signal, sdp: string }`; `ice`
  must have a string `candidate`.
- Payloads are re-serialised from known fields only, so nothing else reaches
  the peer.
- Size caps: 32 KB per payload, and bodies over that get `413` before parsing.
- Ids and tokens must be 43-character base64url.

### M3 — Headers (`next.config.ts`)
- A static CSP:
  - only `self` plus Mapbox;
  - `blob:` workers, which Mapbox GL needs;
  - `object-src 'none'`;
  - `frame-ancestors 'none'`;
  - `upgrade-insecure-requests` in production.
- No nonces: they would force every page to render dynamically, and the app
  renders no HTML from other users (chat is text inserted by React).
- Also `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, and a
  `Permissions-Policy` limiting camera, microphone and geolocation to this
  origin.
- Checked against both `next dev` and `next start`: the map and the video call
  work with no CSP violations.

## Verification
- `npm run e2e` runs `privacy`, `security` and `two-users`: 12 tests.
- `security.spec.ts` replays each attack above and expects a refusal. It also
  loads the page and checks the headers and that there are no CSP violations.
- The two-user flow (connect, chat, video, mute, hang up, reconnect, leave)
  passes against both the dev and production servers.
- `npm run lint`, `tsc --noEmit` and `next build` are clean.

## Not fixed, and what I'd do next
- **H3, IP exposure:** add a TURN relay with `iceTransportPolicy: "relay"`, so
  peers only see the relay's address. It needs a TURN provider, an external
  service.
- **M4, Mapbox token:** restrict it to the production URL in the Mapbox
  dashboard.
- **Raw coordinates still reach the server** (they're snapped and offset, then
  dropped, never stored). Running `placeDot` in the browser would mean they
  never leave the device. The server would then have to trust where the dot is,
  but it already has to trust the raw location the browser reports.
- **Block and report** a stranger, plus per-session reputation. That's
  moderation more than API hardening, and a good fit for Phase 4 ("safe").
- **Strict nonce CSP** once anything renders user-controlled HTML.
