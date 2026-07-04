import type { Card } from "./cards";
import { compareScore, evaluate, type HandScore } from "./evaluator";
import type { GameState, HandResult, PotResult, SeatShowdown } from "./types";

export interface Contribution {
  seat: number;
  amount: number;
  folded: boolean;
}

/** A pot layer: chips plus the seats eligible to win them. */
export interface Pot {
  amount: number;
  /** Non-folded seats that contributed to this layer. */
  eligible: number[];
}

/**
 * Layer contributions into main + side pots. Folded players' chips still form
 * dead money in the pots they contributed to, but they are not eligible to win.
 * A layer whose eligible set is empty (everyone at that level folded) rolls its
 * chips forward into the next pot. Adjacent layers with identical eligible sets
 * are merged.
 */
export function buildPots(contribs: Contribution[]): Pot[] {
  const remaining = contribs.filter((c) => c.amount > 0).map((c) => ({ ...c }));
  const layers: Pot[] = [];

  while (remaining.length > 0) {
    const level = Math.min(...remaining.map((c) => c.amount));
    let amount = 0;
    const eligible: number[] = [];
    for (const c of remaining) {
      amount += level;
      c.amount -= level;
      if (!c.folded) eligible.push(c.seat);
    }
    layers.push({ amount, eligible });
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (remaining[i].amount === 0) remaining.splice(i, 1);
    }
  }

  const merged: Pot[] = [];
  let carry = 0;
  for (const layer of layers) {
    if (layer.eligible.length === 0) {
      carry += layer.amount;
      continue;
    }
    const amount = layer.amount + carry;
    carry = 0;
    const prev = merged[merged.length - 1];
    if (prev && sameSet(prev.eligible, layer.eligible)) {
      prev.amount += amount;
    } else {
      merged.push({ amount, eligible: [...layer.eligible] });
    }
  }
  if (carry > 0 && merged.length > 0) merged[merged.length - 1].amount += carry;

  return merged;
}

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

/** Seats still in the hand (not folded/empty), i.e. eligible to win something. */
export function contenderSeats(state: GameState): number[] {
  const out: number[] = [];
  state.seats.forEach((seat, i) => {
    if (seat && (seat.status === "active" || seat.status === "allin")) out.push(i);
  });
  return out;
}

/**
 * Resolve the hand: build pots, evaluate contenders, award chips (odd chips to
 * the first eligible winner left of the button). Mutates seat stacks with
 * winnings and returns a HandResult for display.
 */
export function awardPots(state: GameState): HandResult {
  const contribs: Contribution[] = [];
  state.seats.forEach((seat, i) => {
    if (seat && seat.committedHand > 0) {
      contribs.push({
        seat: i,
        amount: seat.committedHand,
        folded: seat.status === "folded",
      });
    }
  });

  const pots = buildPots(contribs);
  const contenders = contenderSeats(state);
  const wentToShowdown = contenders.length > 1;

  // Only a real showdown (2+ contenders) needs hand evaluation — and only then is
  // the board guaranteed complete. An uncalled win goes to the sole contender.
  const showdown: Record<number, SeatShowdown> = {};
  const scores = new Map<number, HandScore>();
  if (wentToShowdown) {
    for (const i of contenders) {
      const seat = state.seats[i]!;
      if (!seat.holeCards) continue;
      const { score, best } = bestOf([...seat.holeCards, ...state.board]);
      scores.set(i, score);
      showdown[i] = { score, best };
    }
  }

  const payouts: Record<number, number> = {};
  const resultPots: PotResult[] = [];

  for (const pot of pots) {
    // Only contenders that are eligible for this specific layer can win it.
    const eligible = pot.eligible.filter((i) => contenders.includes(i));
    let winners: number[];
    if (eligible.length <= 1) {
      // Sole eligible player (uncalled pot or an uncontested side pot) — no eval.
      winners = eligible;
    } else {
      let bestScore: HandScore | null = null;
      winners = [];
      for (const i of eligible) {
        const sc = scores.get(i);
        if (!sc) continue;
        const cmp = bestScore === null ? 1 : compareScore(sc, bestScore);
        if (cmp > 0) {
          bestScore = sc;
          winners = [i];
        } else if (cmp === 0) {
          winners.push(i);
        }
      }
    }
    distribute(state, pot.amount, winners, payouts);
    resultPots.push({ amount: pot.amount, winners });
  }

  for (const [seatStr, amount] of Object.entries(payouts)) {
    state.seats[Number(seatStr)]!.chips += amount;
  }

  return { pots: resultPots, payouts, showdown, wentToShowdown };
}

/** Split `amount` among winners; odd chips go to first winner left of the button. */
function distribute(
  state: GameState,
  amount: number,
  winners: number[],
  payouts: Record<number, number>,
): void {
  if (winners.length === 0 || amount === 0) return;
  const share = Math.floor(amount / winners.length);
  const remainder = amount - share * winners.length;
  for (const w of winners) payouts[w] = (payouts[w] ?? 0) + share;

  const ordered = seatsLeftOfButton(state, winners);
  for (let i = 0; i < remainder; i++) {
    const w = ordered[i % ordered.length];
    payouts[w] = (payouts[w] ?? 0) + 1;
  }
}

/** Order seats clockwise starting just left of the button. */
function seatsLeftOfButton(state: GameState, seats: number[]): number[] {
  const n = state.config.maxSeats;
  const start = (state.buttonSeat + 1) % n;
  return [...seats].sort((a, b) => ((a - start + n) % n) - ((b - start + n) % n));
}

/** Best 5-card hand out of 5-7, returning both score and the winning cards. */
export function bestOf(cards: Card[]): { score: HandScore; best: Card[] } {
  let bestScore: HandScore | null = null;
  let bestCards: Card[] = [];
  const n = cards.length;
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) {
            const combo = [cards[a], cards[b], cards[c], cards[d], cards[e]];
            const score = evaluate(combo);
            if (bestScore === null || compareScore(score, bestScore) > 0) {
              bestScore = score;
              bestCards = combo;
            }
          }
  return { score: bestScore!, best: bestCards };
}
