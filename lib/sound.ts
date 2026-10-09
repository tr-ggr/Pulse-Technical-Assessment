// Every sound in Pulse: interface clicks, event cues and the ambient music.
// All of it is synthesised with WebAudio, so there are no assets to load and
// nothing for the CSP's media-src to block.
//
// Browsers only let audio start after a user gesture, so primeAudio() must be
// called from one (any click does it); after that the context keeps running
// even when the tab is hidden.
//
//   sfx ─┐
//        ├─ master (sound on/off) ─ destination
// music ─┘

export type SoundName =
  | "tap"
  | "hover"
  | "toggleOn"
  | "toggleOff"
  | "send"
  | "receive"
  | "request"
  | "connect"
  | "disconnect"
  | "notice"
  | "incoming";

const STORAGE_KEY = "pulse:sound";
const MUSIC_VOLUME = 0.55;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfx: GainNode | null = null;
let music: GainNode | null = null;

// ── Sound on/off ───────────────────────────────────────────────────────────

let muted: boolean | null = null;
const listeners = new Set<() => void>();

function isMuted(): boolean {
  if (muted === null) {
    try {
      muted = window.localStorage.getItem(STORAGE_KEY) === "off";
    } catch {
      muted = false;
    }
  }
  return muted;
}

export function isSoundOn(): boolean {
  return typeof window === "undefined" || !isMuted();
}

export function setSoundOn(on: boolean): void {
  muted = !on;
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Private mode etc.: the choice just won't outlive the tab.
  }
  if (ctx && master) {
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(on ? 1 : 0, now + 0.08);
  }
  listeners.forEach((l) => l());
}

export function subscribeSound(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ── Context ────────────────────────────────────────────────────────────────

export function primeAudio(): void {
  try {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = isMuted() ? 0 : 1;
      master.connect(ctx.destination);
      sfx = ctx.createGain();
      sfx.connect(master);
      music = ctx.createGain();
      music.gain.value = 0;
      music.connect(master);
    }
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    // Audio is a nicety; never let it break the UI.
  }
}

// Sounds queued on a still-suspended context play once it resumes, so only a
// missing or closed context is a reason to skip.
function ready(): boolean {
  return !!ctx && ctx.state !== "closed";
}

// ── Effects ────────────────────────────────────────────────────────────────

interface ToneOpts {
  type?: OscillatorType;
  peak?: number;
  attack?: number;
  glideTo?: number;
  dest?: AudioNode;
}

function tone(freq: number, start: number, dur: number, opts: ToneOpts = {}) {
  const c = ctx!;
  const { type = "sine", peak = 0.05, attack = 0.005, glideTo } = opts;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, start + dur);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peak, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(opts.dest ?? sfx!);
  osc.start(start);
  osc.stop(start + dur + 0.05);
  return osc;
}

// Rapid repeats (double clicks, sweeping over a row of buttons) collapse into
// one sound instead of a machine-gun.
const MIN_GAP_MS: Partial<Record<SoundName, number>> = { hover: 60 };
const lastPlayed = new Map<SoundName, number>();

export function playSound(name: SoundName): void {
  if (!ready() || isMuted()) return;
  const nowMs = performance.now();
  if (nowMs - (lastPlayed.get(name) ?? -Infinity) < (MIN_GAP_MS[name] ?? 30)) {
    return;
  }
  lastPlayed.set(name, nowMs);

  try {
    const t = ctx!.currentTime + 0.005;
    switch (name) {
      case "tap": {
        // A touch of random pitch so repeated taps don't sound robotic.
        const f = 1250 + Math.random() * 150;
        tone(f, t, 0.06, { peak: 0.045, glideTo: f * 0.7 });
        break;
      }
      case "hover":
        tone(2200, t, 0.025, { peak: 0.01 });
        break;
      case "toggleOn":
        tone(660, t, 0.12, { peak: 0.04 });
        tone(990, t + 0.05, 0.14, { peak: 0.04 });
        break;
      case "toggleOff":
        tone(990, t, 0.12, { peak: 0.04 });
        tone(660, t + 0.05, 0.14, { peak: 0.04 });
        break;
      case "send":
        tone(520, t, 0.14, { peak: 0.05, glideTo: 1040 });
        break;
      case "receive":
        tone(523.25, t, 0.25, { peak: 0.045 });
        tone(659.25, t + 0.08, 0.3, { peak: 0.045 });
        break;
      case "request":
        tone(880, t, 0.5, { peak: 0.045 });
        tone(1760, t, 0.2, { peak: 0.015 });
        break;
      case "connect":
        // C5 E5 G5: a small, warm "you're in".
        [523.25, 659.25, 783.99].forEach((f, i) =>
          tone(f, t + i * 0.07, 0.6, { peak: 0.04 }),
        );
        break;
      case "disconnect":
        tone(392, t, 0.35, { peak: 0.045, type: "triangle" });
        tone(261.63, t + 0.1, 0.45, { peak: 0.045, type: "triangle" });
        break;
      case "notice":
        tone(740, t, 0.1, { peak: 0.025, type: "triangle" });
        break;
      case "incoming":
        playChime();
        break;
    }
  } catch {
    // Never let a sound throw into a click handler.
  }
}

