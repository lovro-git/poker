// Poker table sounds — Kenney "Casino Audio" samples (CC0) + a public-domain
// wood knock, played via the Web Audio API. No network at runtime; the audio
// context unlocks on the first user gesture. A mute toggle persists in storage.

import cardSlide1 from "../assets/sfx/card-slide-1.ogg";
import cardSlide3 from "../assets/sfx/card-slide-3.ogg";
import cardPlace2 from "../assets/sfx/card-place-2.ogg";
import chipLay1 from "../assets/sfx/chip-lay-1.ogg";
import chipsStack2 from "../assets/sfx/chips-stack-2.ogg";
import chipsStack4 from "../assets/sfx/chips-stack-4.ogg";
import cardShove1 from "../assets/sfx/card-shove-1.ogg";
import cardShove3 from "../assets/sfx/card-shove-3.ogg";
import chipsCollide1 from "../assets/sfx/chips-collide-1.ogg";
import knockUrl from "../assets/sfx/knock.ogg";

export type Sfx = "card" | "chip" | "check" | "fold" | "turn" | "win";
type SampleSfx = "card" | "chip" | "fold" | "win";

const EVENTS: Record<SampleSfx, { urls: string[]; gain: number }> = {
  card: { urls: [cardSlide1, cardSlide3, cardPlace2], gain: 1.15 }, // community cards
  chip: { urls: [chipsStack2, chipLay1, chipsStack4], gain: 0.9 }, // call / bet / raise
  fold: { urls: [cardShove1, cardShove3], gain: 0.75 }, // mucking
  win: { urls: [chipsCollide1], gain: 1.0 }, // raking the pot
};
const ALL_URLS = [...new Set(Object.values(EVENTS).flatMap((e) => e.urls))];

let ctx: AudioContext | null = null;
let muted = localStorage.getItem("holdem:muted") === "1"; // default: on
const buffers = new Map<string, AudioBuffer>();
const loading = new Map<string, Promise<AudioBuffer | null>>();

function ac(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
  }
  return ctx;
}

function load(url: string): Promise<AudioBuffer | null> {
  const cached = buffers.get(url);
  if (cached) return Promise.resolve(cached);
  let p = loading.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((b) => ac().decodeAudioData(b))
      .then((buf) => {
        buffers.set(url, buf);
        return buf;
      })
      .catch(() => null);
    loading.set(url, p);
  }
  return p;
}

// Warm the cache + unlock the audio context on the first user gesture anywhere,
// so the first action already has sound (autoplay policy needs a gesture).
let unlocked = false;
function unlock(): void {
  if (unlocked) return;
  unlocked = true;
  void ac().resume?.();
  for (const url of ALL_URLS) void load(url);
  loadKnock();
}
for (const ev of ["pointerdown", "keydown", "touchstart"]) {
  window.addEventListener(ev, unlock, { once: false, passive: true });
}

export function isMuted(): boolean {
  return muted;
}
export function setMuted(m: boolean): void {
  muted = m;
  localStorage.setItem("holdem:muted", m ? "1" : "0");
  if (!m) unlock();
}
export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}

// The knock is a multi-rap clip; decode once and slice a single clean rap.
let knockBuf: AudioBuffer | null = null;
let knockAt = 0;
let knockLoading = false;
function loadKnock(): void {
  if (knockBuf || knockLoading) return;
  knockLoading = true;
  fetch(knockUrl)
    .then((r) => r.arrayBuffer())
    .then((b) => ac().decodeAudioData(b))
    .then((buf) => {
      const d = buf.getChannelData(0);
      let i = 0;
      while (i < d.length && Math.abs(d[i]) < 0.08) i++;
      knockAt = Math.max(0, i / buf.sampleRate - 0.008);
      knockBuf = buf;
    })
    .catch(() => {})
    .finally(() => {
      knockLoading = false;
    });
}

function playBuffer(buf: AudioBuffer, gain: number, offset = 0, dur?: number): void {
  const c = ac();
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(g);
  g.connect(c.destination);
  if (dur != null) src.start(c.currentTime, offset, dur);
  else src.start();
}

function knock(): void {
  if (!knockBuf) {
    loadKnock();
    return;
  }
  playBuffer(knockBuf, 0.9, knockAt, 0.6);
}

/** A short two-tone chime for "your turn". */
function chime(): void {
  const c = ac();
  const now = c.currentTime;
  for (const [freq, delay] of [[660, 0], [880, 0.11]] as const) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    o.connect(g);
    g.connect(c.destination);
    const t = now + delay;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.start(t);
    o.stop(t + 0.19);
  }
}

/** A bright rising arpeggio for the round winner (layered over the chip rake). */
function winChime(): void {
  const c = ac();
  const now = c.currentTime;
  [523, 659, 784, 1047].forEach((f, i) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "triangle";
    o.frequency.value = f;
    o.connect(g);
    g.connect(c.destination);
    const t = now + i * 0.085;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.17, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
    o.start(t);
    o.stop(t + 0.38);
  });
}

export function play(name: Sfx): void {
  if (muted) return;
  try {
    void ac().resume?.();
    if (name === "turn") return chime();
    if (name === "check") return knock();
    if (name === "win") winChime(); // plus the chip-rake sample below
    const ev = EVENTS[name as SampleSfx];
    if (!ev) return;
    const url = ev.urls[Math.floor(Math.random() * ev.urls.length)];
    const buf = buffers.get(url);
    if (buf) playBuffer(buf, ev.gain);
    else void load(url).then((b) => b && !muted && playBuffer(b, ev.gain));
  } catch {
    /* audio unavailable — ignore */
  }
}
