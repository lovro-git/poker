import "./ui/styles.css";
import { applyTheme, getLayout, setLayout } from "./ui/dom";
import { defaultConfig } from "./engine/game";
import type { TableConfig } from "./engine/types";
import { createGuest, createHost, resumeHost, type Client, type Identity } from "./net/room";
import type { ClientView } from "./net/protocol";
import { renderConnecting, renderLobby, renderTable, type TableHandlers, type UIState } from "./ui/screens";
import { play as playSfx } from "./ui/sound";

const root = document.getElementById("app")!;

// Light is the default; restore the saved preference before first paint.
applyTheme((localStorage.getItem("holdem:theme") as "light" | "dark") ?? "light");

// --- Identity --------------------------------------------------------------

function getIdentity(): Identity {
  let pid = localStorage.getItem("holdem:pid");
  if (!pid) {
    pid = "p_" + randomKey(16);
    localStorage.setItem("holdem:pid", pid);
  }
  const name = localStorage.getItem("holdem:name") ?? "Player";
  return { playerId: pid, name };
}

function randomKey(len: number): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function roomFromHash(): string | null {
  const m = location.hash.match(/room=([A-Za-z0-9-]+)/);
  return m ? m[1] : null;
}

function linkFor(key: string): string {
  return `${location.origin}${location.pathname}#room=${key}`;
}

// --- App state -------------------------------------------------------------

let client: Client | null = null;
let view: ClientView | null = null;
const ui: UIState = { raiseTo: 0, turnKey: "", prevBoardLen: 0, prevHand: 0 };
let clockTimer: ReturnType<typeof setInterval> | null = null;
let connectTimer: ReturnType<typeof setTimeout> | null = null;

function toast(text: string) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  document.body.append(t);
  setTimeout(() => t.remove(), 2000);
}

let suppressActionSfx = false;

const handlers: TableHandlers = {
  act: (a) => {
    // Immediate local feedback (the view diff can't attribute the change to us).
    if (a.type === "fold") playSfx("fold");
    else if (a.type === "check") playSfx("check");
    else playSfx("chip"); // call / raise
    suppressActionSfx = true;
    client?.act(a);
  },
  rebuy: () => client?.rebuy(),
  sitOut: (v) => client?.sitOut(v),
  show: (v) => client?.show(v),
  start: () => client?.start(),
  copyLink: () => {
    const key = roomFromHash();
    if (!key) return;
    navigator.clipboard?.writeText(linkFor(key)).then(
      () => toast("Invite link copied"),
      () => toast(linkFor(key)),
    );
  },
  toggleLayout: () => {
    setLayout(getLayout() === "list" ? "table" : "list");
    if (view) renderTable(root, view, ui, handlers);
  },
  rerender: () => {
    if (view) renderTable(root, view, ui, handlers);
  },
  leave: () => {
    if (connectTimer) clearTimeout(connectTimer);
    connectTimer = null;
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = null;
    client?.leave();
    client = null;
    view = null;
    localStorage.removeItem("holdem:hostkey");
    location.hash = "";
    showLobby("");
  },
};

function startClient(newClient: Client, roomKey: string) {
  client = newClient;
  view = null;
  location.hash = `room=${roomKey}`;

  // A guest sees nothing until the host's first state arrives — show a
  // connecting screen with feedback, and a stronger hint if it stalls.
  if (!newClient.isHost) {
    renderConnecting(root, roomKey, handlers.leave);
    if (connectTimer) clearTimeout(connectTimer);
    connectTimer = setTimeout(() => {
      if (!view) renderConnecting(root, roomKey, handlers.leave, true);
    }, 10000);
  }

  newClient.onView((v) => {
    if (connectTimer) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
    // Reset the raise slider when it becomes a fresh decision.
    const turnKey = `${v.handNumber}:${v.toActSeat}:${v.currentBet}`;
    if (turnKey !== ui.turnKey) {
      ui.turnKey = turnKey;
      if (v.toActSeat === v.yourSeat) ui.raiseTo = 0;
    }
    soundForView(view, v);
    view = v;
    renderTable(root, v, ui, handlers);
  });

  if (clockTimer) clearInterval(clockTimer);
  clockTimer = setInterval(tickClock, 250);
}

