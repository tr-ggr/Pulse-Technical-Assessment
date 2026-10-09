import { expect, test, type Browser, type Page } from "@playwright/test";

// Full flow with two real browser contexts (two strangers):
// see each other → connect → chat both ways → video (mute) → hang up →
// reconnect → one closes the tab → the other's chat ends and the dot goes.
//
// Runs against the real local stack, so it needs DATABASE_URL and
// NEXT_PUBLIC_MAPBOX_TOKEN. Use an otherwise idle database: the test expects
// to be the only two users online.

test.skip(
  !process.env.DATABASE_URL || !process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
  "Set DATABASE_URL and NEXT_PUBLIC_MAPBOX_TOKEN in .env to run the e2e suite",
);

const MANILA = { latitude: 14.5995, longitude: 120.9842 };
const CEBU = { latitude: 10.3157, longitude: 123.8854 };

// Anything the CSP blocks during the flow (e.g. the Guardian's TF.js).
const cspViolations: string[] = [];

async function enter(browser: Browser, geolocation: typeof MANILA) {
  const context = await browser.newContext({
    geolocation,
    permissions: ["geolocation", "camera", "microphone"],
  });
  const page = await context.newPage();
  page.on("console", (m) => {
    if (/Content Security Policy/i.test(m.text())) cspViolations.push(m.text());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Enter Pulse" }).click();
  return { context, page };
}

function remoteVideoHasTrack(page: Page) {
  // The first <video> in VideoPanel is the remote (full-screen) one.
  return page
    .locator("video")
    .first()
    .evaluate((v: HTMLVideoElement) => {
      const s = v.srcObject as MediaStream | null;
      return !!s && s.getVideoTracks().length > 0;
    });
}

// Decoded width of the stranger's video as this page receives it.
function remoteVideoWidth(page: Page) {
  return page
    .locator("video")
    .first()
    .evaluate((v: HTMLVideoElement) => v.videoWidth);
}

function stage(page: Page) {
  return page.locator('section[aria-label="Video call"]');
}

async function connect(a: Page, b: Page) {
  const dot = a.locator(".pulse-dot");
  await expect(dot).toHaveCount(1);
  // Busy peers can't be tapped; wait until B is free. (Not marker opacity:
  // on the globe Mapbox writes that itself to fade dots past the horizon.)
  await expect(dot).toHaveAttribute("data-busy", "false");
  await dot.click();
  await expect(a.getByText("Requesting connection…")).toBeVisible();

  await expect(b.getByText("A stranger wants to connect")).toBeVisible();
  // The card says roughly where the request comes from (Manila ↔ Cebu).
  await expect(b.getByText(/~\d[\d,]* km away/)).toBeVisible();
  await b.getByRole("button", { name: "Accept" }).click();

  // "Connected" only shows once the WebRTC data channel is open.
  await expect(a.getByText("Connected", { exact: true })).toBeVisible();
  await expect(b.getByText("Connected", { exact: true })).toBeVisible();
}

async function send(page: Page, text: string) {
  await page.getByPlaceholder("Type a message…").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

test("two strangers can see, connect, chat, video, reconnect and leave", async ({
  browser,
}) => {
  const alice = await enter(browser, MANILA);
  const bob = await enter(browser, CEBU);
  const a = alice.page;
  const b = bob.page;

  // Both see exactly one other dot (stale rows from earlier runs are reaped).
  await expect(b.locator(".pulse-dot")).toHaveCount(1);
  await connect(a, b);

  // Chat both directions (B2).
  await send(a, "hello from alice");
  await expect(b.getByText("hello from alice")).toBeVisible();
  await send(b, "hi alice, bob here");
  await expect(a.getByText("hi alice, bob here")).toBeVisible();

  // Video: A asks, B accepts, both receive the other's video track (B3).
  await a.getByRole("button", { name: "Video" }).click();
  await expect(b.getByText("Start video call?")).toBeVisible();
  await b.getByRole("button", { name: "Accept" }).click();
  await expect.poll(() => remoteVideoHasTrack(a)).toBe(true);
  await expect.poll(() => remoteVideoHasTrack(b)).toBe(true);

  // Safe Reveal: both cameras arrive veiled, shrunk to a smudge at the
  // source, so what each side receives is tiny, until both say yes.
  await expect(stage(a)).toHaveAttribute("data-veiled", "true");
  await expect.poll(() => remoteVideoWidth(a)).toBeGreaterThan(0);
  expect(await remoteVideoWidth(a)).toBeLessThanOrEqual(160);
  await a.getByRole("button", { name: "Reveal my camera" }).click();
  await expect(b.getByText("They’re ready to reveal")).toBeVisible();
  await expect(stage(b)).toHaveAttribute("data-veiled", "true");
  await b.getByRole("button", { name: "Reveal my camera" }).click();
  await expect(stage(a)).toHaveAttribute("data-veiled", "false");
  await expect(stage(b)).toHaveAttribute("data-veiled", "false");
  await expect.poll(() => remoteVideoWidth(a)).toBeGreaterThan(160);
  await expect.poll(() => remoteVideoWidth(b)).toBeGreaterThan(160);
  // The Guardian model loads and runs on-device (under the CSP).
  await expect(stage(a)).toHaveAttribute("data-guardian", "on", {
    timeout: 60_000,
  });
  // Either side can put the veil back over both cameras.
  await b.getByRole("button", { name: "Veil cameras" }).click();
  await expect(stage(a)).toHaveAttribute("data-veiled", "true");
  await expect(stage(b)).toHaveAttribute("data-veiled", "true");
  await expect.poll(() => remoteVideoWidth(a)).toBeLessThanOrEqual(160);

  // The page is fixed/overflow-hidden, so a user can't scroll to the control:
  // it must be on screen (B6). click() alone would auto-scroll and hide this.
  await expect(a.getByRole("button", { name: "End video" })).toBeInViewport();
  await expect(b.getByRole("button", { name: "End video" })).toBeInViewport();
  // Muting is local (track.enabled) and announced to the other side.
  const mute = a.getByRole("button", { name: "Mute microphone" });
  await mute.click();
  await expect(mute).toHaveAttribute("aria-pressed", "true");
  await expect(b.getByText("Muted", { exact: true })).toBeVisible();

  await a.getByRole("button", { name: "End video" }).click();
  await expect(a.getByRole("button", { name: "End video" })).toBeHidden();
  await expect(b.getByRole("button", { name: "End video" })).toBeHidden();

  // Hang up, then reconnect: both must have been freed from `busy` (B4).
  await a.getByRole("button", { name: "End", exact: true }).click();
  await expect(b.getByText("Stranger disconnected.")).toBeVisible();
  await connect(a, b);

  // B closes the tab mid-chat: A's chat ends (S2) and B's dot goes away (B1).
  // A killed tab can't always say goodbye, so A learns of it from either the
  // server's stale reaper ("Stranger disconnected.") or ICE failing ("Lost the
  // connection…"), whichever is first. Assert the outcome: A's chat closes.
  await bob.context.close();
  await expect(a.getByRole("button", { name: "End", exact: true })).toBeHidden({
    timeout: 40_000,
  });
  await expect(a.locator(".pulse-dot")).toHaveCount(0, { timeout: 30_000 });

  await alice.context.close();
  expect(cspViolations).toEqual([]);
});

test("the chat guard, then blocking from the chat", async ({
  browser,
}) => {
  // Wait out any ghost from the previous test (stale after 15 s), so the
  // only dot Alice can tap is Bob's. An empty map only means something once
  // a poll has actually come back.
  const alice = await enter(browser, MANILA);
  await alice.page.waitForResponse((r) => r.url().includes("/api/poll"));
  await alice.page.waitForResponse((r) => r.url().includes("/api/poll"));
  await expect(alice.page.locator(".pulse-dot")).toHaveCount(0, {
    timeout: 30_000,
  });
  const bob = await enter(browser, CEBU);
  const a = alice.page;
  const b = bob.page;
  await connect(a, b);

  // Sharing a phone number asks first; nothing is sent until you confirm.
  await send(a, "my number is 0917 123 4567");
  await expect(a.getByText("That looks like a phone number.")).toBeVisible();
  await a.getByRole("button", { name: "Send anyway" }).click();
  await expect(b.getByText("my number is 0917 123 4567")).toBeVisible();
  // A stranger asking to move apps gets a quiet note on the other side.
  await send(b, "add me on telegram instead");
  await expect(a.getByText("Moving off Pulse? Take your time")).toBeVisible();

  await a.getByRole("button", { name: "Safety" }).click();
  await expect(a.getByText("Not feeling right?")).toBeVisible();
  await a.getByRole("button", { name: /^Block The chat ends/ }).click();
  await expect(
    a.getByText("Blocked. You won’t see each other again."),
  ).toBeVisible();
  await expect(a.locator(".pulse-dot")).toHaveCount(0);

  // Bob is only told the stranger left, and loses Alice's dot too.
  await expect(b.getByText("Stranger disconnected.")).toBeVisible();
  await expect(b.locator(".pulse-dot")).toHaveCount(0);

  await alice.context.close();
  await bob.context.close();
  expect(cspViolations).toEqual([]);
});
