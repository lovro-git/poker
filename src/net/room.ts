import { joinRoom, type Room } from "trystero";
import {
  applyAction,
  createGame,
  isHandInProgress,
  legalActions,
  muck,
  prepareNextHand,
  rebuy,
  removePlayer,
  seatPlayer,
  setSitOut,
  showCards,
  startHand,
} from "../engine/game";
import type { GameState, PlayerAction, TableConfig } from "../engine/types";
import { APP_ID, viewFor, type ClientView, type Command } from "./protocol";

export interface Identity {
  playerId: string;
  name: string;
}

/** What the UI talks to — identical shape for host and guest. */
export interface Client {
  readonly isHost: boolean;
  readonly roomKey: string;
  onView(cb: (v: ClientView) => void): void;
  act(action: PlayerAction): void;
  rebuy(): void;
  sitOut(sitOut: boolean): void;
  show(show: boolean): void;
  start(): void; // host: deal now; guest: no-op
  leave(): void;
}

const stateKey = (roomKey: string) => `holdem:host:${roomKey}`;

// Rendezvous config shared by host and guest — both must use the same relays to
// find each other. A curated set of major, reliable nostr relays with redundancy.
const RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://relay.primal.net",
  "wss://relay.snort.social",
  "wss://nostr.mom",
];
const ROOM_CONFIG = {
  appId: APP_ID,
  relayUrls: RELAYS,
  // Connect to ALL relays (not a random subset) so host and guest are guaranteed
  // to share a rendezvous relay — the usual cause of "join never connects".
  relayRedundancy: RELAYS.length,
};

// --- Host ------------------------------------------------------------------

class HostClient implements Client {
  readonly isHost = true;
  private room: Room;
  private state: GameState;
  private peerToPlayer = new Map<string, string>();
  private connected = new Set<string>();
  private pending: Identity[] = []; // spectators waiting for a seat
  private viewCb: ((v: ClientView) => void) | null = null;
  private progressScheduled = false;
  private deadlineSeat = -1;
  private sendState: (v: ClientView, target: string) => void;
  private clock: ReturnType<typeof setInterval>;

  constructor(
    readonly roomKey: string,
    private me: Identity,
    config: TableConfig,
    resume?: GameState,
  ) {
    this.state = resume ?? createGame(config);
    if (!resume) seatPlayer(this.state, me.playerId, me.name, 0);
    this.connected.add(me.playerId);

    this.room = joinRoom(ROOM_CONFIG, roomKey);
    // Trystero's generic wants a JSON index-signature type; our structs are
    // JSON-serializable at runtime, so we type at this boundary and use `any`.
    const [sendState] = this.room.makeAction<any>("st");
    const [, getCmd] = this.room.makeAction<any>("cmd");
    this.sendState = (v, target) => void sendState(v, target);

    getCmd((cmd: Command, peerId: string) => {
      if (cmd.t === "join") this.peerToPlayer.set(peerId, cmd.playerId);
      this.handle(cmd);
    });
    this.room.onPeerLeave((peerId) => {
      const pid = this.peerToPlayer.get(peerId);
      this.peerToPlayer.delete(peerId);
      if (pid && ![...this.peerToPlayer.values()].includes(pid)) {
        this.connected.delete(pid);
        this.afterChange();
      }
    });

    this.clock = setInterval(() => this.tickClock(), 300);
    this.afterChange();
  }

  onView(cb: (v: ClientView) => void) {
    this.viewCb = cb;
    cb(viewFor(this.state, this.ctx(this.me.playerId, true)));
  }

  act(action: PlayerAction) {
    this.handle({ t: "action", playerId: this.me.playerId, action });
  }
  rebuy() {
    this.handle({ t: "rebuy", playerId: this.me.playerId });
  }
  sitOut(sitOut: boolean) {
    this.handle({ t: "sitOut", playerId: this.me.playerId, sitOut });
  }
  show(show: boolean) {
    this.handle({ t: "show", playerId: this.me.playerId, show });
  }
  start() {
    if (!isHandInProgress(this.state)) this.nextHand();
  }
  leave() {
    clearInterval(this.clock);
    localStorage.removeItem(stateKey(this.roomKey));
    void this.room.leave();
  }

  // --- command handling ---

  private handle(cmd: Command) {
    const s = this.state;
    switch (cmd.t) {
      case "join": {
        this.connected.add(cmd.playerId);
        const seat = seatPlayer(s, cmd.playerId, cmd.name);
        if (seat < 0 && !this.pending.some((p) => p.playerId === cmd.playerId)) {
          this.pending.push({ playerId: cmd.playerId, name: cmd.name });
        }
        break;
      }
      case "action": {
        const idx = s.seats.findIndex((x) => x?.playerId === cmd.playerId);
        if (idx >= 0 && s.toActSeat === idx) applyAction(s, idx, cmd.action);
        break;
      }
      case "rebuy":
        rebuy(s, cmd.playerId);
        break;
      case "sitOut":
        setSitOut(s, cmd.playerId, cmd.sitOut);
        break;
      case "show":
        if (cmd.show) showCards(s, cmd.playerId);
        else muck(s, cmd.playerId);
        break;
      case "leave":
        this.connected.delete(cmd.playerId);
        this.pending = this.pending.filter((p) => p.playerId !== cmd.playerId);
        if (!isHandInProgress(s)) removePlayer(s, cmd.playerId);
        break;
    }
    this.afterChange();
  }

