// A card is encoded as a 2-char string: rank + suit.
// Ranks: 2 3 4 5 6 7 8 9 T J Q K A   Suits: c d h s
export type Suit = "c" | "d" | "h" | "s";
export type Card = string; // e.g. "As", "Td", "2c"

export const RANKS = "23456789TJQKA";
export const SUITS: Suit[] = ["c", "d", "h", "s"];

/** Numeric rank value, 2..14 (Ace high). */
export function rankValue(card: Card): number {
  return RANKS.indexOf(card[0]) + 2;
}

export function suitOf(card: Card): Suit {
  return card[1] as Suit;
}

export const SUIT_SYMBOL: Record<Suit, string> = {
  c: "♣",
  d: "♦",
  h: "♥",
  s: "♠",
};

/** Full 52-card deck in canonical order. */
export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (const r of RANKS) {
    for (const s of SUITS) {
      deck.push(r + s);
    }
  }
  return deck;
}
