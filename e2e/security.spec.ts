import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from "@playwright/test";
import { haversineKm } from "../lib/geo";

// The Phase 3 attacks, replayed against the real API: each one must now be
// refused. Every "user" here is its own API context with its own client IP
// (x-real-ip, which Vercel sets in production and nothing sets locally), so
// the per-IP limits of one test don't leak into the next.

test.skip(
  !process.env.DATABASE_URL || !process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
  "Set DATABASE_URL and NEXT_PUBLIC_MAPBOX_TOKEN in .env to run the e2e suite",
);

const MANILA = { lat: 14.5995, lng: 120.9842 };
const CEBU = { lat: 10.3157, lng: 123.8854 };
const DAVAO = { lat: 7.1907, lng: 125.4553 };
const OFFER = JSON.stringify({ type: "offer", sdp: "v=0\r\n" });

interface User {
  api: APIRequestContext;
  id: string;
  token: string;
}

let nextIp = 1;
const opened: User[] = [];

async function newApi(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: test.info().project.use.baseURL,
    extraHTTPHeaders: { "x-real-ip": `198.51.100.${nextIp++ % 250}` },
  });
}

async function joinAs(
  where: { lat: number; lng: number },
  api?: APIRequestContext,
  token?: string,
): Promise<User> {
  const fresh = !api;
  api ??= await newApi();
  const res = await api.post("/api/join", { data: { ...where, token } });
  expect(res.status()).toBe(200);
  const user = { api, ...(await res.json()) } as User;
  if (fresh) opened.push(user);
  return user;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

function signal(
  from: User,
  toId: string,
  type: string,
  payload?: string,
  extra: Record<string, unknown> = {},
) {
  return from.api.post("/api/signal", {
    headers: bearer(from.token),
    data: { toId, type, payload, ...extra },
  });
}

async function poll(user: User) {
  const res = await user.api.get("/api/poll", { headers: bearer(user.token) });
  expect(res.status()).toBe(200);
  return res.json() as Promise<{
    peers: { id: string; lat: number; lng: number; busy: boolean }[];
    signals: { fromId: string; type: string; payload: string | null }[];
  }>;
}

async function connect(a: User, b: User) {
  expect((await signal(a, b.id, "request")).status()).toBe(200);
  expect((await signal(b, a.id, "accept")).status()).toBe(200);
}

test.afterEach(async () => {
  // Leave the map as we found it: the two-user spec expects an empty world.
  for (const u of opened.splice(0)) {
    await u.api.post("/api/leave", { headers: bearer(u.token) });
    await u.api.dispose();
  }
});

test("no token, no access", async () => {
  const api = await newApi();
  expect((await api.get("/api/poll")).status()).toBe(401);
  expect((await api.get("/api/poll", { headers: bearer("nope") })).status()).toBe(401);
  expect((await api.post("/api/leave")).status()).toBe(401);
  expect(
    (await api.post("/api/signal", { data: { toId: "x", type: "request" } })).status(),
  ).toBe(401);
  await api.dispose();
});

test("knowing someone's id doesn't let you act as them", async () => {
  const alice = await joinAs(MANILA);
  const mallory = await joinAs(CEBU);
  const carol = await joinAs(DAVAO);

  expect((await signal(carol, alice.id, "request")).status()).toBe(200);

  // Ids are public (every poll lists them), but an id is not a token: used
  // as one, it names some other, absent session. Mallory can't drain Alice's
  // inbox or kick her off the map.
  expect(
    (await mallory.api.get("/api/poll", { headers: bearer(alice.id) })).status(),
  ).toBe(410);
  await mallory.api.post("/api/leave", { headers: bearer(alice.id) });
  expect((await poll(carol)).peers.map((p) => p.id)).toContain(alice.id);
  const aliceInbox = (await poll(alice)).signals;
  expect(aliceInbox.map((s) => [s.type, s.fromId])).toEqual([
    ["request", carol.id],
  ]);

  // A forged fromId in the body is ignored: the request comes from Mallory.
  const res = await signal(mallory, carol.id, "request", undefined, {
    fromId: alice.id,
  });
  expect(res.status()).toBe(200);
  const inbox = (await poll(carol)).signals;
  expect(inbox.map((s) => s.fromId)).toEqual([mallory.id]);
});

test("an accept without a request is refused and pairs nobody", async () => {
  const alice = await joinAs(MANILA);
  const bob = await joinAs(CEBU);
  const observer = await joinAs(DAVAO);

  expect((await signal(alice, bob.id, "accept")).status()).toBe(409);
  const peers = (await poll(observer)).peers;
  expect(peers.find((p) => p.id === alice.id)?.busy).toBe(false);
  expect(peers.find((p) => p.id === bob.id)?.busy).toBe(false);
  expect((await poll(bob)).signals).toEqual([]);
});

test("two requests at each other pair them, with no accept", async () => {
  const alice = await joinAs(MANILA);
  const bob = await joinAs(CEBU);
  const carol = await joinAs(DAVAO);

  expect((await signal(alice, bob.id, "request")).status()).toBe(200);
  const back = await signal(bob, alice.id, "request");
  expect(back.status()).toBe(200);
  expect(await back.json()).toMatchObject({ matched: true });

  // Alice hears it as an accept and starts the call; SDP now flows.
  const inbox = (await poll(alice)).signals;
  expect(inbox.map((s) => [s.type, s.fromId])).toEqual([["accept", bob.id]]);
  expect((await signal(alice, bob.id, "offer", OFFER)).status()).toBe(200);
  const peers = (await poll(carol)).peers;
  expect(peers.find((p) => p.id === alice.id)?.busy).toBe(true);
  expect(peers.find((p) => p.id === bob.id)?.busy).toBe(true);
});

test("two requests sent at the same instant still pair exactly once", async () => {
  const alice = await joinAs(MANILA);
  const bob = await joinAs(CEBU);

  const [ab, ba] = await Promise.all([
    signal(alice, bob.id, "request"),
    signal(bob, alice.id, "request"),
  ]);
  expect(ab.status()).toBe(200);
  expect(ba.status()).toBe(200);
  const matched = [await ab.json(), await ba.json()].filter((r) => r.matched);
  expect(matched).toHaveLength(1);
  expect((await signal(alice, bob.id, "offer", OFFER)).status()).toBe(200);
});

test("SDP and ICE only flow between connected users, in WebRTC's shape", async () => {
  const alice = await joinAs(MANILA);
  const bob = await joinAs(CEBU);

  expect((await signal(alice, bob.id, "offer", OFFER)).status()).toBe(403);
  expect((await signal(alice, bob.id, "ice", '{"candidate":""}')).status()).toBe(403);

  await connect(alice, bob);
  expect((await signal(alice, bob.id, "offer", "not json")).status()).toBe(400);
  expect(
    (await signal(alice, bob.id, "offer", JSON.stringify({ type: "answer", sdp: "" }))).status(),
  ).toBe(400);
  expect((await signal(alice, bob.id, "request", "payload")).status()).toBe(400);

  // Extra fields are stripped before the peer sees them.
  const sneaky = JSON.stringify({ type: "offer", sdp: "v=0\r\n", extra: "<script>" });
  expect((await signal(alice, bob.id, "offer", sneaky)).status()).toBe(200);
  const offer = (await poll(bob)).signals.find((s) => s.type === "offer");
  expect(JSON.parse(offer!.payload!)).toEqual({ type: "offer", sdp: "v=0\r\n" });
});

test("a re-join with the same token is the same stranger on the same spot", async () => {
  const alice = await joinAs(MANILA);
  const observer = await joinAs(CEBU);
  const before = (await poll(observer)).peers.find((p) => p.id === alice.id)!;

  const again = await joinAs(MANILA, alice.api, alice.token);
  expect(again.id).toBe(alice.id);
  const after = (await poll(observer)).peers.find((p) => p.id === alice.id)!;
  expect(after).toEqual(before);

  const km = haversineKm(MANILA, after);
  expect(km).toBeGreaterThanOrEqual(1);
  expect(km).toBeLessThanOrEqual(3);
});

test("requests are rate limited", async () => {
  const alice = await joinAs(MANILA);
  const bob = await joinAs(CEBU);
  const carol = await joinAs(DAVAO);

  expect((await signal(alice, bob.id, "request")).status()).toBe(200);
  const res = await signal(alice, carol.id, "request");
  expect(res.status()).toBe(429);
  expect(Number(res.headers()["retry-after"])).toBeGreaterThan(0);
});

test("a flooded inbox stops accepting signals", async () => {
  test.setTimeout(120_000);
  const alice = await joinAs(MANILA);
  const bob = await joinAs(CEBU);
  await connect(alice, bob);

  const ice = JSON.stringify({ candidate: "candidate:1 1 udp 1 192.0.2.1 9 typ host" });
  const statuses: number[] = [];
  for (let i = 0; i < 100; i++) {
    statuses.push((await signal(alice, bob.id, "ice", ice)).status());
  }
  // Bob's inbox already holds the accept-side traffic plus ~100 ICE.
  expect(statuses).toContain(429);
});

test("security headers are set and the CSP doesn't break the map", async ({
  browser,
}) => {
  const context = await browser.newContext({
    geolocation: { latitude: MANILA.lat, longitude: MANILA.lng },
    permissions: ["geolocation"],
  });
  const page = await context.newPage();
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });

  const res = await page.goto("/");
  const headers = res!.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["permissions-policy"]).toContain("camera=(self)");

  await page.getByRole("button", { name: "Enter Pulse" }).click();
  await expect(page.locator(".mapboxgl-canvas")).toBeVisible();
  await expect(page.getByRole("button", { name: "Recenter on me" })).toBeVisible();
  // Let tiles, glyphs and the worker load.
  await page.waitForTimeout(3_000);
  expect(violations).toEqual([]);

  await context.close();
});
