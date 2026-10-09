"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import EntryGate from "./components/EntryGate";
import WorldMap, { type WorldMapHandle } from "./components/WorldMap";
import Hud from "./components/Hud";
import Toasts from "./components/Toasts";
import { useToasts } from "./hooks/useToasts";
import ConnectionPrompt from "./components/ConnectionPrompt";
import ChatPanel, { type ChatMessage } from "./components/ChatPanel";
import VideoPanel from "./components/VideoPanel";
import { join, leave, poll, sendSignal, SessionGoneError } from "@/lib/api";
import { PeerSession, type DescType, type PeerControl } from "@/lib/webrtc";
import { POLL_INTERVAL_MS, REQUEST_TIMEOUT_MS } from "@/lib/presence";
import { type PeerDot, type SignalMsg } from "@/lib/types";

type Conn =
  | { kind: "idle" }
  | { kind: "requesting"; peerId: string }
  | { kind: "incoming"; peerId: string }
  | { kind: "connecting"; peerId: string }
  | { kind: "connected"; peerId: string };

type VideoState = "none" | "requesting" | "incoming" | "active";

export default function Home() {
  const [phase, setPhase] = useState<"gate" | "live">("gate");
  const [sessionId] = useState(() => crypto.randomUUID());
  const [peers, setPeers] = useState<PeerDot[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const { toasts, push: showNotice, dismiss: dismissToast } = useToasts();
  // Hide the "tap a dot" hint once someone has figured it out.
  const [hasRequested, setHasRequested] = useState(false);
  const mapHandle = useRef<WorldMapHandle>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
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

  const peerRef = useRef<PeerSession | null>(null);
  const msgId = useRef(0);
  const requestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Raw location, kept only in memory so we can re-join if the server reaped us.
  const locationRef = useRef<{ lat: number; lng: number } | null>(null);

  function addMessage(mine: boolean, text: string) {
    setMessages((prev) => [...prev, { id: msgId.current++, mine, text }]);
  }

  function teardown(message?: string) {
    if (requestTimer.current) clearTimeout(requestTimer.current);
    peerRef.current?.close();
    peerRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setVideo("none");
    setMessages([]);
    setConn({ kind: "idle" });
    if (message) showNotice(message);
  }

  function startPeer(peerId: string, initiator: boolean) {
    const ps = new PeerSession(initiator, {
      onSignal: (type: DescType, payload: string) => {
        void sendSignal(sessionId, peerId, type, payload);
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
        setVideo("none");
        break;
    }
  }

  function requestConnection(peerId: string) {
    if (connRef.current.kind !== "idle") return;
    setHasRequested(true);
    setConn({ kind: "requesting", peerId });
    void sendSignal(sessionId, peerId, "request");
    requestTimer.current = setTimeout(() => {
      if (
        connRef.current.kind === "requesting" &&
        connRef.current.peerId === peerId
      ) {
        void sendSignal(sessionId, peerId, "end");
        teardown("No answer.");
      }
    }, REQUEST_TIMEOUT_MS);
  }

  function cancelRequest() {
    if (connRef.current.kind === "requesting") {
      void sendSignal(sessionId, connRef.current.peerId, "end");
    }
    teardown();
  }

  function acceptIncoming() {
    if (connRef.current.kind !== "incoming") return;
    const peerId = connRef.current.peerId;
    startPeer(peerId, false);
    void sendSignal(sessionId, peerId, "accept");
    setConn({ kind: "connecting", peerId });
  }

  function declineIncoming() {
    if (connRef.current.kind !== "incoming") return;
    void sendSignal(sessionId, connRef.current.peerId, "decline");
    setConn({ kind: "idle" });
  }

  function endConnection() {
    const c = connRef.current;
    if (c.kind === "connecting" || c.kind === "connected") {
      void sendSignal(sessionId, c.peerId, "end");
    }
    teardown();
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
    setVideo("none");
  }

  function processSignal(sig: SignalMsg) {
    switch (sig.type) {
      case "request": {
        if (connRef.current.kind === "idle") {
          setConn({ kind: "incoming", peerId: sig.fromId });
        } else {
          void sendSignal(sessionId, sig.fromId, "decline");
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
          void sendSignal(sessionId, sig.fromId, "end");
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
  useEffect(() => {
    processSignalRef.current = processSignal;
  });

  useEffect(() => {
    if (phase !== "live" || !sessionId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const data = await poll(sessionId);
        if (!active) return;
        setPeers(data.peers);
        for (const s of data.signals) processSignalRef.current(s);
      } catch (err) {
        // Reaped while throttled/backgrounded: re-join so we're visible again.
        const loc = locationRef.current;
        if (active && err instanceof SessionGoneError && loc) {
          try {
            await join(sessionId, loc.lat, loc.lng);
          } catch {}
        }
      }
      if (active) timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [phase, sessionId]);

  useEffect(() => {
    if (!sessionId || phase !== "live") return;
    const onLeave = () => leave(sessionId);
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [sessionId, phase]);

  async function handleReady(lat: number, lng: number) {
    locationRef.current = { lat, lng };
    await join(sessionId, lat, lng);
    setMyLocation({ lat, lng });
    setPhase("live");
  }

  const inChat = conn.kind === "connecting" || conn.kind === "connected";
  const link =
    conn.kind === "idle" ? null : { peerId: conn.peerId, phase: conn.kind };

  return (
    <MotionConfig reducedMotion="user">
      <main className="fixed inset-0 overflow-hidden bg-space">
        <WorldMap
          ref={mapHandle}
          mode={phase === "gate" ? "intro" : "live"}
          peers={peers}
          me={myLocation}
          link={link}
          onPeerClick={requestConnection}
          canConnect={conn.kind === "idle"}
        />

        <AnimatePresence>
          {phase === "gate" && <EntryGate key="gate" onReady={handleReady} />}
        </AnimatePresence>

        {phase === "live" && (
          <Hud
            online={peers.length}
            onRecenter={() => mapHandle.current?.recenter()}
          />
        )}

        {/* Top-centre stack: what you're waiting on, then transient notices. */}
        <div
          className={`pointer-events-none absolute inset-x-0 top-[calc(max(1rem,env(safe-area-inset-top))+3.25rem)] z-30 flex flex-col items-center gap-2 px-4 md:top-5 ${
            inChat ? "lg:pr-[432px]" : ""
          }`}
        >
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

        {conn.kind === "requesting" && (
          <div className="absolute left-1/2 top-20 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full bg-zinc-800/90 px-4 py-2 text-sm text-zinc-100 shadow-lg backdrop-blur">
            <span>Requesting connection…</span>
            <button
              onClick={cancelRequest}
              className="rounded-full bg-zinc-700 px-3 py-1 text-xs hover:bg-zinc-600"
            >
              Cancel
            </button>
          </div>
        )}

        {conn.kind === "incoming" && (
          <ConnectionPrompt
            title="A stranger wants to connect"
            acceptLabel="Accept"
            declineLabel="Decline"
            onAccept={acceptIncoming}
            onDecline={declineIncoming}
          />
        )}

        {inChat && (
          <ChatPanel
            messages={messages}
            connected={conn.kind === "connected"}
            videoBusy={video !== "none"}
            onSend={(text) => {
              peerRef.current?.sendChat(text);
              addMessage(true, text);
            }}
            onStartVideo={startVideoRequest}
            onEnd={endConnection}
          />
        )}

        {video === "requesting" && (
          <div className="absolute bottom-24 left-1/2 z-30 -translate-x-1/2 rounded-full bg-zinc-800/90 px-4 py-2 text-sm text-zinc-100 shadow-lg backdrop-blur">
            Waiting for stranger to accept video…
          </div>
        )}

        {video === "incoming" && (
          <ConnectionPrompt
            title="Start video call?"
            subtitle="The stranger wants to turn on video."
            acceptLabel="Accept"
            declineLabel="Decline"
            onAccept={acceptVideo}
            onDecline={declineVideo}
          />
        )}

        {video === "active" && (
          <VideoPanel
            localStream={localStream}
            remoteStream={remoteStream}
            onEnd={endVideo}
          />
        )}
      </main>
    </MotionConfig>
  );
}
