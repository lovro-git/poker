import { rankValue, suitOf, SUIT_SYMBOL, type Card } from "../engine/cards";
import { h } from "./dom";

const RANK_LABEL: Record<number, string> = { 14: "A", 13: "K", 12: "Q", 11: "J", 10: "10" };

function rankLabel(card: Card): string {
  const v = rankValue(card);
  return RANK_LABEL[v] ?? String(v);
}

export interface CardOpts {
  faceDown?: boolean;
  small?: boolean;
  big?: boolean;
  dim?: boolean; // not part of the winning five
  slot?: boolean; // empty placeholder outline
}

/** Build a single playing-card element. */
export function cardEl(card: Card | null, opts: CardOpts = {}): HTMLElement {
  const size = opts.big ? "card--big" : opts.small ? "card--sm" : "";
  if (opts.slot) {
    return h("div", { class: `card card--slot ${size}`.trim() });
  }
  if (!card || opts.faceDown) {
    return h("div", { class: `card card--back ${size}`.trim() }, h("div", { class: "card-weave" }));
  }
  const suit = suitOf(card);
  const red = suit === "h" || suit === "d";
  const cls = `card ${red ? "card--red" : "card--black"} ${size} ${opts.dim ? "is-dim" : ""}`;
  return h(
    "div",
    { class: cls.trim() },
    h("div", { class: "card-corner" },
      h("span", { class: "card-rank" }, rankLabel(card)),
      h("span", { class: "card-csuit" }, SUIT_SYMBOL[suit]),
    ),
    !opts.small && h("div", { class: "card-pip" }, SUIT_SYMBOL[suit]),
  );
}

/** A small chip-stack badge showing an amount (bets and the pot). */
export function chipBadge(amount: number, cls = ""): HTMLElement {
  return h(
    "div",
    { class: `chipbadge ${cls}`.trim() },
    h("span", { class: "chipbadge-dot" }),
    h("span", { class: "chipbadge-amt tnum" }, amount.toLocaleString("en-US")),
  );
}
