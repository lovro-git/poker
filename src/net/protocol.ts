import type { Card } from "../engine/cards";
import { currentBlinds, tournamentWinner } from "../engine/game";
import type {
  GameState,
  HandResult,
  PlayerAction,
  SeatStatus,
  Stage,
  TableConfig,
} from "../engine/types";

/** Trystero app namespace. Bump to invalidate incompatible old clients. */
export const APP_ID = "p2p-holdem-v1";

// --- Commands: peer -> host -----------------------------------------------

export type Command =
  | { t: "join"; playerId: string; name: string }
  | { t: "action"; playerId: string; action: PlayerAction }
  | { t: "rebuy"; playerId: string }
  | { t: "sitOut"; playerId: string; sitOut: boolean }
  | { t: "show"; playerId: string; show: boolean } // show=false => muck
  | { t: "leave"; playerId: string };

// --- View: host -> peer (redacted) ----------------------------------------

export interface PublicSeat {
  playerId: string;
  name: string;
  chips: number;
  committedRound: number;
  committedHand: number;
  status: SeatStatus;
  /** Only present for the receiving player, or revealed cards at showdown. */
  holeCards: [Card, Card] | null;
  mucked: boolean;
  revealVoluntary: boolean;
  sitOutNext: boolean;
  connected: boolean;
  isButton: boolean;
  waitingToPlay: boolean; // seated but not dealt into the current hand
}

export interface ClientView {
  you: string;
  yourSeat: number; // -1 if spectator
  isHost: boolean;
  hostName: string;
  config: TableConfig;
  stage: Stage;
  board: Card[];
  pot: number;
  currentBet: number;
  toActSeat: number;
  handNumber: number;
  smallBlind: number;
  bigBlind: number;
  lastRaiseSize: number;
  seats: Array<PublicSeat | null>;
  result: HandResult | null;
  actDeadline: number | null;
  spectatorCount: number;
  tournamentWinner: number | null;
}

export interface ViewContext {
  you: string; // the player id this view is for
  isHost: boolean;
  hostName: string;
  connected: Set<string>;
  spectatorCount: number;
}

function isContender(status: SeatStatus): boolean {
  return status === "active" || status === "allin";
}

/** Should `seat`'s hole cards be visible to `you`? */
function revealTo(state: GameState, seatPlayerId: string, ctx: ViewContext): boolean {
  const seat = state.seats.find((s) => s?.playerId === seatPlayerId);
  if (!seat || !seat.holeCards) return false;
  if (seat.playerId === ctx.you) return true; // always see your own
  if (state.stage !== "showdown" || !state.result) return false;
  if (state.result.wentToShowdown) {
    return isContender(seat.status) && !seat.mucked;
  }
  // Uncalled win: only if the winner chose to show.
  return isContender(seat.status) && seat.revealVoluntary;
}

/** Build the redacted view a specific player is allowed to see. */
export function viewFor(state: GameState, ctx: ViewContext): ClientView {
  const { sb, bb } = currentBlinds(state);
  const pot = state.seats.reduce((sum, s) => sum + (s?.committedHand ?? 0), 0);

  const seats = state.seats.map<PublicSeat | null>((seat) => {
    if (!seat) return null;
    const dealt = isContender(seat.status) || seat.status === "folded";
    return {
      playerId: seat.playerId,
      name: seat.name,
      chips: seat.chips,
      committedRound: seat.committedRound,
      committedHand: seat.committedHand,
      status: seat.status,
      holeCards: revealTo(state, seat.playerId, ctx) ? seat.holeCards : null,
      mucked: seat.mucked,
      revealVoluntary: seat.revealVoluntary,
      sitOutNext: seat.sitOutNext,
      connected: ctx.connected.has(seat.playerId),
      isButton: false, // set below
      waitingToPlay: !dealt && seat.chips > 0 && !seat.sitOutNext,
    };
  });
  if (state.buttonSeat >= 0 && seats[state.buttonSeat]) {
    seats[state.buttonSeat]!.isButton = true;
  }

  const yourSeat = state.seats.findIndex((s) => s?.playerId === ctx.you);

  return {
    you: ctx.you,
    yourSeat,
    isHost: ctx.isHost,
    hostName: ctx.hostName,
    config: state.config,
    stage: state.stage,
    board: state.board,
    pot,
    currentBet: state.currentBet,
    toActSeat: state.toActSeat,
    handNumber: state.handNumber,
    smallBlind: sb,
    bigBlind: bb,
    lastRaiseSize: state.lastRaiseSize,
    seats,
    result: state.result,
    actDeadline: state.actDeadline,
    spectatorCount: ctx.spectatorCount,
    tournamentWinner: tournamentWinner(state),
  };
}
