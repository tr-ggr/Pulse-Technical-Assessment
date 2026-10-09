// Chat guard: gentle, on-device checks on what goes into and comes out of a
// chat with a stranger. Nothing is blocked or logged — Pulse can't see the
// chat anyway. Outgoing, it asks "sure?" before you share something that
// identifies you; incoming, it adds a quiet note to the classic opening
// moves of a scam (a link, "add me on WhatsApp", money).
//
// The patterns are deliberately conservative: a prompt you see on every
// other message teaches you to click through it.

export const MAX_MESSAGE_LENGTH = 1000;

export type Sensitive = "email" | "link" | "phone" | "handle" | "address";
export type Caution = "link" | "offplatform" | "money";

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/i;
const LINK =
  /\bhttps?:\/\/|\bwww\.[a-z0-9-]|\b[a-z0-9-]{2,}\.(?:com|net|org|io|me|co|ly|gg|app|link|xyz|tv|ph|uk)\b/i;
// Seven or more digits, allowing the usual separators: +63 917 123 4567,
// (555) 123-4567, 0917-123-4567.
const PHONE = /(?:\+|\b)\d(?:[\s().-]{0,2}\d){6,14}\b/;
// Two years joined by a dash ("2019-2023") isn't a phone number.
const YEAR_RANGE = /^(?:19|20)\d\d\s*[-–]\s*(?:19|20)\d\d$/;
// "@someone", or a platform followed by something that is clearly a handle:
// "ig: jo.doe", "snap @jodoe", "my insta is jo_doe92" — not "insta is great".
const AT_HANDLE = /(?:^|\s)@[a-z0-9_.]{3,}/i;
const PLATFORM_HANDLE =
  /\b(?:ig|insta(?:gram)?|snap(?:chat)?|telegram|tg|whats\s?app|discord|tiktok|twitter|facebook|fb)\s*(?:[:-]\s*@?[a-z0-9_.]{3,}|(?:is\s+)?@[a-z0-9_.]{3,}|is\s+[a-z0-9]*[_.\d][a-z0-9_.]*)/i;
// A number, a name, a street type, then the end of the phrase: "12 Oak St",
// "221 baker street, london" — but not "a 2 hour road trip".
const ADDRESS =
  /\b\d{1,5}\s+(?:[a-z]+\s+){1,3}(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|dr|court|ct|highway|hwy)\.?(?=\s*(?:$|[,.!?]|apt\b|unit\b|#))|\bmy address is\b|\bi live (?:at|on) \d/i;

// The first thing in `text` that would identify you, or null.
export function detectSensitive(text: string): Sensitive | null {
  if (EMAIL.test(text)) return "email";
  if (LINK.test(text)) return "link";
  const phone = text.match(PHONE);
  if (phone && !YEAR_RANGE.test(phone[0].trim())) return "phone";
  if (AT_HANDLE.test(text) || PLATFORM_HANDLE.test(text)) return "handle";
  if (ADDRESS.test(text)) return "address";
  return null;
}

const OFF_PLATFORM =
  /\b(?:whats\s?app|telegram|snap(?:chat)?|kik|insta(?:gram)?|discord|wechat|line app|signal app|text me|dm me|add me)\b/i;
const MONEY =
  /\b(?:venmo|cash\s?app|paypal|gcash|gift\s?cards?|bitcoin|btc|crypto|usdt|wire (?:me|transfer)|send (?:me )?money|invest(?:ment|ing)?)\b/i;

// A note worth showing under a stranger's message, or null.
export function cautionFor(text: string): Caution | null {
  if (MONEY.test(text)) return "money";
  if (EMAIL.test(text) || LINK.test(text)) return "link";
  if (OFF_PLATFORM.test(text)) return "offplatform";
  return null;
}
