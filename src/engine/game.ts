import { shuffledDeck } from "./deck";
import { awardPots, contenderSeats } from "./pots";
import type {
  GameState,
  PlayerAction,
  Seat,
  TableConfig,
} from "./types";

export const DEFAULT_LADDER: Array<[number, number]> = [
  [10, 20],
  [20, 40],
  [30, 60],
  [50, 100],
  [75, 150],
  [100, 200],
  [150, 300],
  [200, 400],
  [300, 600],
  [500, 1000],
];

export function defaultConfig(overrides: Partial<TableConfig> = {}): TableConfig {
  return {
    format: "cash",
    buyIn: 1000,
    smallBlind: 10,
    bigBlind: 20,
    blindLadder: DEFAULT_LADDER,
    shotClockSec: 45,
    maxSeats: 9,
    ...overrides,
  };
}

export function createGame(config: TableConfig): GameState {
  return {
    config,
    seats: Array.from({ length: config.maxSeats }, () => null),
    buttonSeat: -1,
    stage: "waiting",
    board: [],
    deck: [],
    currentBet: 0,
    lastRaiseSize: config.bigBlind,
    toActSeat: -1,
    handNumber: 0,
    blindLevel: 0,
    result: null,
    actDeadline: null,
  };
}

// --- Seat management -------------------------------------------------------

/** Seat a player at the first free seat (or a preferred one). Returns seat index or -1. */
export function seatPlayer(
  state: GameState,
  playerId: string,
  name: string,
  prefer?: number,
): number {
  // Reclaim an existing seat for this player id.
  const existing = state.seats.findIndex((s) => s?.playerId === playerId);
  if (existing >= 0) {
    state.seats[existing]!.name = name;
    return existing;
  }
  const order =
    prefer !== undefined && state.seats[prefer] === null
      ? [prefer]
      : state.seats.map((_, i) => i);
  for (const i of order) {
    if (state.seats[i] === null) {
      state.seats[i] = newSeat(playerId, name, state.config.buyIn);
      return i;
    }
  }
  return -1;
}

function newSeat(playerId: string, name: string, chips: number): Seat {
  return {
    playerId,
    name,
    chips,
    committedRound: 0,
    committedHand: 0,
    holeCards: null,
    status: "sittingOut",
    hasActedThisRound: false,
    sitOutNext: false,
    mucked: false,
    revealVoluntary: false,
    lastAction: "",
  };
}

export function removePlayer(state: GameState, playerId: string): void {
  const i = state.seats.findIndex((s) => s?.playerId === playerId);
  if (i >= 0) state.seats[i] = null;
}

export function setSitOut(state: GameState, playerId: string, sitOut: boolean): void {
  const seat = seatOf(state, playerId);
  if (seat) seat.sitOutNext = sitOut;
}

/** Cash-game rebuy: top a seated player back up to the buy-in. Between hands only. */
export function rebuy(state: GameState, playerId: string): boolean {
  if (state.config.format !== "cash") return false;
  if (isHandInProgress(state)) return false;
  const seat = seatOf(state, playerId);
  if (!seat) return false;
  if (seat.chips >= state.config.buyIn) return false;
  seat.chips = state.config.buyIn;
  return true;
}

// --- Blinds ----------------------------------------------------------------

export function currentBlinds(state: GameState): { sb: number; bb: number } {
  const { format, blindLadder, smallBlind, bigBlind } = state.config;
  if (format === "tournament" && blindLadder.length > 0) {
    const lvl = Math.min(state.blindLevel, blindLadder.length - 1);
    return { sb: blindLadder[lvl][0], bb: blindLadder[lvl][1] };
  }
  return { sb: smallBlind, bb: bigBlind };
}

// --- Hand lifecycle --------------------------------------------------------

/**
 * Prepare for the next hand: eliminate busted players (tournament) and escalate
 * blinds one level per elimination. Cash-game broke players stay seated to rebuy.
 * Returns the number of eliminations.
 */
