import type { Card } from "./cards";
import type { HandScore } from "./evaluator";

export type Format = "cash" | "tournament";

export interface TableConfig {
  format: Format;
  /** Starting stack (cash buy-in / tournament starting chips). */
  buyIn: number;
  smallBlind: number;
  bigBlind: number;
  /** Tournament blind ladder as [sb, bb] levels; index advances one per elimination. */
  blindLadder: Array<[number, number]>;
  shotClockSec: number;
  maxSeats: number;
}

export type SeatStatus =
  | "empty"
  | "active" // in the hand, can act
  | "folded" // out of this hand
  | "allin" // in the hand, no chips left to act
  | "sittingOut"; // seated but not dealt in

export interface Seat {
  playerId: string; // persistent id
  name: string;
  chips: number; // stack not yet committed this hand
  committedRound: number; // chips put in during the current betting round
  committedHand: number; // total chips put in this hand (drives side pots)
  holeCards: [Card, Card] | null; // host-only secret; redacted for others
  status: SeatStatus;
  hasActedThisRound: boolean;
  /** Player asked to sit out at the next hand boundary. */
  sitOutNext: boolean;
  /** Whether this player mucked at showdown (display only). */
  mucked: boolean;
  /** Winner of an uncalled pot chose to voluntarily reveal (display only). */
  revealVoluntary: boolean;
  /** Short label of this player's most recent action, e.g. "Raise", "Call". */
  lastAction: string;
}

export type Stage =
  | "waiting" // not enough players / between sessions
  | "preflop"
  | "flop"
  | "turn"
  | "river"
  | "showdown" // hand resolved; results populated; pause before next
  | "handComplete";

export type PlayerAction =
  | { type: "fold" }
  | { type: "check" }
  | { type: "call" }
  /** Raise (or bet) so this player's total committed *this round* becomes `to`. */
  | { type: "raise"; to: number };

export interface PotResult {
  amount: number;
  winners: number[]; // seat indices sharing this pot
}

export interface SeatShowdown {
  score: HandScore;
  /** The best five cards, for highlighting. */
  best: Card[];
}

export interface HandResult {
  pots: PotResult[];
  /** seat index -> chips won this hand. */
  payouts: Record<number, number>;
  /** seat index -> evaluated hand, for reveal (only contenders at showdown). */
  showdown: Record<number, SeatShowdown>;
  wentToShowdown: boolean;
}

export interface GameState {
  config: TableConfig;
  seats: Array<Seat | null>; // length config.maxSeats
  buttonSeat: number; // dealer button seat index (-1 before first hand)
  stage: Stage;
  board: Card[];
  deck: Card[]; // remaining deck (host secret)
  currentBet: number; // highest committedRound this round
  lastRaiseSize: number; // size of the last full bet/raise (for min-raise)
  toActSeat: number; // whose turn, or -1
  handNumber: number;
  blindLevel: number; // index into blindLadder (tournament)
  result: HandResult | null; // populated at showdown
  /** Deadline (ms epoch) for the current actor's shot clock, set by host. */
  actDeadline: number | null;
}
