import { rankValue, suitOf, type Card } from "./cards";

// A hand "score" is an array: [category, ...tiebreakers], compared
// lexicographically. Higher is better. Categories:
export const CATEGORY_NAMES = [
  "High Card", // 0
  "Pair", // 1
  "Two Pair", // 2
  "Three of a Kind", // 3
  "Straight", // 4
  "Flush", // 5
  "Full House", // 6
  "Four of a Kind", // 7
  "Straight Flush", // 8
] as const;

export type HandScore = number[];

/** Evaluate exactly five cards into a comparable score. */
function eval5(cards: Card[]): HandScore {
  const ranks = cards.map(rankValue).sort((a, b) => b - a); // descending
  const suits = cards.map(suitOf);
  const isFlush = suits.every((s) => s === suits[0]);

  const uniq = [...new Set(ranks)];
  let isStraight = false;
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (ranks[0] - ranks[4] === 4) {
      isStraight = true;
      straightHigh = ranks[0];
    } else if (
      // wheel: A-2-3-4-5 (Ace plays low)
      ranks[0] === 14 &&
      ranks[1] === 5 &&
      ranks[2] === 4 &&
      ranks[3] === 3 &&
      ranks[4] === 2
    ) {
      isStraight = true;
      straightHigh = 5;
    }
  }

  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  // Groups ordered by count (desc) then rank (desc).
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const pattern = groups.map((g) => g[1]).join("");
  const gr = groups.map((g) => g[0]);

  if (isStraight && isFlush) return [8, straightHigh];
  if (pattern === "41") return [7, gr[0], gr[1]];
  if (pattern === "32") return [6, gr[0], gr[1]];
  if (isFlush) return [5, ...ranks];
  if (isStraight) return [4, straightHigh];
  if (pattern === "311") return [3, gr[0], gr[1], gr[2]];
  if (pattern === "221") return [2, gr[0], gr[1], gr[2]];
  if (pattern === "2111") return [1, gr[0], gr[1], gr[2], gr[3]];
  return [0, ...ranks];
}

/** Compare two scores. >0 if a is better, <0 if b is better, 0 if tied. */
export function compareScore(a: HandScore, b: HandScore): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Best 5-card score from 5, 6 or 7 cards. */
export function evaluate(cards: Card[]): HandScore {
  if (cards.length < 5) throw new Error("need at least 5 cards to evaluate");
  if (cards.length === 5) return eval5(cards);

  let best: HandScore | null = null;
  const n = cards.length;
  // All C(n,5) combinations.
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) {
            const score = eval5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (best === null || compareScore(score, best) > 0) best = score;
          }
  return best!;
}

export function categoryName(score: HandScore): string {
  return CATEGORY_NAMES[score[0]];
}