  private nextHand() {
    this.progressScheduled = false;
    prepareNextHand(this.state);
    // Seat any waiting spectators that now fit.
    this.pending = this.pending.filter((p) => seatPlayer(this.state, p.playerId, p.name) < 0);
    startHand(this.state);
    this.afterChange();
  }

  private tickClock() {
    const s = this.state;
    if (!isHandInProgress(s) || s.toActSeat < 0 || s.actDeadline == null) return;
    if (Date.now() >= s.actDeadline) {
      const la = legalActions(s, s.toActSeat);
      if (la) {
        applyAction(s, s.toActSeat, la.canCheck ? { type: "check" } : { type: "fold" });
        this.afterChange();
      }
    }
  }

  private afterChange() {
    const s = this.state;
    // Shot clock: (re)arm whenever the acting seat changes.
    if (isHandInProgress(s) && s.toActSeat >= 0) {
      if (s.toActSeat !== this.deadlineSeat) {
        this.deadlineSeat = s.toActSeat;
        const pid = s.seats[s.toActSeat]!.playerId;
        const secs = this.connected.has(pid) ? s.config.shotClockSec : 3;
        s.actDeadline = Date.now() + secs * 1000;
      }
    } else {
      this.deadlineSeat = -1;
      s.actDeadline = null;
    }

    // Auto-advance only *between* hands (after a showdown). The very first hand
    // waits for the host to press "Deal" — see start().
    if (!this.progressScheduled && s.stage === "showdown") {
      this.progressScheduled = true;
      setTimeout(() => this.nextHand(), 5000);
    }

    this.persist();
    this.broadcast();
  }

  private persist() {
    try {
      localStorage.setItem(
        stateKey(this.roomKey),
        JSON.stringify({ state: this.state, me: this.me }),
      );
    } catch {
      /* storage full / disabled — non-fatal */
    }
  }

  private ctx(you: string, isHost: boolean) {
    return {
      you,
      isHost,
      hostName: this.me.name,
      connected: this.connected,
      spectatorCount: this.pending.length,
    };
  }

  private broadcast() {
    if (this.viewCb) this.viewCb(viewFor(this.state, this.ctx(this.me.playerId, true)));
    for (const [peerId, pid] of this.peerToPlayer) {
      this.sendState(viewFor(this.state, this.ctx(pid, false)), peerId);
    }
  }
}

// --- Guest -----------------------------------------------------------------

class GuestClient implements Client {
  readonly isHost = false;
  private room: Room;
  private sendCmd: (c: Command) => void;
  private viewCb: ((v: ClientView) => void) | null = null;
  private lastView: ClientView | null = null;
  private gotView = false;
  private joinTimer: ReturnType<typeof setInterval>;

  constructor(
    readonly roomKey: string,
    private me: Identity,
  ) {
    this.room = joinRoom(ROOM_CONFIG, roomKey);
    const [sendCmd] = this.room.makeAction<any>("cmd");
    const [, getState] = this.room.makeAction<any>("st");
    this.sendCmd = (c) => void sendCmd(c);

    getState((view: ClientView) => {
      this.gotView = true;
      this.lastView = view;
      this.viewCb?.(view);
    });

    // Announce ourselves when the host (or any peer) appears, and keep retrying
    // until we receive our first view (covers host reconnect / late join).
    this.room.onPeerJoin(() => this.announce());
    this.joinTimer = setInterval(() => {
      if (!this.gotView) this.announce();
    }, 1500);
    this.announce();
  }

  private announce() {
    this.sendCmd({ t: "join", playerId: this.me.playerId, name: this.me.name });
  }

  onView(cb: (v: ClientView) => void) {
    this.viewCb = cb;
    if (this.lastView) cb(this.lastView);
  }
  act(action: PlayerAction) {
    this.sendCmd({ t: "action", playerId: this.me.playerId, action });
  }
  rebuy() {
    this.sendCmd({ t: "rebuy", playerId: this.me.playerId });
  }
  sitOut(sitOut: boolean) {
    this.sendCmd({ t: "sitOut", playerId: this.me.playerId, sitOut });
  }
  show(show: boolean) {
    this.sendCmd({ t: "show", playerId: this.me.playerId, show });
  }
  start() {
    /* host-only */
  }
  leave() {
    clearInterval(this.joinTimer);
    this.sendCmd({ t: "leave", playerId: this.me.playerId });
    void this.room.leave();
  }
}

// --- Factory ---------------------------------------------------------------

export function createHost(roomKey: string, me: Identity, config: TableConfig): Client {
  return new HostClient(roomKey, me, config);
}

/** Resume a host session from a persisted snapshot, if one exists. */
export function resumeHost(roomKey: string, me: Identity): Client | null {
  const raw = localStorage.getItem(stateKey(roomKey));
  if (!raw) return null;
  try {
    const { state } = JSON.parse(raw) as { state: GameState };
    return new HostClient(roomKey, me, state.config, state);
  } catch {
    return null;
  }
}

export function createGuest(roomKey: string, me: Identity): Client {
  return new GuestClient(roomKey, me);
}
