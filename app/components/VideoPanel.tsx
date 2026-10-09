"use client";

import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useIsPresent,
  useMotionValue,
  type PanInfo,
} from "motion/react";
import CallControls, { CallTimer } from "./CallControls";
import { ShieldIcon, VeilIcon } from "./icons";
import StrangerOrb from "./StrangerOrb";
import type { Stranger } from "@/lib/identity";
import { useGuardian, type GuardianStatus } from "../hooks/useGuardian";

export interface MediaState {
  mic: boolean;
  cam: boolean;
}

// Who has tapped Reveal. Cameras go out unveiled only when both have.
export interface RevealState {
  mine: boolean;
  theirs: boolean;
}

const INSET = 16;

// Full-bleed call stage. On desktop it sits beside the chat card so you can
// keep texting; on phones it takes the whole screen.
export default function VideoPanel({
  localStream,
  remoteStream,
  remoteMedia,
  reveal,
  stranger,
  onLocalMediaChange,
  onReveal,
  onVeil,
  onReport,
  onEnd,
}: {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  remoteMedia: MediaState;
  reveal: RevealState;
  stranger: Stranger;
  onLocalMediaChange: (state: MediaState) => void;
  onReveal: () => void;
  onVeil: () => void;
  onReport: () => void;
  onEnd: () => void;
}) {
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const selfRef = useRef<HTMLDivElement>(null);
  const [media, setMedia] = useState<MediaState>({ mic: true, cam: true });
  const isPresent = useIsPresent();

  // Self-view position, as an offset from its home corner (top-right).
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  useEffect(() => {
    if (localRef.current && localRef.current.srcObject !== localStream) {
      localRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteRef.current && remoteRef.current.srcObject !== remoteStream) {
      remoteRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  function toggle(kind: keyof MediaState) {
    const next = { ...media, [kind]: !media[kind] };
    const tracks =
      kind === "mic"
        ? localStream?.getAudioTracks()
        : localStream?.getVideoTracks();
    // enabled=false keeps the track negotiated (no renegotiation) and sends
    // silence / black frames; flipping it back is instant.
    tracks?.forEach((t) => (t.enabled = next[kind]));
    setMedia(next);
    onLocalMediaChange(next);
  }

  // Let go of the self-view and it glides to the nearest corner.
  function snapToCorner(_: unknown, info: PanInfo) {
    const stage = stageRef.current?.getBoundingClientRect();
    const self = selfRef.current?.getBoundingClientRect();
    if (!stage || !self) return;
    const maxX = stage.width - self.width - INSET * 2;
    const maxY = stage.height - self.height - INSET * 2 - 96; // above the controls
    const projectedX = x.get() + info.velocity.x * 0.15;
    const projectedY = y.get() + info.velocity.y * 0.15;
    const spring = { type: "spring", stiffness: 420, damping: 36 } as const;
    animate(x, projectedX < -maxX / 2 ? -maxX : 0, spring);
    animate(y, projectedY > maxY / 2 ? Math.max(0, maxY) : 0, spring);
  }

  const showRemote = !!remoteStream && remoteMedia.cam;
  const revealed = reveal.mine && reveal.theirs;
  const guardian = useGuardian(remoteRef, revealed && showRemote);
  // Blurred for us: before mutual reveal, or after the Guardian flags a frame.
  const blurred = !revealed || guardian.flagged;

  function keepVeiled() {
    guardian.clear();
    onVeil();
  }

  return (
    <motion.section
      aria-label="Video call"
      inert={!isPresent}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.25 } }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      data-veiled={revealed ? "false" : "true"}
      data-guardian={guardian.status}
      data-flagged={guardian.flagged ? "true" : undefined}
      className="absolute inset-0 z-40 overflow-hidden bg-black lg:inset-y-4 lg:left-4 lg:right-[432px] lg:rounded-[2rem] lg:border lg:border-hairline lg:shadow-[var(--shadow-glass)]"
    >
      <div ref={stageRef} className="absolute inset-0">
        {/* Remote (full stage). Must stay the first <video> on the page.
            Until both reveal it arrives pre-blurred at the source; the CSS
            blur on top is for us, in case their client sends clear frames. */}
        <video
          ref={remoteRef}
          autoPlay
          playsInline
          className={`absolute inset-0 h-full w-full bg-night-950 object-cover transition-[opacity,filter,scale] duration-700 ease-out-expo ${
            showRemote ? "opacity-100" : "opacity-0"
          } ${blurred ? "scale-125 blur-3xl saturate-150" : ""}`}
        />

        {!showRemote && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-[radial-gradient(circle_at_50%_45%,var(--color-night-700),var(--color-night-950)_70%)]">
            <div className="relative grid place-items-center">
              {!remoteStream && (
                <>
                  <span aria-hidden className="call-sonar" />
                  <span
                    aria-hidden
                    className="call-sonar [animation-delay:1.2s]"
                  />
                </>
              )}
              <StrangerOrb stranger={stranger} size={112} />
            </div>
            <p className="text-sm text-ink-muted">
              {remoteStream
                ? "Their camera is off"
                : "Waiting for stranger’s video…"}
            </p>
          </div>
        )}

        {/* Top bar: who, how long, and whether they can hear you. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-3 bg-gradient-to-b from-black/60 to-transparent px-5 pb-10 pt-[max(1.25rem,env(safe-area-inset-top))]">
          <StrangerOrb stranger={stranger} size={28} />
          <div className="leading-tight">
            <p className="font-display text-xl text-ink">Stranger</p>
            <CallTimer />
          </div>
          {!remoteMedia.mic && (
            <span className="ml-1 rounded-full bg-black/50 px-2.5 py-1 text-xs text-ink-muted backdrop-blur">
              Muted
            </span>
          )}
          <GuardianChip status={guardian.status} />
        </div>

        <AnimatePresence>
          {guardian.flagged && (
            <GuardianCard
              key="guardian"
              onKeepVeiled={keepVeiled}
              onShowAnyway={guardian.showAnyway}
              onReport={onReport}
            />
          )}
        </AnimatePresence>

        {/* Self-view: mirrored like a mirror, draggable to any corner. */}
        <motion.div
          ref={selfRef}
          drag
          dragConstraints={stageRef}
          dragElastic={0.12}
          dragMomentum={false}
          onDragEnd={snapToCorner}
          style={{ x, y, top: INSET, right: INSET }}
          whileDrag={{ scale: 1.04 }}
          className="absolute z-10 h-[124px] w-[92px] cursor-grab touch-none overflow-hidden rounded-2xl border border-white/15 bg-night-800 shadow-2xl active:cursor-grabbing md:h-[160px] md:w-[120px]"
          aria-label="Your camera"
          role="img"
        >
          <video
            ref={localRef}
            autoPlay
            playsInline
            muted
            className={`h-full w-full -scale-x-100 object-cover ${media.cam ? "" : "invisible"}`}
          />
          <AnimatePresence>
            {!revealed && media.cam && (
              <motion.span
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                className="absolute inset-x-1.5 bottom-1.5 flex items-center justify-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[10px] font-medium text-ink backdrop-blur"
              >
                <VeilIcon className="size-3" />
                They see a blur
              </motion.span>
            )}
          </AnimatePresence>
          {!media.cam && (
            <div className="absolute inset-0 grid place-items-center text-ink-faint">
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                className="size-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2.5" y="6" width="13" height="12" rx="3" />
                <path d="m15.5 10.5 6-3.5v10l-6-3.5M3 3l18 18" />
              </svg>
            </div>
          )}
        </motion.div>

        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 bg-gradient-to-t from-black/60 to-transparent px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-12">
          <AnimatePresence>
            {!revealed && (
              <ConsentBar key="consent" reveal={reveal} onReveal={onReveal} />
            )}
          </AnimatePresence>
          <CallControls
            micOn={media.mic}
            camOn={media.cam}
            onToggleMic={() => toggle("mic")}
            onToggleCam={() => toggle("cam")}
            onVeil={revealed ? onVeil : undefined}
            onEnd={onEnd}
          />
        </div>
      </div>
    </motion.section>
  );
}

