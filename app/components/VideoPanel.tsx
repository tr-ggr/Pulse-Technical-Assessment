"use client";

import { useEffect, useRef, useState } from "react";
import {
  animate,
  motion,
  useIsPresent,
  useMotionValue,
  type PanInfo,
} from "motion/react";
import CallControls, { CallTimer } from "./CallControls";
import StrangerOrb from "./StrangerOrb";
import type { Stranger } from "@/lib/identity";

export interface MediaState {
  mic: boolean;
  cam: boolean;
}

const INSET = 16;

// Full-bleed call stage. On desktop it sits beside the chat card so you can
// keep texting; on phones it takes the whole screen.
export default function VideoPanel({
  localStream,
  remoteStream,
  remoteMedia,
  stranger,
  onLocalMediaChange,
  onEnd,
}: {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  remoteMedia: MediaState;
  stranger: Stranger;
  onLocalMediaChange: (state: MediaState) => void;
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

  return (
    <motion.section
      aria-label="Video call"
      inert={!isPresent}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.25 } }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="absolute inset-0 z-40 overflow-hidden bg-black lg:inset-y-4 lg:left-4 lg:right-[432px] lg:rounded-[2rem] lg:border lg:border-hairline lg:shadow-[var(--shadow-glass)]"
    >
      <div ref={stageRef} className="absolute inset-0">
        {/* Remote (full stage). Must stay the first <video> on the page. */}
        <video
          ref={remoteRef}
          autoPlay
          playsInline
          className={`absolute inset-0 h-full w-full bg-night-950 object-cover transition-opacity duration-500 ${
            showRemote ? "opacity-100" : "opacity-0"
          }`}
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
        </div>

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

        <div className="absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-black/60 to-transparent px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-12">
          <CallControls
            micOn={media.mic}
            camOn={media.cam}
            onToggleMic={() => toggle("mic")}
            onToggleCam={() => toggle("cam")}
            onEnd={onEnd}
          />
        </div>
      </div>
    </motion.section>
  );
}
