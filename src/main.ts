import "./ui/styles.css";
import { defaultConfig } from "./engine/game";
import type { TableConfig } from "./engine/types";
import { createGuest, createHost, resumeHost, type Client, type Identity } from "./net/room";
import type { ClientView } from "./net/protocol";
import { renderLobby, renderTable, type TableHandlers, type UIState } from "./ui/screens";

const root = document.getElementById("app")!;

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
const ui: UIState = { raiseTo: 0, turnKey: "" };
let clockTimer: ReturnType<typeof setInterval> | null = null;

function toast(text: string) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  document.body.append(t);
  setTimeout(() => t.remove(), 2000);
}

const handlers: TableHandlers = {
  act: (a) => client?.act(a),
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
  leave: () => {
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
  location.hash = `room=${roomKey}`;
  newClient.onView((v) => {
    // Reset the raise slider when it becomes a fresh decision.
    const turnKey = `${v.handNumber}:${v.toActSeat}:${v.currentBet}`;
    if (turnKey !== ui.turnKey) {
      ui.turnKey = turnKey;
      if (v.toActSeat === v.yourSeat) ui.raiseTo = 0;
    }
    view = v;
    renderTable(root, v, ui, handlers);
  });

  if (clockTimer) clearInterval(clockTimer);
  clockTimer = setInterval(tickClock, 250);
}

function tickClock() {
  if (!view || view.actDeadline == null || view.stage === "showdown") return;
  const el = document.querySelector(".clock-num");
  if (!el) return;
  const secs = Math.max(0, Math.ceil((view.actDeadline - Date.now()) / 1000));
  el.textContent = `${secs}s`;
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
      localStorage.removeItem("holdem:hostkey");
      startClient(createGuest(key, { playerId: me.playerId, name }), key);
    },
  });
}

function boot() {
  const me = getIdentity();
  const room = roomFromHash();
  if (!room) {
    showLobby("");
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
