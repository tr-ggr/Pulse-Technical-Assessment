"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import EntryGate, { pausedMessage } from "./components/EntryGate";
import WorldMap, { type WorldMapHandle } from "./components/WorldMap";
import Hud from "./components/Hud";
import Toasts from "./components/Toasts";
import RequestingPill from "./components/RequestingPill";
import RequestCard from "./components/RequestCard";
import { useToasts } from "./hooks/useToasts";
import { useAttention } from "./hooks/useAttention";
import { playChime } from "@/lib/chime";
import ChatPanel, { type ChatMessage } from "./components/ChatPanel";
import VideoPanel, {
  type MediaState,
  type RevealState,
} from "./components/VideoPanel";
import {
  blockStranger as sendBlock,
  join,
  leave,
  PausedError,
  poll,
  RateLimitedError,
  sendSignal,
  SessionGoneError,
} from "@/lib/api";
import { PeerSession, type DescType, type PeerControl } from "@/lib/webrtc";
import { POLL_INTERVAL_MS, REQUEST_TIMEOUT_MS } from "@/lib/presence";
import { type PeerDot, type SignalMsg, type SignalType } from "@/lib/types";
import { describeStranger } from "@/lib/identity";

type Conn =
  | { kind: "idle" }
  | { kind: "requesting"; peerId: string }
  | { kind: "incoming"; peerId: string }
  | { kind: "connecting"; peerId: string }
  | { kind: "connected"; peerId: string };

type VideoState = "none" | "requesting" | "incoming" | "active";

const MEDIA_ON: MediaState = { mic: true, cam: true };
const VEILED: RevealState = { mine: false, theirs: false };

