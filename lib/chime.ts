// A soft two-note chime for requests that arrive while Pulse is in a
// background tab. Synthesised with WebAudio, so there's no asset to load.
//
// Browsers only let audio start after a user gesture, so primeAudio() must be
// called from one (the Enter button); after that the context keeps running
// even when the tab is hidden.

let ctx: AudioContext | null = null;

export function primeAudio(): void {
  try {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    // Audio is a nicety; never let it break entering.
  }
}

export function playChime(): void {
  if (!ctx || ctx.state !== "running") return;
  const now = ctx.currentTime;

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 3000;
  filter.connect(ctx.destination);

  // E5 then B5: an open fifth, gentle rather than alarming.
  [659.25, 987.77].forEach((freq, i) => {
    const start = now + i * 0.09;
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
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
