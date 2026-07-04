import { rankValue, suitOf, type Card, type Suit } from "../engine/cards";
import { h, icon } from "./dom";

const RANK_LABEL: Record<number, string> = { 14: "A", 13: "K", 12: "Q", 11: "J", 10: "10" };
const SUIT_FA: Record<Suit, string> = { c: "club", d: "diamond", h: "heart", s: "spade" };

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
  anim?: boolean; // play the deal-in animation (only for genuinely new cards)
}

/** Build a single playing-card element. */
export function cardEl(card: Card | null, opts: CardOpts = {}): HTMLElement {
  const size = opts.big ? "card--big" : opts.small ? "card--sm" : "";
  const anim = opts.anim ? "card--deal" : "";
  if (opts.slot) {
    return h("div", { class: `card card--slot ${size}`.trim() });
  }
  if (!card || opts.faceDown) {
    return h("div", { class: `card card--back ${size} ${anim}`.trim() }, h("div", { class: "card-weave" }));
  }
  const suit = suitOf(card);
  const red = suit === "h" || suit === "d";
  const cls = `card ${red ? "card--red" : "card--black"} ${size} ${anim} ${opts.dim ? "is-dim" : ""}`;
  return h(
    "div",
    { class: cls.trim() },
    h("div", { class: "card-corner" },
      h("span", { class: "card-rank" }, rankLabel(card)),
      h("span", { class: "card-csuit" }, icon(SUIT_FA[suit])),
    ),
    !opts.small && h("div", { class: "card-pip" }, icon(SUIT_FA[suit])),
  );
}

/** A face-down card that flips to reveal `card` when its container gets .revealed. */
export function flipCard(card: Card, opts: CardOpts = {}): HTMLElement {
  const back = cardEl(null, { ...opts, faceDown: true });
  back.classList.add("flip-back");
  const face = cardEl(card, opts);
  face.classList.add("flip-face");
  return h("div", { class: `flip${opts.big ? " flip--big" : ""}` }, h("div", { class: "flip-inner" }, back, face));
}

/** A small chip-stack badge showing an amount (bets and the pot). */
export function chipBadge(amount: number, cls = ""): HTMLElement {
  return h(
    "div",
    { class: `chipbadge ${cls}`.trim() },
    icon("coins"),
    h("span", { class: "chipbadge-amt tnum" }, amount.toLocaleString("en-US")),
  );
}