export default function Home() {
  const [phase, setPhase] = useState<"gate" | "live">("gate");
  // Bearer token issued by /api/join. Memory only: it dies with the tab, and
  // presenting it again on re-join brings us back as the same stranger.
  const tokenRef = useRef<string | null>(null);
  const [peers, setPeers] = useState<PeerDot[]>([]);
  // Strangers you blocked this session. The server hides them from the next
  // poll on; this hides them right away.
  const [blocked, setBlocked] = useState<ReadonlySet<string>>(new Set());
  // Why we were sent back to the gate (a network pause), if we were.
  const [gateNotice, setGateNotice] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const { toasts, push: showNotice, dismiss: dismissToast } = useToasts();
  // Hide the "tap a dot" hint once someone has figured it out.
  const [hasRequested, setHasRequested] = useState(false);
  const mapHandle = useRef<WorldMapHandle>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [remoteMedia, setRemoteMedia] = useState<MediaState>(MEDIA_ON);
  const [myLocation, setMyLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  const [conn, _setConn] = useState<Conn>({ kind: "idle" });
  const connRef = useRef<Conn>(conn);
  const setConn = (c: Conn) => {
    connRef.current = c;
    _setConn(c);
  };

  const [video, _setVideo] = useState<VideoState>("none");
  const videoRef = useRef<VideoState>(video);
  const setVideo = (v: VideoState) => {
    videoRef.current = v;
    _setVideo(v);
  };

  const [reveal, _setReveal] = useState<RevealState>(VEILED);
  const revealRef = useRef<RevealState>(reveal);
  // Every change goes through here so our outgoing camera always matches the
  // consent state: raw only while both have said yes.
  const setReveal = (r: RevealState) => {
    revealRef.current = r;
    _setReveal(r);
    void peerRef.current?.setRevealed(r.mine && r.theirs);
  };

  const peerRef = useRef<PeerSession | null>(null);
  const msgId = useRef(0);
  const requestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Raw location, kept only in memory so we can re-join if the server reaped us.
  const locationRef = useRef<{ lat: number; lng: number } | null>(null);

  function isStill(kind: Conn["kind"], peerId: string) {
    const c = connRef.current;
    return c.kind === kind && "peerId" in c && c.peerId === peerId;
  }

  function signal(toId: string, type: SignalType, payload?: string) {
    const token = tokenRef.current;
    return token ? sendSignal(token, toId, type, payload) : Promise.resolve(0);
  }

  function addMessage(mine: boolean, text: string) {
    setMessages((prev) => [...prev, { id: msgId.current++, mine, text }]);
  }

  function teardown(message?: string) {
    if (requestTimer.current) clearTimeout(requestTimer.current);
    peerRef.current?.close();
    peerRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setRemoteMedia(MEDIA_ON);
    setReveal(VEILED);
    setVideo("none");
    setMessages([]);
    setConn({ kind: "idle" });
    if (message) showNotice(message);
  }

  function startPeer(peerId: string, initiator: boolean) {
    const ps = new PeerSession(initiator, {
      onSignal: (type: DescType, payload: string) => {
        void signal(peerId, type, payload);
      },
      onChat: (text) => addMessage(false, text),
      onControl: (ctrl) => handleControl(ctrl),
      onRemoteStream: (stream) => setRemoteStream(stream),
      onConnectionState: (state) => {
        if (peerRef.current !== ps) return;
        if (state === "failed") {
          // Once connected, a failure is almost always the stranger vanishing
          // (tab killed, network gone) before any "end" could reach us.
          teardown(
            connRef.current.kind === "connected"
              ? "Lost the connection to the stranger."
              : "Couldn’t connect. A network may be blocking it.",
          );
        } else if (state === "closed") {
          teardown("Stranger disconnected.");
        }
      },
      onChannelOpen: () => {
        setConn({ kind: "connected", peerId });
      },
      onChannelClose: () => {
        if (peerRef.current === ps) teardown("Stranger disconnected.");
      },
    });
    peerRef.current = ps;
  }

  function handleControl(ctrl: PeerControl) {
    const ps = peerRef.current;
    switch (ctrl) {
      case "video-request":
        if (videoRef.current === "none") setVideo("incoming");
        break;
      case "video-accept":
        if (videoRef.current === "requesting" && ps) {
          ps.startVideo()
            .then((stream) => {
              setLocalStream(stream);
              setVideo("active");
            })
            .catch(() => {
              setVideo("none");
              ps.sendControl("video-end");
              showNotice("Camera unavailable.");
            });
        }
        break;
      case "video-decline":
        if (videoRef.current === "requesting") {
          setVideo("none");
          showNotice("Video declined.");
        }
        break;
      case "video-end":
        ps?.stopVideo();
        setLocalStream(null);
        setRemoteStream(null);
        setRemoteMedia(MEDIA_ON);
        setReveal(VEILED);
        setVideo("none");
        break;
      case "reveal":
        setReveal({ ...revealRef.current, theirs: true });
        break;
      case "veil":
        setReveal(VEILED);
        break;
      case "mic-on":
      case "mic-off":
        setRemoteMedia((m) => ({ ...m, mic: ctrl === "mic-on" }));
        break;
      case "cam-on":
      case "cam-off":
        setRemoteMedia((m) => ({ ...m, cam: ctrl === "cam-on" }));
        break;
    }
  }

  function requestConnection(peerId: string) {
    if (connRef.current.kind !== "idle") return;
    setHasRequested(true);
    setConn({ kind: "requesting", peerId });
    void signal(peerId, "request").then((status) => {
      if (!isStill("requesting", peerId)) return;
      if (status === 429) teardown("Easy — wait a few seconds between requests.");
      else if (status === 409) teardown("Couldn’t send that request.");
    });
    requestTimer.current = setTimeout(() => {
      if (
        connRef.current.kind === "requesting" &&
        connRef.current.peerId === peerId
      ) {
        void signal(peerId, "end");
        teardown("No answer.");
      }
    }, REQUEST_TIMEOUT_MS);
  }

  function cancelRequest() {
    if (connRef.current.kind === "requesting") {
      void signal(connRef.current.peerId, "end");
    }
    teardown();
  }

  function acceptIncoming() {
    if (connRef.current.kind !== "incoming") return;
    const peerId = connRef.current.peerId;
    startPeer(peerId, false);
    setConn({ kind: "connecting", peerId });
    void signal(peerId, "accept").then((status) => {
      // The server only pairs us if their request is still live.
      if (status === 409 && isStill("connecting", peerId)) {
        teardown("That request expired.");
      }
    });
  }

  function declineIncoming() {
    if (connRef.current.kind !== "incoming") return;
    void signal(connRef.current.peerId, "decline");
    setConn({ kind: "idle" });
  }

  function endConnection() {
    const c = connRef.current;
    if (c.kind === "connecting" || c.kind === "connected") {
      void signal(c.peerId, "end");
    }
    teardown();
  }

  // Block (and optionally report) whoever is asking for you or talking with
  // you. Locally it's instant: they leave your map and your screen. The
  // server ends the call / declines the request for them, so they only see a
  // stranger who hung up or said no.
  function blockStranger(report: boolean) {
    const c = connRef.current;
    if (c.kind === "idle" || c.kind === "requesting") return;
    const { peerId } = c;
    const token = tokenRef.current;
    setBlocked((prev) => new Set(prev).add(peerId));
    if (c.kind === "incoming") setConn({ kind: "idle" });
    else teardown();
    showNotice(
      report
        ? "Reported and blocked. Thank you for keeping Pulse kind."
        : "Blocked. You won’t see each other again.",
    );
    if (!token) return;
    void sendBlock(token, peerId, report).then((status) => {
      // Server didn't take it (e.g. they'd already gone): still make sure
      // the stranger's side is released.
      if (status !== 200) {
        void signal(peerId, c.kind === "incoming" ? "decline" : "end");
      }
    });
  }

  function startVideoRequest() {
    if (videoRef.current !== "none" || !peerRef.current) return;
    setVideo("requesting");
    peerRef.current.sendControl("video-request");
  }

  function acceptVideo() {
    const ps = peerRef.current;
    if (!ps) return;
    ps.startVideo()
      .then((stream) => {
        setLocalStream(stream);
        ps.sendControl("video-accept");
        setVideo("active");
      })
      .catch(() => {
        ps.sendControl("video-decline");
        setVideo("none");
        showNotice("Camera unavailable.");
      });
  }

  function declineVideo() {
    peerRef.current?.sendControl("video-decline");
    setVideo("none");
  }

  function endVideo() {
    const ps = peerRef.current;
    ps?.stopVideo();
    ps?.sendControl("video-end");
    setLocalStream(null);
    setRemoteStream(null);
    setRemoteMedia(MEDIA_ON);
    setReveal(VEILED);
    setVideo("none");
  }

  function revealCamera() {
    if (revealRef.current.mine) return;
    peerRef.current?.sendControl("reveal");
    setReveal({ ...revealRef.current, mine: true });
  }

  // Either side can drop the veil back over both cameras, at any time.
  function veilCameras() {
    peerRef.current?.sendControl("veil");
    setReveal(VEILED);
  }

  function processSignal(sig: SignalMsg) {
    switch (sig.type) {
      case "request": {
        if (connRef.current.kind === "idle") {
          setConn({ kind: "incoming", peerId: sig.fromId });
        } else {
          void signal(sig.fromId, "decline");
        }
        break;
      }
      case "accept": {
        const c = connRef.current;
        if (c.kind === "requesting" && c.peerId === sig.fromId) {
          if (requestTimer.current) clearTimeout(requestTimer.current);
          startPeer(sig.fromId, true);
          setConn({ kind: "connecting", peerId: sig.fromId });
        } else {
          // Late accept (we timed out / cancelled / moved on): the server has
          // already paired us as busy, so release that pairing explicitly.
          void signal(sig.fromId, "end");
        }
        break;
      }
      case "decline": {
        const c = connRef.current;
        if (c.kind === "requesting" && c.peerId === sig.fromId) {
          if (requestTimer.current) clearTimeout(requestTimer.current);
          teardown("Request declined.");
        }
        break;
      }
      case "offer":
      case "answer":
      case "ice": {
        const c = connRef.current;
        const peerId =
          c.kind === "connecting" || c.kind === "connected" ? c.peerId : null;
        if (peerRef.current && peerId === sig.fromId) {
          void peerRef.current.handleSignal(
            sig.type as DescType,
            sig.payload ?? "",
          );
        }
        break;
      }
      case "end": {
        const c = connRef.current;
        if (
          (c.kind === "incoming" ||
            c.kind === "connecting" ||
            c.kind === "connected") &&
          c.peerId === sig.fromId
        ) {
          if (c.kind === "incoming") setConn({ kind: "idle" });
          else teardown("Stranger disconnected.");
        }
        break;
      }
    }
  }

  const processSignalRef = useRef(processSignal);
  const teardownRef = useRef(teardown);
  useEffect(() => {
    processSignalRef.current = processSignal;
    teardownRef.current = teardown;
  });

  useEffect(() => {
    if (phase !== "live") return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      const token = tokenRef.current;
      let delay = POLL_INTERVAL_MS;
      try {
        if (!token) return;
        const data = await poll(token);
        if (!active) return;
        setPeers(data.peers);
        for (const s of data.signals) processSignalRef.current(s);
      } catch (err) {
        if (err instanceof RateLimitedError) delay = err.retryAfterMs;
        // Reaped while throttled/backgrounded: re-join with the same token so
        // we come back as the same stranger, in the same spot.
        const loc = locationRef.current;
        if (active && err instanceof SessionGoneError && loc) {
          try {
            await join(loc.lat, loc.lng, token ?? undefined);
          } catch (joinErr) {
            // Removed after reports: back to the gate, which says why.
            if (joinErr instanceof PausedError) {
              active = false;
              teardownRef.current();
              tokenRef.current = null;
              setPeers([]);
              setGateNotice(pausedMessage(joinErr.retryAfterMs));
              setPhase("gate");
            }
          }
        }
      } finally {
        if (active) timer = setTimeout(tick, delay);
      }
    };
    tick();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "live") return;
    const onLeave = () => {
      if (tokenRef.current) leave(tokenRef.current);
    };
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [phase]);

  const inChat = conn.kind === "connecting" || conn.kind === "connected";

  // Esc backs out of whatever is pending: your request, their request, or
  // their video request. It never hangs up a conversation you're in.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const c = connRef.current.kind;
      if (c === "requesting") cancelRequest();
      else if (c === "incoming") declineIncoming();
      else if (videoRef.current === "incoming") declineVideo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // When a chat closes, hand keyboard focus back to the map instead of
  // dropping it on <body>.
  const wasInChat = useRef(false);
  useEffect(() => {
    if (wasInChat.current && !inChat) {
      document.querySelector<HTMLElement>(".mapboxgl-canvas")?.focus({
        preventScroll: true,
      });
    }
    wasInChat.current = inChat;
  }, [inChat]);

  // Someone is waiting on you: flash the tab title and chime if you're away.
  const incomingFrom = conn.kind === "incoming" ? conn.peerId : null;
  const videoAsked = video === "incoming";
  useAttention(
    incomingFrom
      ? "● A stranger wants to connect"
      : videoAsked
        ? "● Video call request"
        : null,
  );
  useEffect(() => {
    if ((incomingFrom || videoAsked) && document.hidden) playChime();
  }, [incomingFrom, videoAsked]);

  async function handleReady(lat: number, lng: number) {
    locationRef.current = { lat, lng };
    const session = await join(lat, lng, tokenRef.current ?? undefined);
    tokenRef.current = session.token;
    setMyLocation({ lat, lng });
    setGateNotice(undefined);
    setPhase("live");
  }

  const visiblePeers =
    blocked.size === 0 ? peers : peers.filter((p) => !blocked.has(p.id));
  const link =
    conn.kind === "idle" ? null : { peerId: conn.peerId, phase: conn.kind };
  // Whoever you're linked with, as a colour + distance. They stay in `peers`
  // (as busy) for the whole call, so this only loses distance if they vanish.
  const linkPeer = link
    ? (peers.find((p) => p.id === link.peerId) ?? null)
    : null;
  const stranger = link
    ? describeStranger(link.peerId, linkPeer, myLocation)
    : null;

  return (
    <MotionConfig reducedMotion="user">
      <main
        className="fixed inset-0 overflow-hidden bg-space"
        data-chat={inChat ? "open" : undefined}
      >
        <WorldMap
          ref={mapHandle}
          mode={phase === "gate" ? "intro" : "live"}
          peers={visiblePeers}
          me={myLocation}
          link={link}
          onPeerClick={requestConnection}
          canConnect={conn.kind === "idle"}
        />

        <AnimatePresence>
          {phase === "gate" && (
            <EntryGate key="gate" onReady={handleReady} notice={gateNotice} />
          )}
        </AnimatePresence>

        {phase === "live" && (
          <Hud
            online={visiblePeers.length}
            onRecenter={() => mapHandle.current?.recenter()}
          />
        )}

        {/* Top-centre stack: what you're waiting on, then transient notices. */}
        <div
          className={`pointer-events-none absolute inset-x-0 top-[calc(max(1rem,env(safe-area-inset-top))+3.25rem)] z-30 flex flex-col items-center gap-2 px-4 md:top-5 ${
            inChat ? "lg:pr-[432px]" : ""
          }`}
        >
          <AnimatePresence>
            {conn.kind === "requesting" && stranger && (
              <RequestingPill
                key={conn.peerId}
                stranger={stranger}
                onCancel={cancelRequest}
              />
            )}
          </AnimatePresence>
          <Toasts toasts={toasts} onDismiss={dismissToast} />
        </div>

        <AnimatePresence>
          {phase === "live" && conn.kind === "idle" && !hasRequested && (
            <motion.p
              key={peers.length === 0 ? "quiet" : "hint"}
              initial={{ opacity: 0, y: 10 }}
              animate={{
                opacity: 1,
                y: 0,
                transition: { delay: 2.6, duration: 0.6 },
              }}
              exit={{ opacity: 0, y: 6, transition: { duration: 0.25 } }}
              className="glass pointer-events-none absolute bottom-[max(2.5rem,calc(env(safe-area-inset-bottom)+1.5rem))] left-1/2 z-20 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-full px-4 py-2.5 text-center text-sm text-ink-muted"
            >
              {peers.length === 0 ? (
                <>
                  It’s quiet right now. Your dot is live — anyone who joins will
                  see you.
                </>
              ) : (
                <>
                  Tap a <span className="text-ink">glowing dot</span> to say
                  hello
                </>
              )}
            </motion.p>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {conn.kind === "incoming" && stranger && (
            <RequestCard
              key={conn.peerId}
              stranger={stranger}
              onAccept={acceptIncoming}
              onDecline={declineIncoming}
              onBlock={() => blockStranger(false)}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {inChat && stranger && (
            <ChatPanel
              key={conn.peerId}
              messages={messages}
              connected={conn.kind === "connected"}
              stranger={stranger}
              video={video}
              onSend={(text) => {
                peerRef.current?.sendChat(text);
                addMessage(true, text);
              }}
              onStartVideo={startVideoRequest}
              onAcceptVideo={acceptVideo}
              onDeclineVideo={declineVideo}
              onBlock={blockStranger}
              onEnd={endConnection}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {video === "active" && stranger && (
            <VideoPanel
              key="call"
              localStream={localStream}
              remoteStream={remoteStream}
              remoteMedia={remoteMedia}
              reveal={reveal}
              stranger={stranger}
              onLocalMediaChange={(next) => {
                const ps = peerRef.current;
                ps?.sendControl(next.mic ? "mic-on" : "mic-off");
                ps?.sendControl(next.cam ? "cam-on" : "cam-off");
              }}
              onReveal={revealCamera}
              onVeil={veilCameras}
              onReport={() => blockStranger(true)}
              onEnd={endVideo}
            />
          )}
        </AnimatePresence>
      </main>
    </MotionConfig>
  );
}
