import { expect, test } from "@playwright/test";
import { cautionFor, detectSensitive } from "../lib/chatGuard";
import {
  EXPLICIT_THRESHOLD,
  explicitScore,
  shouldVeil,
} from "../lib/guardian";

// Pure checks on the on-device safety logic (no browser, no database): what
// the chat guard flags, what it leaves alone, and when the Guardian veils.

test("the chat guard asks before you share what identifies you", () => {
  const cases: [string, ReturnType<typeof detectSensitive>][] = [
    ["mail me at jo.doe+pulse@gmail.com", "email"],
    ["my number is +63 917 123 4567", "phone"],
    ["call (555) 123-4567 later", "phone"],
    ["text 0917-123-4567", "phone"],
    ["find me @jo_doe92", "handle"],
    ["ig: jo.doe", "handle"],
    ["my insta is jo_doe92", "handle"],
    ["check out https://example.org/me", "link"],
    ["it's on joportfolio.io", "link"],
    ["I'm at 221 Baker Street, London", "address"],
    ["my address is near the park", "address"],
  ];
  for (const [text, kind] of cases) {
    expect(detectSensitive(text), text).toBe(kind);
  }
});

test("the chat guard stays quiet in ordinary conversation", () => {
  const ordinary = [
    "hi! where are you from?",
    "I'm 25 and I study in Cebu",
    "I worked there 2019-2023",
    "it's a 2 hour road trip from here",
    "my insta is great for food pics",
    "the score was 3-2, crazy game",
    "it costs 1,500 pesos",
    "lol ok.so what now",
    "a 10 minute drive",
  ];
  for (const text of ordinary) {
    expect(detectSensitive(text), text).toBeNull();
  }
});

test("a stranger's link, off-platform ask or money talk gets a note", () => {
  expect(cautionFor("click https://bit.ly/free-thing")).toBe("link");
  expect(cautionFor("add me on WhatsApp instead")).toBe("offplatform");
  expect(cautionFor("let's move to telegram")).toBe("offplatform");
  expect(cautionFor("can you send me a gift card?")).toBe("money");
  expect(cautionFor("I can teach you crypto investing")).toBe("money");
  expect(cautionFor("haha same, I love that band")).toBeNull();
  expect(cautionFor("what time is it there?")).toBeNull();
});

test("the Guardian veils on explicit frames in a row, not on one odd frame", () => {
  const explicit = explicitScore([
    { className: "Porn", probability: 0.55 },
    { className: "Hentai", probability: 0.1 },
    { className: "Neutral", probability: 0.35 },
  ]);
  expect(explicit).toBeCloseTo(0.65);
  expect(explicit).toBeGreaterThanOrEqual(EXPLICIT_THRESHOLD);

  // "Sexy" (swimwear, a bare shoulder) isn't explicit on its own.
  const suggestive = explicitScore([
    { className: "Sexy", probability: 0.9 },
    { className: "Neutral", probability: 0.1 },
  ]);
  expect(suggestive).toBe(0);

  expect(shouldVeil([])).toBe(false);
  expect(shouldVeil([0.9])).toBe(false);
  expect(shouldVeil([0.9, 0.2])).toBe(false);
  expect(shouldVeil([0.2, 0.9])).toBe(false);
  expect(shouldVeil([0.7, 0.9])).toBe(true);
  expect(shouldVeil([0.1, 0.6, 0.6])).toBe(true);
});