export function prepareNextHand(state: GameState): number {
  let eliminated = 0;
  if (state.config.format === "tournament") {
    state.seats.forEach((seat, i) => {
      if (seat && seat.chips <= 0) {
        state.seats[i] = null;
        eliminated++;
      }
    });
    if (eliminated > 0) {
      state.blindLevel = Math.min(
        state.blindLevel + eliminated,
        state.config.blindLadder.length - 1,
      );
    }
  }
  state.result = null;
  return eliminated;
}

/** Seats eligible to be dealt into a hand. */
function eligibleSeats(state: GameState): number[] {
  const out: number[] = [];
  state.seats.forEach((seat, i) => {
    if (seat && seat.chips > 0 && !seat.sitOutNext) out.push(i);
  });
  return out;
}

/** True once the tournament has a single player with chips (a winner). */
export function tournamentWinner(state: GameState): number | null {
  if (state.config.format !== "tournament") return null;
  const withChips = state.seats
    .map((s, i) => (s && s.chips > 0 ? i : -1))
    .filter((i) => i >= 0);
  const seated = state.seats.filter((s) => s !== null).length;
  return seated >= 2 && withChips.length === 1 ? withChips[0] : null;
}

/**
 * Start a new hand. Returns false (and sets stage 'waiting') if fewer than two
 * eligible players. Shuffles with the provided rng (default Math.random).
 */
export function startHand(state: GameState, rng: () => number = Math.random): boolean {
  const eligible = eligibleSeats(state);
  if (eligible.length < 2) {
    state.stage = "waiting";
    state.toActSeat = -1;
    return false;
  }

  const n = state.config.maxSeats;
  state.handNumber++;
  state.board = [];
  state.deck = shuffledDeck(rng);
  state.currentBet = 0;
  state.result = null;
  state.actDeadline = null;

  // Move the button to the next eligible seat.
  state.buttonSeat =
    state.buttonSeat < 0 ? eligible[0] : nextSeatWhere(state, state.buttonSeat, isEligible);

  // Reset all seats; deal the eligible ones in.
  for (const seat of state.seats) {
    if (!seat) continue;
    seat.committedRound = 0;
    seat.committedHand = 0;
    seat.hasActedThisRound = false;
    seat.mucked = false;
    seat.revealVoluntary = false;
    seat.lastAction = "";
    seat.holeCards = null;
    seat.status = "sittingOut";
  }
  for (const i of eligible) {
    const seat = state.seats[i]!;
    seat.status = "active";
    seat.holeCards = [state.deck.pop()!, state.deck.pop()!];
  }

  // Blinds & first actor.
  const { sb, bb } = currentBlinds(state);
  let sbSeat: number, bbSeat: number, firstToAct: number;
  if (eligible.length === 2) {
    // Heads-up: button is SB and acts first pre-flop.
    sbSeat = state.buttonSeat;
    bbSeat = nextSeatWhere(state, state.buttonSeat, isDealt);
    firstToAct = state.buttonSeat;
  } else {
    sbSeat = nextSeatWhere(state, state.buttonSeat, isDealt);
    bbSeat = nextSeatWhere(state, sbSeat, isDealt);
    firstToAct = nextSeatWhere(state, bbSeat, isDealt);
  }

  commit(state.seats[sbSeat]!, sb);
  commit(state.seats[bbSeat]!, bb);
  state.seats[sbSeat]!.lastAction = "SB";
  state.seats[bbSeat]!.lastAction = "BB";
  state.currentBet = Math.max(
    state.seats[sbSeat]!.committedRound,
    state.seats[bbSeat]!.committedRound,
  );
  state.lastRaiseSize = bb;
  state.stage = "preflop";
  void n;

  state.toActSeat = nextActorFrom(state, firstToAct);
  if (state.toActSeat === -1) resolveRunout(state);
  return true;
}

// --- Actions ---------------------------------------------------------------

