// Tiny synthesized sound effects via the Web Audio API — no asset files, so it
// works on the static GitHub Pages deploy with no network requests. Muted by
// default; the first unmute happens on a user gesture (which also unlocks audio).

let ctx: AudioContext | null = null;
let muted = (localStorage.getItem("holdem:muted") ?? "1") !== "0"; // default: muted

function ac(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
  }
  return ctx;
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean): void {
  muted = m;
  localStorage.setItem("holdem:muted", m ? "1" : "0");
  if (!m) void ac().resume?.(); // unlock on the unmuting gesture
}

export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}

/** Exponential attack/decay envelope on a gain node. */
function env(g: GainNode, t0: number, peak: number, dur: number, attack = 0.005): void {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
}

interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  delay?: number;
}

function tone(freq: number, dur: number, { type = "sine", gain = 0.2, delay = 0 }: ToneOpts = {}): void {
  const c = ac();
  const t0 = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  o.connect(g);
  g.connect(c.destination);
  env(g, t0, gain, dur);
  o.start(t0);
  o.stop(t0 + dur + 0.03);
}

interface NoiseOpts {
  gain?: number;
  delay?: number;
  hp?: number;
  lp?: number;
}

function noise(dur: number, { gain = 0.2, delay = 0, hp = 0, lp = 9000 }: NoiseOpts = {}): void {
  const c = ac();
  const t0 = c.currentTime + delay;
  const n = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  let node: AudioNode = src;
  if (hp) {
    const f = c.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = hp;
    node.connect(f);
    node = f;
  }
  const low = c.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = lp;
  node.connect(low);
  low.connect(g);
  g.connect(c.destination);
  env(g, t0, gain, dur);
  src.start(t0);
  src.stop(t0 + dur + 0.03);
}

export type Sfx = "deal" | "card" | "chip" | "check" | "fold" | "turn" | "win" | "reveal" | "click";

const SFX: Record<Sfx, () => void> = {
  deal: () => noise(0.2, { gain: 0.14, hp: 1000, lp: 6000 }),
  card: () => {
    noise(0.09, { gain: 0.12, hp: 2200, lp: 9000 });
    tone(900, 0.05, { type: "triangle", gain: 0.03, delay: 0.02 });
  },
  chip: () => {
    noise(0.05, { gain: 0.13, hp: 3000, lp: 12000 });
    tone(2400, 0.04, { type: "square", gain: 0.04, delay: 0.01 });
    tone(3100, 0.04, { type: "square", gain: 0.03, delay: 0.045 });
  },
  check: () => tone(150, 0.09, { type: "sine", gain: 0.24 }),
  fold: () => noise(0.13, { gain: 0.1, hp: 400, lp: 2400 }),
  turn: () => {
    tone(660, 0.12, { type: "sine", gain: 0.17 });
    tone(880, 0.15, { type: "sine", gain: 0.17, delay: 0.11 });
  },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.36, { type: "triangle", gain: 0.13, delay: i * 0.09 })),
  reveal: () => {
    tone(392, 0.2, { type: "sine", gain: 0.1 });
    tone(523, 0.22, { type: "sine", gain: 0.1, delay: 0.12 });
  },
  click: () => tone(1200, 0.03, { type: "square", gain: 0.05 }),
};

export function play(name: Sfx): void {
  if (muted) return;
  try {
    void ac().resume?.();
    SFX[name]?.();
  } catch {
    /* audio not available — ignore */
  }
}
