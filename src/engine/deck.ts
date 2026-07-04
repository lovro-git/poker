import { fullDeck, type Card } from "./cards";

/**
 * Fisher-Yates shuffle. Accepts an injectable RNG so the host can shuffle
 * deterministically in tests; defaults to Math.random for live play.
 */
export function shuffledDeck(rng: () => number = Math.random): Card[] {
  const deck = fullDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