export interface LegalActions {
  toCall: number; // chips needed to call
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  canRaise: boolean;
  minRaiseTo: number; // total committedRound target for a min raise
  maxRaiseTo: number; // all-in target
}

export function legalActions(state: GameState, seatIndex: number): LegalActions | null {
  const seat = state.seats[seatIndex];
  if (!seat || seat.status !== "active" || state.toActSeat !== seatIndex) return null;
  const toCall = Math.max(0, state.currentBet - seat.committedRound);
  const maxRaiseTo = seat.committedRound + seat.chips;
  const minRaiseTo = Math.min(state.currentBet + state.lastRaiseSize, maxRaiseTo);
  return {
    toCall: Math.min(toCall, seat.chips),
    canFold: true,
    canCheck: toCall === 0,
    canCall: toCall > 0 && seat.chips > 0,
    canRaise: seat.chips > toCall, // has chips beyond a call
    minRaiseTo,
    maxRaiseTo,
  };
}

/** Apply a validated action for the seat whose turn it is. Returns true if applied. */
export function applyAction(
  state: GameState,
  seatIndex: number,
  action: PlayerAction,
): boolean {
  if (state.toActSeat !== seatIndex) return false;
  const seat = state.seats[seatIndex];
  if (!seat || seat.status !== "active") return false;

  const toCall = Math.max(0, state.currentBet - seat.committedRound);

  switch (action.type) {
    case "fold":
      seat.status = "folded";
      seat.hasActedThisRound = true;
      seat.lastAction = "Fold";
      break;

    case "check":
      if (toCall !== 0) return false;
      seat.hasActedThisRound = true;
      seat.lastAction = "Check";
      break;

    case "call": {
      if (toCall === 0) {
        // Treat as check.
        seat.hasActedThisRound = true;
        seat.lastAction = "Check";
        break;
      }
      commit(seat, toCall);
      seat.hasActedThisRound = true;
      seat.lastAction = seat.chips === 0 ? "All-in" : "Call";
      break;
    }

    case "raise": {
      const target = action.to;
      const maxTo = seat.committedRound + seat.chips;
      if (target <= state.currentBet) return false; // must exceed current bet
      if (target > maxTo) return false; // can't wager more than the stack
      const isAllIn = target === maxTo;
      const raiseSize = target - state.currentBet;
      if (raiseSize < state.lastRaiseSize && !isAllIn) return false; // below min-raise

      const prevBet = state.currentBet;
      commit(seat, target - seat.committedRound);
      state.currentBet = target;
      seat.hasActedThisRound = true;
      seat.lastAction = isAllIn ? "All-in" : prevBet === 0 ? "Bet" : "Raise";

      if (raiseSize >= state.lastRaiseSize) {
        // Full raise reopens the betting.
        state.lastRaiseSize = target - prevBet;
        for (const s of state.seats) {
          if (s && s.status === "active" && s !== seat) s.hasActedThisRound = false;
        }
      }
      // A short all-in does not reopen action for players who already acted.
      break;
    }
  }

  advance(state, seatIndex);
  return true;
}

function advance(state: GameState, fromSeat: number): void {
  if (contenderSeats(state).length <= 1) {
    resolve(state);
    return;
  }
  if (roundOver(state)) {
    closeRound(state);
    return;
  }
  const n = state.config.maxSeats;
  state.toActSeat = nextActorFrom(state, (fromSeat + 1) % n);
  if (state.toActSeat === -1) closeRound(state);
}

function closeRound(state: GameState): void {
  const canStillAct = contenderSeats(state).filter(
    (i) => state.seats[i]!.status === "active" && state.seats[i]!.chips > 0,
  );
  if (canStillAct.length <= 1) {
    resolveRunout(state);
    return;
  }
  if (state.stage === "river") {
    resolve(state);
    return;
  }
  nextStreet(state);
}

