"use client";

import { useEffect, useState } from "react";
import { VeilIcon } from "./icons";

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// mm:ss since the call started (mount). Ticks once a second.
export function CallTimer() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(
      () => setSeconds(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, []);
  return (
    <span className="font-mono text-xs tabular-nums text-ink-muted">
      <span className="sr-only">Call time </span>
      {formatElapsed(seconds)}
    </span>
  );
}

const toggleBase =
  "grid size-13 place-items-center rounded-full transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/70 active:scale-95";
const toggleOn = "bg-white/10 text-ink hover:bg-white/18";
const toggleOff = "bg-ink text-night-900 hover:bg-white";

function MicIcon({ off }: { off: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

function CameraIcon({ off }: { off: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2.5" y="6" width="13" height="12" rx="3" />
      <path d="m15.5 10.5 6-3.5v10l-6-3.5" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}

export default function CallControls({
  micOn,
  camOn,
  onToggleMic,
  onToggleCam,
  onVeil,
  onEnd,
}: {
  micOn: boolean;
  camOn: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
  // Only while revealed: drop the veil back over both cameras.
  onVeil?: () => void;
  onEnd: () => void;
}) {
  return (
    <div className="glass flex items-center gap-2 rounded-full p-2">
      {/* Fixed labels + aria-pressed: "Mute microphone, pressed" = muted. */}
      <button
        type="button"
        onClick={onToggleMic}
        aria-pressed={!micOn}
        aria-label="Mute microphone"
        title={micOn ? "Mute microphone" : "Unmute microphone"}
        className={`${toggleBase} ${micOn ? toggleOn : toggleOff}`}
      >
        <MicIcon off={!micOn} />
      </button>
      <button
        type="button"
        onClick={onToggleCam}
        aria-pressed={!camOn}
        aria-label="Turn camera off"
        title={camOn ? "Turn camera off" : "Turn camera on"}
        className={`${toggleBase} ${camOn ? toggleOn : toggleOff}`}
      >
        <CameraIcon off={!camOn} />
      </button>
      {onVeil && (
        <button
          type="button"
          onClick={onVeil}
          aria-label="Veil cameras"
          title="Blur both cameras again"
          className={`${toggleBase} ${toggleOn}`}
        >
          <VeilIcon />
        </button>
      )}
      <button
        type="button"
        onClick={onEnd}
        data-sound="disconnect"
        className="ml-1 flex h-13 items-center gap-2 rounded-full bg-danger-deep px-5 text-sm font-semibold text-white transition hover:bg-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black active:scale-[0.97]"
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="size-5"
          fill="currentColor"
        >
          <path d="M12 9c-3.2 0-6.2.9-8.6 2.5-.6.4-.9 1.1-.8 1.8l.4 2.1c.1.7.8 1.2 1.5 1.1l3-.5c.7-.1 1.2-.7 1.2-1.4v-1.9c1.4-.4 3.1-.4 4.6 0v1.9c0 .7.5 1.3 1.2 1.4l3 .5c.7.1 1.4-.4 1.5-1.1l.4-2.1c.1-.7-.2-1.4-.8-1.8C18.2 9.9 15.2 9 12 9Z" />
        </svg>
        End video
      </button>
    </div>
  );
}
