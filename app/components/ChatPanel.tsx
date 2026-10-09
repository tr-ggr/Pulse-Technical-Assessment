"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import StrangerOrb from "./StrangerOrb";
import type { Stranger } from "@/lib/identity";

export interface ChatMessage {
  id: number;
  mine: boolean;
  text: string;
}

type VideoState = "none" | "requesting" | "incoming" | "active";

const MAX_MESSAGE_LENGTH = 1000;

// Rounded bubbles that tuck their inner corners when consecutive messages
// come from the same side, so a burst reads as one thought.
function bubbleShape(mine: boolean, first: boolean, last: boolean): string {
  const top = mine ? "rounded-tr-md" : "rounded-tl-md";
  const bottom = mine ? "rounded-br-md" : "rounded-bl-md";
  return ["rounded-[20px]", first ? "" : top, last ? "" : bottom].join(" ");
}

export default function ChatPanel({
  messages,
  connected,
  stranger,
  video,
  onSend,
  onStartVideo,
  onAcceptVideo,
  onDeclineVideo,
  onEnd,
}: {
  messages: ChatMessage[];
  connected: boolean;
  stranger: Stranger;
  video: VideoState;
  onSend: (text: string) => void;
  onStartVideo: () => void;
  onAcceptVideo: () => void;
  onDeclineVideo: () => void;
  onEnd: () => void;
}) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isPresent = useIsPresent();

  // Keep the newest message in view. scrollTop (not scrollIntoView) so iOS
  // never scrolls the fixed page itself.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [messages, video]);

  // Ready to type the moment the channel opens — but only with a mouse;
  // on touch, focusing would throw the keyboard over the globe uninvited.
  useEffect(() => {
    if (connected && window.matchMedia("(pointer: fine)").matches) {
      inputRef.current?.focus();
    }
  }, [connected]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !connected) return;
    onSend(text);
    setDraft("");
  }

  const tint = { "--dot": stranger.color } as CSSProperties;

  return (
    <motion.aside
      aria-label="Chat with stranger"
      inert={!isPresent}
      initial={{ opacity: 0, y: 40, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 30, scale: 0.98, transition: { duration: 0.25 } }}
      transition={{ type: "spring", stiffness: 260, damping: 30 }}
      style={tint}
      className="glass absolute inset-x-0 bottom-0 z-30 flex h-[min(68dvh,640px)] flex-col overflow-hidden rounded-t-[1.75rem] border-b-0 pb-[env(safe-area-inset-bottom)] lg:inset-x-auto lg:bottom-4 lg:right-4 lg:top-4 lg:h-auto lg:w-[400px] lg:rounded-card lg:border-b lg:pb-0"
    >
      {/* Sheet handle (decorative) on phones. */}
      <div
        aria-hidden
        className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/15 lg:hidden"
      />

      <header className="flex shrink-0 items-center gap-3 border-b border-hairline px-4 pb-3.5 pt-2.5 lg:px-5 lg:pt-4">
        <StrangerOrb stranger={stranger} size={40} />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[22px] leading-none text-ink">
            Stranger
          </h2>
          <div className="mt-1.5 flex items-center gap-2 text-xs text-ink-muted">
            <span
              aria-hidden
              className={`size-1.5 shrink-0 rounded-full ${
                connected ? "bg-[var(--dot)]" : "animate-pulse bg-ink-faint"
              }`}
            />
            <p>{connected ? "Connected" : "Connecting…"}</p>
            {stranger.distanceLabel && (
              <>
                <span aria-hidden className="text-ink-faint">
                  ·
                </span>
                <span className="truncate">{stranger.distanceLabel}</span>
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onStartVideo}
          disabled={!connected || video !== "none"}
          aria-label="Video"
          title="Start a video call"
          className="grid size-9 place-items-center rounded-full border border-hairline-strong text-ink transition hover:border-ink-faint hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/70 pointer-coarse:size-11"
        >
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          >
            <rect x="2" y="5" width="11" height="10" rx="2.5" />
            <path d="m13 8.5 4.5-2.5v8L13 11.5" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onEnd}
          className="h-9 rounded-full bg-danger/15 px-3.5 text-[13px] font-semibold text-[#ff9b9b] transition hover:bg-danger hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/70 pointer-coarse:h-11"
        >
          End
        </button>
      </header>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 lg:px-5"
      >
        {!connected ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="flex w-40 flex-col gap-2" aria-hidden>
              <span className="shimmer h-2.5 w-full rounded-full" />
              <span className="shimmer h-2.5 w-3/4 rounded-full" />
            </div>
            <p className="text-sm text-ink-muted">Opening a private channel…</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <p className="font-display text-[30px] leading-tight text-ink">
              Say hello.
            </p>
            <p className="mt-2 max-w-[17rem] text-sm leading-relaxed text-ink-muted text-pretty">
              Messages travel straight to them, peer to peer. Nothing is stored,
              and it all vanishes when either of you leaves.
            </p>
          </div>
        ) : (
          <ol className="flex flex-col">
            <AnimatePresence initial={false}>
              {messages.map((m, i) => {
                const first = i === 0 || messages[i - 1].mine !== m.mine;
                const last =
                  i === messages.length - 1 || messages[i + 1].mine !== m.mine;
                return (
                  <motion.li
                    key={m.id}
                    initial={{ opacity: 0, y: 10, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ type: "spring", stiffness: 500, damping: 34 }}
                    style={{ originX: m.mine ? 1 : 0 }}
                    className={`flex ${m.mine ? "justify-end" : "justify-start"} ${first ? "mt-3 first:mt-0" : "mt-1"}`}
                  >
                    <span
                      className={`max-w-[82%] whitespace-pre-wrap break-words px-3.5 py-2 text-[15px] leading-snug ${bubbleShape(m.mine, first, last)} ${
                        m.mine
                          ? "bg-ember text-night-900"
                          : "bg-[color-mix(in_oklab,var(--dot)_16%,var(--color-night-700))] text-ink"
                      }`}
                    >
                      {m.text}
                    </span>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ol>
        )}
      </div>

      {/* Video negotiation lives inside the conversation it belongs to. */}
      <AnimatePresence initial={false}>
        {video === "requesting" && (
          <motion.div
            key="video-requesting"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="shrink-0 overflow-hidden"
          >
            <p className="mx-4 mb-2 flex items-center gap-2.5 rounded-2xl border border-hairline bg-white/[0.03] px-3.5 py-2.5 text-sm text-ink-muted lg:mx-5">
              <span
                aria-hidden
                className="size-3.5 animate-spin rounded-full border-[1.5px] border-ember/30 border-t-ember"
              />
              Waiting for the stranger to accept video…
            </p>
          </motion.div>
        )}
        {video === "incoming" && (
          <motion.div
            key="video-incoming"
            role="alertdialog"
            aria-labelledby="video-prompt-title"
            aria-describedby="video-prompt-desc"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="shrink-0 overflow-hidden"
          >
            <div className="mx-4 mb-2 rounded-2xl border border-ember/25 bg-ember/[0.07] p-4 lg:mx-5">
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="grid size-10 shrink-0 place-items-center rounded-full bg-ember/15 text-ember"
                >
                  <svg
                    viewBox="0 0 20 20"
                    className="size-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinejoin="round"
                  >
                    <rect x="2" y="5" width="11" height="10" rx="2.5" />
                    <path d="m13 8.5 4.5-2.5v8L13 11.5" />
                  </svg>
                </span>
                <div>
                  <h3
                    id="video-prompt-title"
                    className="font-display text-[22px] leading-tight text-ink"
                  >
                    Start video call?
                  </h3>
                  <p
                    id="video-prompt-desc"
                    className="mt-0.5 text-sm text-ink-muted"
                  >
                    The stranger wants to turn on video.
                  </p>
                </div>
              </div>
              {/* No autofocus: you may be mid-sentence, and Enter must not accept. */}
              <div className="mt-3.5 grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={onDeclineVideo}
                  className="h-10 rounded-full border border-hairline-strong text-sm font-medium text-ink-muted transition hover:border-ink-faint hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/70 pointer-coarse:h-11"
                >
                  Decline
                </button>
                <button
                  type="button"
                  onClick={onAcceptVideo}
                  className="h-10 rounded-full bg-ember text-sm font-semibold text-night-900 transition hover:bg-ember-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:ring-offset-2 focus-visible:ring-offset-night-900 pointer-coarse:h-11"
                >
                  Accept
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <form
        onSubmit={submit}
        className="flex shrink-0 items-center gap-2 border-t border-hairline p-3 lg:px-4"
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={connected ? "Type a message…" : "Connecting…"}
          aria-label="Message"
          disabled={!connected}
          maxLength={MAX_MESSAGE_LENGTH}
          enterKeyHint="send"
          autoComplete="off"
          className="h-11 min-w-0 flex-1 rounded-full border border-hairline bg-night-900/60 px-4 text-[15px] text-ink outline-none transition placeholder:text-ink-faint focus:border-ember/50 focus:bg-night-900/80 disabled:opacity-50"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={!connected || !draft.trim()}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-ember text-night-900 transition hover:bg-ember-bright active:scale-95 disabled:bg-white/10 disabled:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:ring-offset-2 focus-visible:ring-offset-night-900"
        >
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className="size-[18px]"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 16V4m-5 5 5-5 5 5" />
          </svg>
        </button>
      </form>
    </motion.aside>
  );
}