function nextStreet(state: GameState): void {
  for (const seat of state.seats) {
    if (seat && seat.status === "active") {
      seat.committedRound = 0;
      seat.hasActedThisRound = false;
      seat.lastAction = "";
    }
  }
  state.currentBet = 0;
  state.lastRaiseSize = currentBlinds(state).bb;
  dealStreet(state);

  const n = state.config.maxSeats;
  state.toActSeat = nextActorFrom(state, (state.buttonSeat + 1) % n);
  if (state.toActSeat === -1) {
    // Everyone remaining is all-in: run the board out.
    if (state.stage === "river") resolve(state);
    else nextStreet(state);
  }
}

/** Deal the next community cards based on how many are already out. */
function dealStreet(state: GameState): void {
  if (state.board.length === 0) {
    state.board.push(state.deck.pop()!, state.deck.pop()!, state.deck.pop()!);
    state.stage = "flop";
  } else if (state.board.length === 3) {
    state.board.push(state.deck.pop()!);
    state.stage = "turn";
  } else if (state.board.length === 4) {
    state.board.push(state.deck.pop()!);
    state.stage = "river";
  }
}

/** No more betting possible: deal any remaining board cards, then showdown. */
function resolveRunout(state: GameState): void {
  while (state.board.length < 5) {
    if (state.board.length === 0) {
      state.board.push(state.deck.pop()!, state.deck.pop()!, state.deck.pop()!);
    } else {
      state.board.push(state.deck.pop()!);
    }
  }
  resolve(state);
}

function resolve(state: GameState): void {
  state.result = awardPots(state);
  state.stage = "showdown";
  state.toActSeat = -1;
  state.actDeadline = null;
}

// --- Muck / show at showdown ----------------------------------------------

export function muck(state: GameState, playerId: string): void {
  const seat = seatOf(state, playerId);
  if (seat && state.stage === "showdown") seat.mucked = true;
}

/** Winner of an uncalled pot voluntarily reveals their cards (display only). */
export function showCards(state: GameState, playerId: string): void {
  const seat = seatOf(state, playerId);
  if (seat && state.stage === "showdown") seat.revealVoluntary = true;
}

// --- Helpers ---------------------------------------------------------------

function commit(seat: Seat, amount: number): void {
  const a = Math.min(amount, seat.chips);
  seat.chips -= a;
  seat.committedRound += a;
  seat.committedHand += a;
  if (seat.chips === 0 && seat.status === "active") seat.status = "allin";
}

function seatOf(state: GameState, playerId: string): Seat | null {
  return state.seats.find((s) => s?.playerId === playerId) ?? null;
}

export function isHandInProgress(state: GameState): boolean {
  return (
    state.stage === "preflop" ||
    state.stage === "flop" ||
    state.stage === "turn" ||
    state.stage === "river"
  );
}

/** A seat still owes action this round. */
function needsAction(state: GameState, seat: Seat): boolean {
  return (
    seat.status === "active" &&
    seat.chips > 0 &&
    (!seat.hasActedThisRound || seat.committedRound < state.currentBet)
  );
}

function roundOver(state: GameState): boolean {
  return !state.seats.some((seat) => seat && needsAction(state, seat));
}

/** First seat at/after `start` (clockwise) that needs to act, else -1. */
function nextActorFrom(state: GameState, start: number): number {
  const n = state.config.maxSeats;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    const seat = state.seats[i];
    if (seat && needsAction(state, seat)) return i;
  }
  return -1;
}

/** First seat strictly after `from` (clockwise) matching pred. */
function nextSeatWhere(
  state: GameState,
  from: number,
  pred: (seat: Seat) => boolean,
): number {
  const n = state.config.maxSeats;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    const seat = state.seats[i];
    if (seat && pred(seat)) return i;
  }
  return from;
}

const isEligible = (s: Seat) => s.chips > 0 && !s.sitOutNext;
const isDealt = (s: Seat) => s.status === "active" || s.status === "allin";
