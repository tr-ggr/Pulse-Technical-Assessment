import { expect, test, type Browser, type Page } from "@playwright/test";

// Full Phase 1 flow with two real browser contexts (two strangers):
// see each other → connect → chat both ways → video → hang up → reconnect →
// one closes the tab → the other's chat ends and the dot disappears.
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

async function enter(browser: Browser, geolocation: typeof MANILA) {
  const context = await browser.newContext({
    geolocation,
    permissions: ["geolocation", "camera", "microphone"],
  });
  const page = await context.newPage();
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

async function connect(a: Page, b: Page) {
  const dot = a.locator(".pulse-dot");
  await expect(dot).toHaveCount(1);
  // Busy peers can't be tapped; wait until B is free. (Not marker opacity:
  // on the globe Mapbox writes that itself to fade dots past the horizon.)
  await expect(dot).toHaveAttribute("data-busy", "false");
  await dot.click();
  await expect(a.getByText("Requesting connection…")).toBeVisible();

  await expect(b.getByText("A stranger wants to connect")).toBeVisible();
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

  // The page is fixed/overflow-hidden, so a user can't scroll to the control:
  // it must be on screen (B6). click() alone would auto-scroll and hide this.
  await expect(a.getByRole("button", { name: "End video" })).toBeInViewport();
  await expect(b.getByRole("button", { name: "End video" })).toBeInViewport();
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
});