// A soft two-note chime for someone asking for you.
export function playChime(): void {
  if (!ready() || isMuted()) return;
  const c = ctx!;
  const now = c.currentTime;

  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 3000;
  filter.connect(sfx!);

  // E5 then B5: an open fifth, gentle rather than alarming.
  [659.25, 987.77].forEach((freq, i) => {
    const start = now + i * 0.09;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.07, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.9);
    osc.connect(gain).connect(filter);
    osc.start(start);
    osc.stop(start + 1);
  });
}

// ── Ambient music ──────────────────────────────────────────────────────────
// A slow, endless Am9 → Fmaj7 → Cmaj7 → G6 pad with sparse pentatonic plucks
// echoing through a delay. Chords are queued a couple ahead on the audio
// clock, so a throttled timer in a background tab never leaves a gap.

const CHORD_S = 8;
const RELEASE_S = 3;
const CHORDS = [
  [220, 261.63, 329.63, 392, 493.88], // Am9
  [174.61, 220, 261.63, 329.63], // Fmaj7
  [130.81, 196, 246.94, 329.63], // Cmaj7
  [196, 246.94, 293.66, 329.63], // G6
];
const PLUCKS = [440, 523.25, 587.33, 659.25, 783.99, 880]; // A minor pentatonic

let padIn: AudioNode | null = null;
let pluckIn: AudioNode | null = null;
let playing = false;
let generation = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let nextChordAt = 0;
let chordIndex = 0;
const voices = new Set<OscillatorNode>();

function buildMusicGraph() {
  const c = ctx!;
  // Pads: warm lowpass whose cutoff drifts slowly, so the texture breathes.
  const padFilter = c.createBiquadFilter();
  padFilter.type = "lowpass";
  padFilter.frequency.value = 900;
  padFilter.Q.value = 0.4;
  const lfo = c.createOscillator();
  const lfoDepth = c.createGain();
  lfo.frequency.value = 0.05;
  lfoDepth.gain.value = 350;
  lfo.connect(lfoDepth).connect(padFilter.frequency);
  lfo.start();
  padFilter.connect(music!);
  padIn = padFilter;

  // Plucks: dry, plus a darkening feedback echo for space.
  const dry = c.createGain();
  const delay = c.createDelay(2);
  const feedback = c.createGain();
  const damp = c.createBiquadFilter();
  delay.delayTime.value = 0.42;
  feedback.gain.value = 0.38;
  damp.type = "lowpass";
  damp.frequency.value = 2400;
  dry.connect(music!);
  dry.connect(delay);
  delay.connect(damp).connect(feedback).connect(delay);
  damp.connect(music!);
  pluckIn = dry;
}

function track(osc: OscillatorNode) {
  voices.add(osc);
  osc.onended = () => voices.delete(osc);
}

function queueChord(notes: number[], start: number) {
  const c = ctx!;
  const peak = 0.06 / notes.length;
  for (const f of notes) {
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + 2.5);
    gain.gain.setValueAtTime(peak, start + CHORD_S);
    gain.gain.linearRampToValueAtTime(0, start + CHORD_S + RELEASE_S);
    gain.connect(padIn!);
    // Two slightly detuned voices per note give the pad its shimmer.
    for (const [type, detune] of [
      ["sine", -5],
      ["triangle", 5],
    ] as const) {
      const osc = c.createOscillator();
      osc.type = type;
      osc.frequency.value = f;
      osc.detune.value = detune;
      osc.connect(gain);
      osc.start(start);
      osc.stop(start + CHORD_S + RELEASE_S + 0.1);
      track(osc);
    }
  }

  const plucks = Math.floor(Math.random() * 3);
  for (let i = 0; i < plucks; i++) {
    const f = PLUCKS[Math.floor(Math.random() * PLUCKS.length)];
    const at = start + 1 + Math.random() * (CHORD_S - 2);
    track(tone(f, at, 1.8, { peak: 0.018, attack: 0.01, dest: pluckIn! }));
  }
}

function scheduleMusic() {
  const c = ctx!;
  while (nextChordAt < c.currentTime + CHORD_S * 2) {
    queueChord(CHORDS[chordIndex % CHORDS.length], nextChordAt);
    nextChordAt += CHORD_S;
    chordIndex++;
  }
}

export function startMusic(): void {
  if (playing || !ready()) return;
  try {
    const c = ctx!;
    playing = true;
    generation++;
    if (!padIn) buildMusicGraph();
    const now = c.currentTime;
    music!.gain.cancelScheduledValues(now);
    music!.gain.setValueAtTime(music!.gain.value, now);
    music!.gain.linearRampToValueAtTime(MUSIC_VOLUME, now + 2.5);
    // Coming back mid fade-out keeps the queued chords; otherwise start fresh.
    nextChordAt = Math.max(nextChordAt, now + 0.05);
    scheduleMusic();
    timer = setInterval(scheduleMusic, 1000);
  } catch {
    playing = false;
  }
}

export function stopMusic(): void {
  if (!playing || !ctx) return;
  playing = false;
  if (timer) clearInterval(timer);
  timer = null;
  const now = ctx.currentTime;
  music!.gain.cancelScheduledValues(now);
  music!.gain.setValueAtTime(music!.gain.value, now);
  music!.gain.linearRampToValueAtTime(0, now + 1.2);
  // Once faded, silence the chords queued ahead, unless music restarted.
  const gen = generation;
  setTimeout(() => {
    if (playing || gen !== generation) return;
    voices.forEach((osc) => {
      try {
        osc.stop();
      } catch {
        // Already stopped.
      }
    });
    voices.clear();
    nextChordAt = 0;
  }, 1300);
}
