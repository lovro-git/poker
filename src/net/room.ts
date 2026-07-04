import mqtt, { type MqttClient } from "mqtt";
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
  setAfk,
  setSitOut,
  showCards,
  startHand,
} from "../engine/game";
import type { GameState, PlayerAction, TableConfig } from "../engine/types";
import { viewFor, type ClientView, type Command } from "./protocol";

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

// A public MQTT broker over secure WebSocket. Both host and guest must use the
// same broker to meet — this relays all messages through the cloud, so it works
// across any networks (mobile data included) with no accounts and no WebRTC/TURN.
const BROKER = "wss://broker.emqx.io:8084/mqtt";
const HEARTBEAT_MS = 3000;
const PRESENCE_TIMEOUT_MS = 9000;

const cmdTopic = (room: string) => `hxq/${room}/c`;
const stateTopic = (room: string, playerId: string) => `hxq/${room}/s/${playerId}`;
const stateKey = (roomKey: string) => `holdem:host:${roomKey}`;

function connect(): MqttClient {
  return mqtt.connect(BROKER, {
    clean: true,
    keepalive: 30,
    reconnectPeriod: 2000,
    connectTimeout: 10000,
  });
}

function decode(payload: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return null;
  }
}

// --- Host ------------------------------------------------------------------

class HostClient implements Client {
  readonly isHost = true;
  private conn: MqttClient;
  private state: GameState;
  private known = new Set<string>(); // every player id we've published state to
  private connected = new Set<string>();
  private lastSeen = new Map<string, number>();
  private pending: Identity[] = []; // spectators waiting for a seat
  private viewCb: ((v: ClientView) => void) | null = null;
  private progressScheduled = false;
  private deadlineSeat = -1;
  private clock: ReturnType<typeof setInterval>;
  private presence: ReturnType<typeof setInterval>;

  constructor(
    readonly roomKey: string,
    private me: Identity,
    config: TableConfig,
    resume?: GameState,
  ) {
    this.state = resume ?? createGame(config);
    if (!resume) seatPlayer(this.state, me.playerId, me.name, 0);
    this.connected.add(me.playerId);

    this.conn = connect();
    this.conn.on("connect", () => this.conn.subscribe(cmdTopic(roomKey)));
    this.conn.on("message", (topic, payload) => {
      if (topic !== cmdTopic(roomKey)) return;
      const cmd = decode(payload) as Command | null;
      if (cmd) this.onCmd(cmd);
    });

    this.clock = setInterval(() => this.tickClock(), 300);
    this.presence = setInterval(() => this.prunePresence(), 2500);
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
    clearInterval(this.presence);
    localStorage.removeItem(stateKey(this.roomKey));
    void this.conn.end(true);
  }

  private onCmd(cmd: Command) {
    if (cmd.t === "ping") {
      this.lastSeen.set(cmd.playerId, Date.now());
      if (!this.connected.has(cmd.playerId)) {
        this.connected.add(cmd.playerId);
        this.afterChange();
      }
      return;
    }
    if (cmd.t === "join") {
      this.known.add(cmd.playerId);
      this.lastSeen.set(cmd.playerId, Date.now());
    }
    this.handle(cmd);
  }

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
      case "ping":
        return;
    }
    this.afterChange();
  }

  private nextHand() {
    this.progressScheduled = false;
    prepareNextHand(this.state);
    this.pending = this.pending.filter((p) => seatPlayer(this.state, p.playerId, p.name) < 0);
    startHand(this.state);
    this.afterChange();
  }

  private tickClock() {
    const s = this.state;
    if (!isHandInProgress(s) || s.toActSeat < 0 || s.actDeadline == null) return;
    if (Date.now() >= s.actDeadline) {
      const seatIdx = s.toActSeat;
      const la = legalActions(s, seatIdx);
      if (la) {
        applyAction(s, seatIdx, la.canCheck ? { type: "check" } : { type: "fold" });
        setAfk(s, seatIdx);
        this.afterChange();
      }
    }
  }

  private prunePresence() {
    const cutoff = Date.now() - PRESENCE_TIMEOUT_MS;
    let changed = false;
    for (const pid of this.connected) {
      if (pid === this.me.playerId) continue;
      if ((this.lastSeen.get(pid) ?? 0) < cutoff) {
        this.connected.delete(pid);
        changed = true;
      }
    }
    if (changed) this.afterChange();
  }

  private afterChange() {
    const s = this.state;
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
    if (!this.conn.connected) return;
    for (const pid of this.known) {
      this.conn.publish(stateTopic(this.roomKey, pid), JSON.stringify(viewFor(this.state, this.ctx(pid, false))));
    }
  }
}

// --- Guest -----------------------------------------------------------------

class GuestClient implements Client {
  readonly isHost = false;
  private conn: MqttClient;
  private viewCb: ((v: ClientView) => void) | null = null;
  private lastView: ClientView | null = null;
  private gotView = false;
  private beat: ReturnType<typeof setInterval>;

  constructor(
    readonly roomKey: string,
    private me: Identity,
  ) {
    this.conn = connect();
    this.conn.on("connect", () => {
      this.conn.subscribe(stateTopic(roomKey, me.playerId));
      this.announce(); // (re)announce on connect and reconnect
    });
    this.conn.on("message", (topic, payload) => {
      if (topic !== stateTopic(roomKey, me.playerId)) return;
      const view = decode(payload) as ClientView | null;
      if (!view) return;
      this.gotView = true;
      this.lastView = view;
      this.viewCb?.(view);
    });

    // Heartbeat: keep re-announcing until we're in, then just ping for presence.
    this.beat = setInterval(() => {
      if (this.gotView) this.pub({ t: "ping", playerId: this.me.playerId });
      else this.announce();
    }, HEARTBEAT_MS);
  }

  private pub(cmd: Command) {
    if (this.conn.connected) this.conn.publish(cmdTopic(this.roomKey), JSON.stringify(cmd));
  }
  private announce() {
    this.pub({ t: "join", playerId: this.me.playerId, name: this.me.name });
  }

  onView(cb: (v: ClientView) => void) {
    this.viewCb = cb;
    if (this.lastView) cb(this.lastView);
  }
  act(action: PlayerAction) {
    this.pub({ t: "action", playerId: this.me.playerId, action });
  }
  rebuy() {
    this.pub({ t: "rebuy", playerId: this.me.playerId });
  }
  sitOut(sitOut: boolean) {
    this.pub({ t: "sitOut", playerId: this.me.playerId, sitOut });
  }
  show(show: boolean) {
    this.pub({ t: "show", playerId: this.me.playerId, show });
  }
  start() {
    /* host-only */
  }
  leave() {
    clearInterval(this.beat);
    this.pub({ t: "leave", playerId: this.me.playerId });
    void this.conn.end(true);
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
