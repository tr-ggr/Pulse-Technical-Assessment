// The veil: a stand-in for your camera that is blurred *before* it leaves the
// device. Each frame is shrunk to a few pixels (VEIL_DETAIL wide) and scaled
// back up, so no face, text or body detail survives — the stranger's client
// can't "unblur" what was never sent. Swapped for the raw camera track only
// once both people have tapped Reveal (lib/webrtc.ts setRevealed).

// Width of the shrunken frame. At 12 px a face is a soft smudge of colour.
export const VEIL_DETAIL = 12;
// Width of the track actually sent. Small, so it's cheap to encode, and big
// enough that WebRTC encoders handle it everywhere.
export const VEIL_WIDTH = 160;
const VEIL_FPS = 15;

export interface Veil {
  track: MediaStreamTrack;
  stop: () => void;
}

export function createVeil(raw: MediaStream): Veil {
  // The raw camera plays in a muted, invisible <video> we can draw from. It
  // has to be in the document: some browsers won't decode a detached one.
  const source = document.createElement("video");
  source.muted = true;
  source.playsInline = true;
  source.setAttribute("aria-hidden", "true");
  source.style.cssText =
    "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
  source.srcObject = raw;
  document.body.appendChild(source);
  void source.play().catch(() => {});

  const tiny = document.createElement("canvas");
  const out = document.createElement("canvas");
  const tinyCtx = tiny.getContext("2d")!;
  const outCtx = out.getContext("2d")!;
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = "high";
  size(4 / 3);

  function size(aspect: number) {
    tiny.width = VEIL_DETAIL;
    tiny.height = Math.max(1, Math.round(VEIL_DETAIL / aspect));
    out.width = VEIL_WIDTH;
    out.height = Math.round(VEIL_WIDTH / aspect);
  }

  function draw() {
    const { videoWidth: w, videoHeight: h } = source;
    if (w && h && Math.abs(out.width / out.height - w / h) > 0.01) {
      size(w / h);
    }
    if (source.readyState >= 2) {
      tinyCtx.drawImage(source, 0, 0, tiny.width, tiny.height);
      outCtx.drawImage(tiny, 0, 0, out.width, out.height);
    } else {
      outCtx.fillStyle = "#000";
      outCtx.fillRect(0, 0, out.width, out.height);
    }
  }

  draw();
  const timer = setInterval(draw, 1000 / VEIL_FPS);
  const track = out.captureStream(VEIL_FPS).getVideoTracks()[0];

  return {
    track,
    stop() {
      clearInterval(timer);
      track.stop();
      source.srcObject = null;
      source.remove();
    },
  };
}