// Both cameras start veiled. This card says who has agreed to drop the veil
// and lets you add your yes; the stage only clears once both have.
function ConsentBar({
  reveal,
  onReveal,
}: {
  reveal: RevealState;
  onReveal: () => void;
}) {
  return (
    <motion.div
      role="group"
      aria-label="Reveal cameras"
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.2 } }}
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
      className="glass w-full max-w-sm rounded-card p-4"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-full bg-white/8 text-ink"
        >
          <VeilIcon className="size-[18px]" />
        </span>
        <div className="min-w-0">
          <p className="font-display text-[21px] leading-tight text-ink">
            {reveal.theirs && !reveal.mine
              ? "They’re ready to reveal"
              : "Both cameras are blurred"}
          </p>
          <p className="mt-0.5 text-[13px] leading-snug text-ink-muted text-pretty">
            Neither of you sees a clear picture until you both say yes. You
            can already hear each other.
          </p>
        </div>
      </div>

      <div className="mt-3.5 flex items-center gap-2" aria-live="polite">
        <ConsentChip label="You" ready={reveal.mine} />
        <ConsentChip label="Stranger" ready={reveal.theirs} />
      </div>

      <button
        type="button"
        onClick={onReveal}
        disabled={reveal.mine}
        className="mt-3.5 h-11 w-full rounded-full bg-ember text-sm font-semibold text-night-900 transition hover:bg-ember-bright active:scale-[0.98] disabled:cursor-default disabled:bg-white/8 disabled:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:ring-offset-2 focus-visible:ring-offset-black"
      >
        {reveal.mine ? "Waiting for the stranger…" : "Reveal my camera"}
      </button>
    </motion.div>
  );
}

