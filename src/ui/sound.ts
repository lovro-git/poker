// Real poker table sounds — Kenney "Casino Audio" samples (CC0, bundled under
// src/assets/sfx). Played through the Web Audio API for low latency and so the
// mute toggle + per-event volume work. Muted by default; the first unmute is a
// user gesture, which also unlocks audio and preloads the samples.

import cardShuffle from "../assets/sfx/card-shuffle.ogg";
import cardSlide1 from "../assets/sfx/card-slide-1.ogg";
import cardSlide3 from "../assets/sfx/card-slide-3.ogg";
import cardSlide5 from "../assets/sfx/card-slide-5.ogg";
import cardPlace2 from "../assets/sfx/card-place-2.ogg";
import cardShove1 from "../assets/sfx/card-shove-1.ogg";
import cardShove3 from "../assets/sfx/card-shove-3.ogg";
import chipLay1 from "../assets/sfx/chip-lay-1.ogg";
import chipsStack2 from "../assets/sfx/chips-stack-2.ogg";
import chipsStack4 from "../assets/sfx/chips-stack-4.ogg";
import chipsCollide1 from "../assets/sfx/chips-collide-1.ogg";
import knockUrl from "../assets/sfx/knock.ogg"; // real wood knock (public domain)

export type Sfx = "deal" | "card" | "chip" | "check" | "fold" | "turn" | "win" | "reveal" | "allin" | "tick";
// Sample-backed events (check = synth knock, turn/tick = synth cues).
type SampleSfx = "deal" | "card" | "chip" | "fold" | "win" | "reveal" | "allin";

// Each event maps to one or more real samples (a random variant plays) + a gain.
const EVENTS: Record<SampleSfx, { urls: string[]; gain: number }> = {
  deal: { urls: [cardShuffle], gain: 0.55 },
  card: { urls: [cardSlide1, cardSlide3, cardPlace2], gain: 0.8 },
  chip: { urls: [chipsStack2, chipLay1, chipsStack4], gain: 0.9 },
  fold: { urls: [cardShove1, cardShove3], gain: 0.75 },
  win: { urls: [chipsCollide1], gain: 1.0 },
  reveal: { urls: [cardSlide5], gain: 0.6 },
  allin: { urls: [chipsCollide1, chipsStack4], gain: 1.0 },
};
const ALL_URLS = [...new Set(Object.values(EVENTS).flatMap((e) => e.urls))];

let ctx: AudioContext | null = null;
let muted = (localStorage.getItem("holdem:muted") ?? "1") !== "0"; // default: muted
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

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean): void {
  muted = m;
  localStorage.setItem("holdem:muted", m ? "1" : "0");
  if (!m) {
    void ac().resume?.(); // unlock on the unmuting gesture
    for (const url of ALL_URLS) void load(url); // warm the cache
    loadKnock();
  }
}

// The knock is a 6s public-domain clip of several raps; decode it once and find
// the first onset so we can play a single clean rap for a "check".
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

export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}

function playBuffer(buf: AudioBuffer, gain: number): void {
  const c = ac();
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(g);
  g.connect(c.destination);
  src.start();
}

/** A short two-tone chime for "your turn" — a UI alert, not a table sound. */
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

/** A real wooden knock — plays a single clean rap sliced from the clip. */
function knock(): void {
  if (!knockBuf) {
    loadKnock(); // not decoded yet — ready for next time
    return;
  }
  const c = ac();
  const src = c.createBufferSource();
  src.buffer = knockBuf;
  const g = c.createGain();
  g.gain.value = 0.9;
  src.connect(g);
  g.connect(c.destination);
  src.start(c.currentTime, knockAt, 0.6); // one rap from the first onset
}

/** A soft high tick — shot-clock countdown warning. */
function tick(): void {
  const c = ac();
  const t = c.currentTime;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "square";
  o.frequency.value = 1500;
  o.connect(g);
  g.connect(c.destination);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.08, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  o.start(t);
  o.stop(t + 0.08);
}

export function play(name: Sfx): void {
  if (muted) return;
  try {
    void ac().resume?.();
    if (name === "turn") return chime();
    if (name === "check") return knock();
    if (name === "tick") return tick();
    const ev = EVENTS[name as SampleSfx];
    if (!ev) return;
    const url = ev.urls[Math.floor(Math.random() * ev.urls.length)];
    const buf = buffers.get(url);
    if (buf) playBuffer(buf, ev.gain);
    else void load(url).then((b) => b && !muted && playBuffer(b, ev.gain));
  } catch {
    /* audio not available — ignore */
  }
}
