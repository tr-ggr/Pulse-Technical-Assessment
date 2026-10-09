import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from "@playwright/test";

// Phase 4: block and report, against the real API. Each "user" is its own
// API context with its own client IP (x-real-ip). Reports outlive a run by
// up to 30 minutes, so every run uses fresh IPv6 documentation addresses —
// a rerun must never find its "target" already paused.

test.skip(
  !process.env.DATABASE_URL || !process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
  "Set DATABASE_URL and NEXT_PUBLIC_MAPBOX_TOKEN in .env to run the e2e suite",
);

const MANILA = { lat: 14.5995, lng: 120.9842 };
const CEBU = { lat: 10.3157, lng: 123.8854 };

interface User {
  api: APIRequestContext;
  id: string;
  token: string;
}

const RUN = Math.floor(Math.random() * 0xffff).toString(16);
let nextIp = 1;
const opened: User[] = [];

async function newApi(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: test.info().project.use.baseURL,
    extraHTTPHeaders: { "x-real-ip": `2001:db8:${RUN}::${nextIp++}` },
  });
}

// A new stranger on its own network, or another tab on `api`'s network.
async function joinAs(
  where: { lat: number; lng: number },
  api?: APIRequestContext,
): Promise<User> {
  api ??= await newApi();
  const res = await api.post("/api/join", { data: where });
  expect(res.status()).toBe(200);
  const user = { api, ...(await res.json()) } as User;
  opened.push(user);
  return user;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

function signal(from: User, toId: string, type: string) {
  return from.api.post("/api/signal", {
    headers: bearer(from.token),
    data: { toId, type },
  });
}

function report(from: User, toId: string, asReport: boolean) {
  return from.api.post("/api/report", {
    headers: bearer(from.token),
    data: { toId, report: asReport },
  });
}

async function poll(user: User) {
  const res = await user.api.get("/api/poll", { headers: bearer(user.token) });
  expect(res.status()).toBe(200);
  return res.json() as Promise<{
    peers: { id: string }[];
    signals: { fromId: string; type: string }[];
  }>;
}

async function connect(a: User, b: User) {
  expect((await signal(a, b.id, "request")).status()).toBe(200);
  expect((await signal(b, a.id, "accept")).status()).toBe(200);
}

test.afterEach(async () => {
  const apis = new Set<APIRequestContext>();
  for (const u of opened.splice(0)) {
    await u.api.post("/api/leave", { headers: bearer(u.token) });
    apis.add(u.api);
  }
  for (const api of apis) await api.dispose();
});

test("you can only block or report a stranger you're dealing with", async () => {
  const a = await joinAs(MANILA);
  const b = await joinAs(CEBU);
  // Never talked, no request: b is just a dot on a's map.
  expect((await report(a, b.id, true)).status()).toBe(403);
  expect((await report(a, b.id, false)).status()).toBe(403);
  expect((await report(a, a.id, false)).status()).toBe(400);
});

test("block ends the call, hides both dots and refuses their requests", async () => {
  const a = await joinAs(MANILA);
  const b = await joinAs(CEBU);
  await connect(a, b);
  await poll(a);
  await poll(b);

  expect((await report(a, b.id, false)).status()).toBe(200);

  // b just sees the call end, as if a had hung up.
  const bView = await poll(b);
  expect(bView.signals).toContainEqual(
    expect.objectContaining({ fromId: a.id, type: "end" }),
  );
  // Neither sees the other on the map any more.
  expect(bView.peers.map((p) => p.id)).not.toContain(a.id);
  expect((await poll(a)).peers.map((p) => p.id)).not.toContain(b.id);

  // A new request is declined like a busy stranger, and never reaches a.
  const retry = await signal(b, a.id, "request");
  expect(await retry.json()).toMatchObject({ autoDeclined: true });
  expect((await poll(b)).signals).toContainEqual(
    expect.objectContaining({ fromId: a.id, type: "decline" }),
  );
  expect((await poll(a)).signals).toEqual([]);
});

test("a stranger who keeps asking can be blocked from the request", async () => {
  const a = await joinAs(MANILA);
  const b = await joinAs(CEBU);
  expect((await signal(b, a.id, "request")).status()).toBe(200);

  // Reporting needs a conversation; blocking an incoming request doesn't.
  expect((await report(a, b.id, true)).status()).toBe(403);
  expect((await report(a, b.id, false)).status()).toBe(200);
  expect((await poll(b)).signals).toContainEqual(
    expect.objectContaining({ fromId: a.id, type: "decline" }),
  );
});

test("reports from two different networks pause the reported network", async () => {
  const target = await joinAs(CEBU);
  const first = await joinAs(MANILA);
  const firstAgain = await joinAs(MANILA, first.api); // same network, new tab
  const second = await joinAs(MANILA);

  // Reported after the call ended: still counts (they may have fled).
  await connect(first, target);
  expect((await signal(first, target.id, "end")).status()).toBe(200);
  expect((await report(first, target.id, true)).status()).toBe(200);

  // The same network reporting again counts once.
  await connect(firstAgain, target);
  expect((await report(firstAgain, target.id, true)).status()).toBe(200);
  await poll(target);

  // A second network tips it over: the target is taken off the map...
  await connect(second, target);
  expect((await report(second, target.id, true)).status()).toBe(200);
  const gone = await target.api.get("/api/poll", {
    headers: bearer(target.token),
  });
  expect(gone.status()).toBe(410);

  // ...and can't come back, under any session, while the pause lasts.
  const rejoin = await target.api.post("/api/join", {
    data: { ...CEBU, token: target.token },
  });
  expect(rejoin.status()).toBe(403);
  const body = await rejoin.json();
  expect(body.error).toBe("paused");
  expect(body.retryAfter).toBeGreaterThan(25 * 60);
  const fresh = await target.api.post("/api/join", { data: CEBU });
  expect(fresh.status()).toBe(403);
});

test("reports from the target's own network don't count", async () => {
  const target = await joinAs(CEBU);
  const housemate = await joinAs(MANILA, target.api); // same router
  const other = await joinAs(MANILA);

  await connect(housemate, target);
  expect((await report(housemate, target.id, true)).status()).toBe(200);
  await connect(other, target);
  expect((await report(other, target.id, true)).status()).toBe(200);

  // Only one report counted, so the target is still online.
  await poll(target);
});
