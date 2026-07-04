import { rankValue, suitOf, type Card, type Suit } from "../engine/cards";
import { h } from "./dom";

const RANK_LABEL: Record<number, string> = { 14: "A", 13: "K", 12: "Q", 11: "J", 10: "10" };

// Inline SVG suit paths — Font Awesome Free lacks club/spade, so we draw our own.
const SUIT_PATH: Record<Suit, string> = {
  h: "M12 20.5C6.5 16 3 12.9 3 9.1 3 6.3 5.2 4 8 4c1.7 0 3.2.9 4 2.2C12.8 4.9 14.3 4 16 4c2.8 0 5 2.3 5 5.1 0 3.8-3.5 6.9-9 11.4z",
  d: "M12 3l6.5 9L12 21 5.5 12z",
  s: "M12 3C8.5 7.2 4.5 9.8 4.5 13.6c0 2.2 1.7 3.9 3.9 3.9 1 0 1.9-.4 2.6-1-.1 1.9-1 3.4-2.6 4.5h7.2c-1.6-1.1-2.5-2.6-2.6-4.5.7.6 1.6 1 2.6 1 2.2 0 3.9-1.7 3.9-3.9C19.5 9.8 15.5 7.2 12 3z",
  c: "M12 3.2a3.1 3.1 0 0 0-2.55 4.86A3.1 3.1 0 1 0 8.9 14.1c.83 0 1.58-.32 2.14-.85-.13 1.9-1 3.35-2.54 4.55h7c-1.54-1.2-2.41-2.65-2.54-4.55.56.53 1.31.85 2.14.85a3.1 3.1 0 1 0-.55-6.04A3.1 3.1 0 0 0 12 3.2z",
};

function suitIcon(suit: Suit): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "suit-svg");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", SUIT_PATH[suit]);
  path.setAttribute("fill", "currentColor");
  svg.appendChild(path);
  return svg;
}

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
      // Suit in the corner only on small cards (which have no centre pip).
      opts.small ? h("span", { class: "card-csuit" }, suitIcon(suit)) : null,
    ),
    !opts.small && h("div", { class: "card-pip" }, suitIcon(suit)),
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

/** Casino-style chip color by amount: white → red → green → blue → black → purple. */
export function chipColor(amount: number): string {
  if (amount >= 5000) return "#8b5cf6"; // purple
  if (amount >= 2000) return "#1f2530"; // black
  if (amount >= 1000) return "#3a6fd8"; // blue
  if (amount >= 500) return "#2fa96b"; // green
  if (amount >= 100) return "#e0454d"; // red
  return "#c9ced6"; // white / grey (low)
}

/** A little poker chip whose color reflects the amount. */
export function chipDisc(amount: number): HTMLElement {
  return h("span", { class: "chip-disc", style: `--chip-color:${chipColor(amount)}` });
}

/** A small chip badge showing an amount (bets and the pot). */
export function chipBadge(amount: number, cls = ""): HTMLElement {
  return h(
    "div",
    { class: `chipbadge ${cls}`.trim() },
    chipDisc(amount),
    h("span", { class: "chipbadge-amt tnum" }, amount.toLocaleString("en-US")),
  );
}
