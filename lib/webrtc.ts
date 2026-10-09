import { MAX_MESSAGE_LENGTH } from "@/lib/chatGuard";
import { createVeil, type Veil } from "@/lib/veil";

export type DescType = "offer" | "answer" | "ice";
const PEER_CONTROLS = [
  "video-request",
  "video-accept",
  "video-decline",
  "video-end",
  // Mid-call media state, so the other side can show "muted" / "camera off"
  // instead of silence and a frozen-looking black frame.
  "mic-on",
  "mic-off",
  "cam-on",
  "cam-off",
  // Mutual reveal: each side's camera stays veiled at the source until both
  // have sent "reveal". Either side sending "veil" puts both back under.
  "reveal",
  "veil",
] as const;
export type PeerControl = (typeof PEER_CONTROLS)[number];

function isPeerControl(value: unknown): value is PeerControl {
  return PEER_CONTROLS.includes(value as PeerControl);
}

interface PeerCallbacks {
  onSignal: (type: DescType, payload: string) => void;
  onChat: (text: string) => void;
  onControl: (ctrl: PeerControl) => void;
  onRemoteStream: (stream: MediaStream | null) => void;
  onConnectionState: (state: RTCPeerConnectionState) => void;
  onChannelOpen: () => void;
  onChannelClose: () => void;
}

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export class PeerSession {
  private pc: RTCPeerConnection;
  private dc: RTCDataChannel | null = null;
  private readonly polite: boolean;
  private makingOffer = false;
  private ignoreOffer = false;
  private localStream: MediaStream | null = null;
  private veil: Veil | null = null;
  private videoSender: RTCRtpSender | null = null;
  private closed = false;
  private readonly cb: PeerCallbacks;
  private pendingCandidates: RTCIceCandidateInit[] = [];

  constructor(initiator: boolean, cb: PeerCallbacks) {
    this.cb = cb;
    this.polite = !initiator;
    this.pc = new RTCPeerConnection(ICE_CONFIG);

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.cb.onSignal("ice", JSON.stringify(candidate));
      }
    };

    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        if (this.pc.localDescription) {
          this.cb.onSignal("offer", JSON.stringify(this.pc.localDescription));
        }
      } finally {
        this.makingOffer = false;
      }
    };

    this.pc.ontrack = ({ streams }) => {
      this.cb.onRemoteStream(streams[0] ?? null);
    };

    this.pc.onconnectionstatechange = () => {
      this.cb.onConnectionState(this.pc.connectionState);
    };

    if (initiator) {
      this.dc = this.pc.createDataChannel("chat");
      this.wireDataChannel(this.dc);
    } else {
      this.pc.ondatachannel = (e) => {
        this.dc = e.channel;
        this.wireDataChannel(this.dc);
      };
    }
  }

  private wireDataChannel(dc: RTCDataChannel) {
    dc.onopen = () => this.cb.onChannelOpen();
    // The peer closing its tab/connection closes the channel well before ICE
    // gives up — surface it so the chat ends promptly. Ignore our own close().
    dc.onclose = () => {
      if (!this.closed) this.cb.onChannelClose();
    };
    dc.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string);
        if (msg.t === "chat" && typeof msg.text === "string") {
          // Our input caps what we send; a modified client could send more.
          this.cb.onChat(msg.text.slice(0, MAX_MESSAGE_LENGTH));
        } else if (msg.t === "ctrl" && isPeerControl(msg.ctrl)) {
          this.cb.onControl(msg.ctrl);
        }
      } catch {}
    };
  }

  async handleSignal(type: DescType, payload: string) {
    if (this.closed) return;
    const data = JSON.parse(payload);

    if (type === "ice") {
      if (!this.pc.remoteDescription) {
        this.pendingCandidates.push(data);
        return;
      }
      try {
        await this.pc.addIceCandidate(data);
      } catch {}
      return;
    }

    const desc = data as RTCSessionDescriptionInit;
    const offerCollision =
      desc.type === "offer" &&
      (this.makingOffer || this.pc.signalingState !== "stable");
    this.ignoreOffer = !this.polite && offerCollision;
    if (this.ignoreOffer) return;

    // Candidates can only be added once a remote description exists, so apply
    // it first; anything queued meanwhile (including during this await) is
    // flushed right after.
    await this.pc.setRemoteDescription(desc);
    await this.flushPendingCandidates();
    if (desc.type === "offer") {
      await this.pc.setLocalDescription();
      if (this.pc.localDescription) {
        this.cb.onSignal("answer", JSON.stringify(this.pc.localDescription));
      }
    }
  }

  private async flushPendingCandidates() {
    if (this.pendingCandidates.length === 0) return;
    const queued = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of queued) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch {}
    }
  }

  sendChat(text: string) {
    this.safeSend({ t: "chat", text });
  }

  sendControl(ctrl: PeerControl) {
    this.safeSend({ t: "ctrl", ctrl });
  }

  private safeSend(obj: unknown) {
    if (this.dc && this.dc.readyState === "open") {
      this.dc.send(JSON.stringify(obj));
    }
  }

  // Returns the raw camera stream for the self-view. What the stranger gets
  // is the veiled stand-in until setRevealed(true).
  async startVideo(): Promise<MediaStream> {
    if (!this.localStream) {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      this.localStream = stream;
      this.veil = createVeil(stream);
      for (const track of stream.getAudioTracks()) {
        this.pc.addTrack(track, stream);
      }
      // Added with the raw stream so the far side groups it with our audio.
      this.videoSender = this.pc.addTrack(this.veil.track, stream);
    }
    return this.localStream;
  }

  // Swap what the stranger receives between the veil and the raw camera.
  // replaceTrack needs no renegotiation, so it's instant both ways.
  async setRevealed(on: boolean) {
    const raw = this.localStream?.getVideoTracks()[0];
    if (!this.videoSender || !this.veil || !raw) return;
    const next = on ? raw : this.veil.track;
    if (this.videoSender.track === next) return;
    try {
      await this.videoSender.replaceTrack(next);
    } catch {}
  }

  stopVideo() {
    this.veil?.stop();
    this.veil = null;
    this.videoSender = null;
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) track.stop();
      for (const sender of this.pc.getSenders()) {
        if (sender.track) {
          try {
            this.pc.removeTrack(sender);
          } catch {}
        }
      }
      this.localStream = null;
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.stopVideo();
    if (this.dc) {
      try {
        this.dc.close();
      } catch {}
    }
    try {
      this.pc.close();
    } catch {}
  }
}