/** Fire a sound for whatever changed between two consecutive views. */
function soundForView(prev: ClientView | null, v: ClientView) {
  if (!prev) return;
  if (v.handNumber !== prev.handNumber) {
    playSfx("deal"); // new hand dealt
  } else if (v.board.length > prev.board.length) {
    playSfx("card"); // flop/turn/river dealt
  } else if (!suppressActionSfx) {
    // Another player's action.
    const folded = v.seats.some((s, i) => s && s.status === "folded" && prev.seats[i]?.status !== "folded");
    if (folded) playSfx("fold");
    else if (v.pot > prev.pot) playSfx("chip"); // call / bet / raise
    else if (v.toActSeat !== prev.toActSeat && v.stage === prev.stage && v.stage !== "showdown") playSfx("check");
  }
  suppressActionSfx = false; // only skips the immediate echo of our own action
  // Your turn just started.
  if (v.stage !== "showdown" && v.toActSeat >= 0 && v.toActSeat === v.yourSeat && prev.toActSeat !== v.yourSeat) {
    playSfx("turn");
  }
}

function tickClock() {
  if (!view || view.actDeadline == null || view.stage === "showdown") return;
  const remaining = view.actDeadline - Date.now();
  const secs = Math.max(0, Math.ceil(remaining / 1000));
  const el = document.querySelector(".clock-num");
  if (el) el.textContent = `${secs}s`;
  // Drive the avatar's shot-clock ring on the acting pod.
  const total = (view.config.shotClockSec || 45) * 1000;
  const frac = Math.max(0, Math.min(1, remaining / total));
  (document.querySelector(".pod.is-acting") as HTMLElement | null)?.style.setProperty("--clock", String(frac));
}

// --- Routing ---------------------------------------------------------------

function showLobby(err: string) {
  const me = getIdentity();
  renderLobby(root, roomFromHash() ?? "", err, {
    create: (name, opts) => {
      const key = "PKR-" + randomKey(4);
      const config: TableConfig = defaultConfig({
        format: opts.format,
        buyIn: opts.buyIn,
        smallBlind: opts.sb,
        bigBlind: opts.bb,
        maxSeats: opts.seats,
        shotClockSec: opts.clock,
      });
      localStorage.setItem("holdem:hostkey", key);
      startClient(createHost(key, { playerId: me.playerId, name }, config), key);
    },
    join: (name, key) => {
      if (isTestKey(key)) {
        startTestRoom(name);
      } else {
        localStorage.removeItem("holdem:hostkey");
        startClient(createGuest(key, { playerId: me.playerId, name }), key);
      }
    },
  });
}

/** "TEST" (with or without the PKR- prefill) opens the local bot table. */
function isTestKey(key: string): boolean {
  return key.replace(/^PKR-/i, "").toUpperCase() === "TEST";
}

function startTestRoom(name: string) {
  const me = getIdentity();
  localStorage.setItem("holdem:hostkey", "TEST");
  startClient(createHost("TEST", { playerId: me.playerId, name }, defaultConfig({ maxSeats: 8 })), "TEST");
}

function boot() {
  const me = getIdentity();
  const room = roomFromHash();
  if (!room) {
    showLobby("");
    return;
  }
  if (isTestKey(room)) {
    startTestRoom(me.name && me.name !== "Player" ? me.name : "You");
    return;
  }
  // Resume as host if this browser created this room; otherwise join as guest.
  const hostKey = localStorage.getItem("holdem:hostkey");
  if (hostKey === room) {
    const resumed = resumeHost(room, { playerId: me.playerId, name: me.name });
    if (resumed) {
      startClient(resumed, room);
      return;
    }
  }
  if (me.name && me.name !== "Player") {
    startClient(createGuest(room, { playerId: me.playerId, name: me.name }), room);
  } else {
    // Need a name first — show the lobby with the key prefilled.
    showLobby("");
  }
}

boot();