function ConsentChip({ label, ready }: { label: string; ready: boolean }) {
  return (
    <span
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors duration-300 ${
        ready
          ? "border-ember/40 bg-ember/10 text-ember-bright"
          : "border-hairline text-ink-muted"
      }`}
    >
      {ready ? (
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="size-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m3.5 8.5 3 3 6-7" />
        </svg>
      ) : (
        <span aria-hidden className="size-1.5 rounded-full bg-ink-faint" />
      )}
      {label}
      <span className="sr-only">{ready ? " is ready" : " hasn’t revealed"}</span>
    </span>
  );
}

const GUARDIAN_LABEL: Record<GuardianStatus, string> = {
  loading: "Guardian starting…",
  on: "Guardian on",
  paused: "Guardian paused",
  unavailable: "Guardian unavailable",
};

const GUARDIAN_TITLE: Record<GuardianStatus, string> = {
  loading: "Loading the on-device safety check",
  on: "Checks their video on this device for nudity. Nothing is uploaded.",
  paused: "You chose to show their video anyway for this call",
  unavailable: "This device can’t run the safety check; the veil still works",
};

function GuardianChip({ status }: { status: GuardianStatus }) {
  const on = status === "on";
  return (
    <span
      title={GUARDIAN_TITLE[status]}
      className={`pointer-events-auto ml-auto flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 text-xs backdrop-blur ${
        on ? "text-ink" : "text-ink-muted"
      }`}
    >
      <span className="relative grid place-items-center">
        <ShieldIcon />
        {on && (
          <span
            aria-hidden
            className="absolute size-1 rounded-full bg-[#7ee2b8] shadow-[0_0_6px_#7ee2b8]"
          />
        )}
      </span>
      {GUARDIAN_LABEL[status]}
    </span>
  );
}

// Shown over a stage the Guardian has just blurred. Your call what happens:
// put the veil back over both cameras, or trust them for the rest of the call.
function GuardianCard({
  onKeepVeiled,
  onShowAnyway,
  onReport,
}: {
  onKeepVeiled: () => void;
  onShowAnyway: () => void;
  onReport: () => void;
}) {
  return (
    <motion.div
      role="alertdialog"
      aria-labelledby="guardian-title"
      aria-describedby="guardian-desc"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.2 } }}
      transition={{ type: "spring", stiffness: 340, damping: 30 }}
      className="absolute inset-0 z-20 grid place-items-center p-6"
    >
      <div className="glass w-full max-w-sm rounded-card p-5 text-center">
        <span
          aria-hidden
          className="mx-auto grid size-12 place-items-center rounded-full bg-white/8 text-ink"
        >
          <ShieldIcon className="size-6" />
        </span>
        <h3
          id="guardian-title"
          className="mt-3 font-display text-[26px] leading-tight text-ink"
        >
          Guardian blurred this
        </h3>
        <p
          id="guardian-desc"
          className="mx-auto mt-1.5 max-w-[19rem] text-sm leading-relaxed text-ink-muted text-pretty"
        >
          Their video may contain nudity. This check runs only on your device —
          nothing was uploaded, and the stranger isn’t told.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={onKeepVeiled}
            className="h-11 rounded-full bg-ember text-sm font-semibold text-night-900 transition hover:bg-ember-bright active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            Keep it blurred
          </button>
          <button
            type="button"
            onClick={onShowAnyway}
            className="h-11 rounded-full border border-hairline-strong text-sm font-medium text-ink-muted transition hover:border-ink-faint hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/70"
          >
            Show anyway
          </button>
          <button
            type="button"
            onClick={onReport}
            className="mt-1 h-10 rounded-full text-sm font-medium text-[#ff9b9b] transition hover:bg-danger/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/70"
          >
            Report and leave
          </button>
        </div>
      </div>
    </motion.div>
  );
}
