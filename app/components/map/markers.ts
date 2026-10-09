// DOM builders for the Mapbox markers. Mapbox owns the marker element's own
// `transform` (positioning) and, on the globe, its `opacity` (horizon fade), so
// every visual state lives on child elements and data-attributes instead.

import { peerColor, pulseDelayMs } from "@/lib/identity";

// target: you asked them; caller: they asked you; partner: you're connected.
export type DotState = "idle" | "target" | "caller" | "partner";

export interface DotView {
  busy: boolean;
  state: DotState;
  canConnect: boolean;
  distanceLabel: string | null;
}

export function createPeerEl(id: string): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "pulse-dot";
  el.dataset.busy = "false";
  el.dataset.state = "idle";
  el.style.setProperty("--dot", peerColor(id));
  el.style.setProperty("--dot-glow", peerColor(id, 0.55));
  el.style.setProperty("--dot-delay", `${pulseDelayMs(id)}ms`);
  el.innerHTML =
    '<span class="pulse-dot__halo"></span>' +
    '<span class="pulse-dot__core"></span>' +
    '<span class="pulse-dot__tip" aria-hidden="true"></span>';
  return el;
}

function tipFor(view: DotView): string {
  if (view.state === "partner") return "Your conversation";
  if (view.state === "target") return "Waiting for an answer…";
  if (view.state === "caller") return "Wants to connect";
  if (view.busy) return "In a conversation";
  if (!view.canConnect) return "Finish your chat first";
  return "Tap to connect";
}

export function updatePeerEl(el: HTMLElement, view: DotView): void {
  const busy = String(view.busy);
  if (el.dataset.busy !== busy) el.dataset.busy = busy;
  if (el.dataset.state !== view.state) el.dataset.state = view.state;

  const tip = tipFor(view);
  const tipEl = el.querySelector<HTMLElement>(".pulse-dot__tip");
  if (tipEl && tipEl.textContent !== tip) tipEl.textContent = tip;

  const label = ["Stranger", view.distanceLabel, tip].filter(Boolean).join(", ");
  if (el.getAttribute("aria-label") !== label) el.setAttribute("aria-label", label);
}

// Your own beacon. Never a `.pulse-dot`: it isn't a stranger and can't be tapped.
export function createMeEl(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "pulse-me";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML =
    '<span class="pulse-me__ring"></span>' +
    '<span class="pulse-me__ring pulse-me__ring--late"></span>' +
    '<span class="pulse-me__core"></span>' +
    '<span class="pulse-me__tag">You</span>';
  return el;
}
