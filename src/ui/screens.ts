import type { Card } from "../engine/cards";
import type { Format, PlayerAction } from "../engine/types";
import { cardEl, chipBadge, chipDisc, flipCard } from "./cards";
import { applyTheme, chips, clear, getLayout, getReveal, getTheme, h, icon, setLayout, setReveal, themeToggle } from "./dom";
import { isMuted, play as playSfx, toggleMuted } from "./sound";
import type { ClientView, PublicSeat } from "../net/protocol";

// --- Lobby -----------------------------------------------------------------

export interface LobbyHandlers {
  create(name: string, opts: { format: Format; buyIn: number; sb: number; bb: number; seats: number; clock: number }): void;
  join(name: string, key: string): void;
}

export function renderLobby(root: HTMLElement, initialKey: string, err: string, h_: LobbyHandlers): void {
  const savedName = localStorage.getItem("holdem:name") ?? "";
  let format: Format = "cash";

  const nameInput = h("input", { class: "input", placeholder: "e.g. Alex", value: savedName, maxlength: 20 }) as HTMLInputElement;
  const keyInput = h("input", { class: "input", placeholder: "PKR-XXXX", value: initialKey || "PKR-" }) as HTMLInputElement;
  const buyIn = h("input", { class: "input", type: "number", value: "1000", min: "1" }) as HTMLInputElement;
  const sb = h("input", { class: "input", type: "number", value: "10", min: "1" }) as HTMLInputElement;
  const bb = h("input", { class: "input", type: "number", value: "20", min: "2" }) as HTMLInputElement;
  const seats = h("input", { class: "input", type: "number", value: "6", min: "2", max: "6" }) as HTMLInputElement;
  const clock = h("input", { class: "input", type: "number", value: "45", min: "10" }) as HTMLInputElement;
  const errEl = h("div", { class: "err" }, err);

  const cashBtn = h("button", { class: "on", type: "button" }, "Cash game");
  const tourBtn = h("button", { type: "button" }, "Tournament");
  const tourNote = h("div", { class: "pod-tag", style: "margin:-6px 0 4px;color:var(--muted)" },
    "Blinds rise each time a player busts out.");
  tourNote.style.display = "none";
  cashBtn.onclick = () => { format = "cash"; cashBtn.classList.add("on"); tourBtn.classList.remove("on"); tourNote.style.display = "none"; };
  tourBtn.onclick = () => { format = "tournament"; tourBtn.classList.add("on"); cashBtn.classList.remove("on"); tourNote.style.display = "block"; };

  const needName = (): string | null => {
    const n = nameInput.value.trim();
    if (!n) { errEl.textContent = "Enter a display name first."; return null; }
    localStorage.setItem("holdem:name", n);
    return n;
  };

  const createBtn = h("button", { class: "btn btn-ghost", type: "button" }, "Create room");
  createBtn.onclick = () => {
    const n = needName();
    if (!n) return;
    h_.create(n, {
      format,
      buyIn: Math.max(1, +buyIn.value | 0),
      sb: Math.max(1, +sb.value | 0),
      bb: Math.max(2, +bb.value | 0),
      seats: Math.min(6, Math.max(2, +seats.value | 0)),
      clock: Math.max(10, +clock.value | 0),
    });
  };

  const joinBtn = h("button", { class: "btn btn-gold btn-join", type: "button" }, "Join room");
  joinBtn.onclick = () => {
    const n = needName();
    if (!n) return;
    const key = keyInput.value.trim().toUpperCase();
    if (!key) { errEl.textContent = "Enter the room key your host shared."; return; }
    h_.join(n, key);
  };

  clear(root).append(
    h("div", { class: "lobby" },
      h("div", { class: "lobby-card" },
        h("div", { class: "lobby-top" },
          h("span", { class: "suits" }, h("span", {}, "♠"), h("span", { class: "r" }, "♥"), h("span", { class: "r" }, "♦"), h("span", {}, "♣")),
          h("span", { class: "brand-spacer" }),
          themeToggle("icon-btn"),
        ),
        h("div", { class: "field" }, h("label", {}, "Your name"), nameInput),
        // Join is the primary action — enter a key your host shared and deal in.
        h("div", { class: "join-block" },
          h("div", { class: "field" }, h("label", {}, "Room key"), keyInput),
          joinBtn,
        ),
        h("div", { class: "divider" }, "or start a new table"),
        // Hosting is the secondary path, tucked below.
        h("div", { class: "field" },
          h("label", {}, "New table"),
          h("div", { class: "seg" }, cashBtn, tourBtn),
        ),
        tourNote,
        h("details", { class: "advanced" },
          h("summary", {}, "Table settings"),
          h("div", { class: "grid2" },
            h("div", { class: "field" }, h("label", {}, "Buy-in"), buyIn),
            h("div", { class: "field" }, h("label", {}, "Max seats"), seats),
            h("div", { class: "field" }, h("label", {}, "Small blind"), sb),
            h("div", { class: "field" }, h("label", {}, "Big blind"), bb),
            h("div", { class: "field" }, h("label", {}, "Shot clock (s)"), clock),
          ),
        ),
        createBtn,
        errEl,
      ),
    ),
  );
  if (!savedName) nameInput.focus();
}

// --- Connecting (guest, before first state arrives) ------------------------

export function renderConnecting(root: HTMLElement, roomKey: string, onLeave: () => void, slow = false): void {
  const back = h("button", { class: "btn btn-ghost", type: "button" }, "Back to lobby");
  back.onclick = onLeave;
  clear(root).append(
    h("div", { class: "lobby" },
      h("div", { class: "lobby-card connecting" },
        h("div", { class: "spinner" }),
        h("h2", { class: "conn-title" }, "Joining room"),
        h("div", { class: "conn-key tnum" }, roomKey),
        h("p", { class: "conn-msg" },
          slow
            ? "Still connecting. Make sure the host's tab is open and the room key is right — the host must be online for you to join."
            : "Connecting to the table…"),
        back,
      ),
    ),
  );
}

// --- Table -----------------------------------------------------------------

export interface TableHandlers {
  act(a: PlayerAction): void;
  rebuy(): void;
  sitOut(v: boolean): void;
  show(v: boolean): void;
  start(): void;
  copyLink(): void;
  leave(): void;
  toggleLayout(): void;
  rerender(): void;
}

/** A small settings popover: reveal mode, table view, and theme. */
function settingsMenu(hs: TableHandlers): HTMLElement {
  const gear = h("button", { class: "icon-btn", type: "button", title: "Settings" }, icon("gear"));
  const seg = (label: string, opts: Array<[string, string]>, current: string, pick: (v: string) => void) =>
    h("div", { class: "set-row" },
      h("span", { class: "set-label" }, label),
      h("div", { class: "seg seg-sm" }, ...opts.map(([v, l]) => {
        const b = h("button", { class: v === current ? "on" : "", type: "button" }, l);
        b.onclick = () => pick(v);
        return b;
      })),
    );
  const panel = h("div", { class: `settings-panel${settingsOpen ? " open" : ""}` },
    seg("Reveal cards", [["hold", "Hold"], ["tap", "Tap"]], getReveal(), (v) => { setReveal(v as "hold" | "tap"); hs.rerender(); }),
    seg("Table view", [["table", "Table"], ["list", "List"]], getLayout(), (v) => { setLayout(v as "table" | "list"); hs.rerender(); }),
    seg("Theme", [["light", "Light"], ["dark", "Dark"]], getTheme(), (v) => { applyTheme(v as "light" | "dark"); hs.rerender(); }),
  );
  gear.onclick = (e) => { e.stopPropagation(); settingsOpen = !settingsOpen; panel.classList.toggle("open", settingsOpen); };
  return h("div", { class: "settings" }, gear, panel);
}

/** Topbar speaker toggle. Muted by default; tapping it unlocks + toggles audio. */
function muteButton(): HTMLElement {
  const btn = h("button", { class: "icon-btn", type: "button" });
  const paint = () => {
    const m = isMuted();
    btn.replaceChildren(icon(m ? "volume-xmark" : "volume-high"));
    btn.title = m ? "Sound off — tap to unmute" : "Sound on — tap to mute";
    btn.classList.toggle("is-muted", m);
  };
  paint();
  btn.onclick = () => {
    const m = toggleMuted();
    paint();
    if (!m) playSfx("chip"); // audible confirmation + unlocks the audio context
  };
  return btn;
}

export interface UIState {
  raiseTo: number;
  turnKey: string; // identifies the current decision, to reset the slider
  prevBoardLen: number; // to animate only newly dealt community cards
  prevHand: number; // to animate hole cards only on a fresh hand
}

// Peek state persists across re-renders so another player's turn doesn't reset it.
let revealHeld = false;
let revealToggled = false;
let releaseBound = false;
// Settings popover open state also survives re-renders.
let settingsOpen = false;
// Whether the compact bet slider is open (after tapping Raise).
let raiseOpen = false;
function ensureReleaseListeners() {
  if (releaseBound) return;
  releaseBound = true;
  const release = () => {
    if (!revealHeld) return;
    revealHeld = false;
    document.querySelectorAll(".peekable").forEach((el) => el.classList.remove("revealed"));
  };
  for (const ev of ["pointerup", "touchend", "touchcancel", "pointercancel", "mouseup", "blur"]) {
    window.addEventListener(ev, release);
  }
}

const STAGE_LABEL: Record<string, string> = {
  waiting: "Waiting",
  preflop: "Pre-flop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
  showdown: "Showdown",
  handComplete: "Hand over",
};

function winningCards(view: ClientView): Set<Card> {
  const set = new Set<Card>();
  if (view.stage !== "showdown" || !view.result || !view.result.wentToShowdown) return set;
  const top = view.result.pots.find((p) => p.winners.length > 0);
  const w = top?.winners[0];
  if (w === undefined) return set;
  for (const c of view.result.showdown[w]?.best ?? []) set.add(c);
  return set;
}

/** Ellipse position for a seat (percent), clamped away from the edges/rail. */
function seatCoords(relPos: number, total: number): { left: number; top: number } {
  const angle = Math.PI / 2 + (relPos / total) * Math.PI * 2;
  // Push seats wider to the rail as the table fills up, so they spread out.
  const many = total >= 7;
  const cx = 50, cy = 50, rx = many ? 49 : 46, ry = many ? 46 : 43;
  const left = Math.max(12, Math.min(88, cx + rx * Math.cos(angle)));
  const top = Math.max(12, Math.min(87, cy + ry * Math.sin(angle)));
  return { left, top };
}

/** First alphanumeric character of a name, uppercased (for the avatar). */
function initial(name: string): string {
  const m = name.trim().match(/[a-z0-9]/i);
  return (m ? m[0] : "?").toUpperCase();
}

/** Deterministic avatar colour from a name. */
function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360} 52% 46%)`;
}

/** The action/status tag shown on a seat's nameplate (not shown at showdown). */
function podTag(view: ClientView, i: number, seat: PublicSeat): HTMLElement | null {
  if (view.stage === "showdown" || view.toActSeat === i) return null; // ring shows the turn
  let label = "", key = "";
  if (seat.afk) { label = "AFK"; key = "afk"; }
  else if (seat.status === "allin") { label = "All in"; key = "allin"; }
  else if (seat.lastAction) { label = seat.lastAction; key = seat.lastAction.split(" ")[0].toLowerCase().replace("-", ""); }
  else if (seat.waitingToPlay) { label = "Next"; key = "wait"; }
  else if (seat.chips <= 0) { label = view.config.format === "cash" ? "Busted" : "Out"; key = "wait"; }
  else if (seat.status === "sittingOut") { label = "Away"; key = "wait"; }
  else return null;
  return h("div", { class: `pod-tag pill pill-${key}` }, label);
}

/** A seat pod on the felt: a solid nameplate (avatar + name + stack) with the
 *  hole cards tucked behind its top edge, a bet toward the pot, and a status tag.
 *  Your own cards sit peekable behind your plate. */
function seatPod(view: ClientView, i: number, winSet: Set<Card>, animHole: boolean): HTMLElement {
  const seat = view.seats[i];
  if (!seat) return h("div", { class: "pod avatar-pod is-empty" }, h("div", { class: "av av-empty" }));

  const isMe = i === view.yourSeat;
  const acting = view.stage !== "showdown" && view.toActSeat === i;
  const showdown = view.stage === "showdown";
  const isWinner = showdown && !!view.result?.pots.some((p) => p.winners.includes(i));
  const dealt = seat.status === "active" || seat.status === "allin" || seat.status === "folded";
  const folded = seat.status === "folded";
  // At showdown, dim everyone who isn't a winner so the winner pops.
  const dimPod = folded || !dealt || (showdown && !isWinner);
  const cls = ["pod", "avatar-pod", isMe && "is-me", dimPod && "is-out", acting && "is-acting",
    isWinner && "is-winner", showdown && !isWinner && dealt && "is-loser", !seat.connected && "is-off"]
    .filter(Boolean).join(" ");

  // Cards tuck behind the plate: yours are peekable, opponents' show at showdown.
  const faces = seat.holeCards && !seat.mucked;
  let cards: HTMLElement | null = null;
  if (isMe && seat.holeCards) {
    cards = peekCards(seat.holeCards, folded, animHole, "seat-cards");
  } else if (dealt && !isMe) {
    const cardEls = faces
      ? seat.holeCards!.map((c) => cardEl(c, { small: true, dim: winSet.size > 0 && !winSet.has(c) }))
      : [cardEl(null, { small: true, faceDown: true }), cardEl(null, { small: true, faceDown: true })];
    cards = h("div", { class: "pod-cards" }, ...cardEls);
  }

  const badge = seat.isButton ? "d" : seat.isBB ? "bb" : seat.isSB ? "sb" : "";

  const plate = h("div", { class: "plate" },
    h("div", { class: "av" },
      h("div", { class: "av-ring" }),
      h("div", { class: "av-face", style: `--av-color:${avatarColor(seat.name)}` }, initial(seat.name)),
      !seat.connected ? h("span", { class: "av-off", title: "Disconnected" }) : null,
    ),
    h("div", { class: "plate-txt" },
      h("div", { class: "pod-name" }, seat.name),
      h("div", { class: "pod-chips" }, chipDisc(seat.chips), h("span", { class: "tnum" }, chips(seat.chips))),
    ),
    badge ? h("span", { class: `pod-btn ${badge}` }, badge.toUpperCase()) : null,
  );

  // One element below (or, for bottom seats, above) the plate: the committed bet
  // stands in for Call/Raise; otherwise a status tag. Nothing shows at showdown.
  let below: HTMLElement | null = null;
  if (!showdown) {
    below = seat.committedRound > 0
      ? h("div", { class: "pod-bet" }, chipBadge(seat.committedRound))
      : podTag(view, i, seat);
  }

  return h("div", { class: cls }, cards, plate, below);
}

/** A compact player row for the list layout: small avatar disc · name/chips ·
 *  bet + status. Kept short so a full table fits without scrolling. */
function playerRow(view: ClientView, i: number, winSet: Set<Card>): HTMLElement {
  const seat = view.seats[i];
  if (!seat) return h("div", { class: "pl-row is-open" }, h("span", { class: "pl-openseat" }, "Open seat"));

  const isMe = i === view.yourSeat;
  const acting = view.stage !== "showdown" && view.toActSeat === i;
  const isWinner = view.stage === "showdown" && !!view.result?.pots.some((p) => p.winners.includes(i));
  const dealt = seat.status === "active" || seat.status === "allin" || seat.status === "folded";
  const inactive = !dealt || seat.status === "folded";
  const cls = ["pl-row", isMe && "is-me", inactive && "is-out", acting && "is-acting", isWinner && "is-winner"]
    .filter(Boolean).join(" ");

  // One position chip (D takes priority), pinned to the avatar corner.
  const badge = seat.isButton ? "d" : seat.isBB ? "bb" : seat.isSB ? "sb" : "";

  const ava = h("div", { class: "pl-ava" },
    h("div", { class: "pl-ava-face", style: `--av-color:${avatarColor(seat.name)}` }, initial(seat.name)),
    !seat.connected ? h("span", { class: "pl-off-dot", title: "Disconnected" }) : null,
    badge ? h("span", { class: `pl-badge ${badge}` }, badge.toUpperCase()) : null,
  );

  // Only show cards face-up (at showdown); face-down backs add height for no info.
  const showdown = view.stage === "showdown";
  const faces = seat.holeCards && !isMe && !seat.mucked;
  const cardsEl = faces
    ? h("div", { class: "pl-cards" }, ...seat.holeCards!.map((c) => cardEl(c, { small: true, dim: winSet.size > 0 && !winSet.has(c) })))
    : null;

  // A single right-side token so nothing overlaps and names keep their room.
  // Blinds already show as the avatar corner chip, so we don't repeat them here;
  // the committed bet stands in for Call/Raise, and only special states get a pill.
  let right: Node | null = null;
  if (showdown) right = cardsEl;
  else if (acting) right = h("div", { class: "pl-clock" }, "⏱ ", h("span", { class: "clock-num" }, "—"));
  else if (seat.afk) right = h("span", { class: "pill pill-afk" }, "AFK");
  else if (seat.status === "allin") right = h("span", { class: "pill pill-allin" }, "All-in");
  else if (seat.committedRound > 0) right = chipBadge(seat.committedRound);
  else if (seat.waitingToPlay) right = h("span", { class: "pill pill-wait" }, "Next");
  else if (seat.chips <= 0) right = h("span", { class: "pill pill-wait" }, view.config.format === "cash" ? "Busted" : "Out");
  else if (seat.status === "sittingOut") right = h("span", { class: "pill pill-wait" }, "Away");

  return h("div", { class: cls },
    ava,
    h("div", { class: "pl-info" },
      h("div", { class: "pl-name" }, seat.name + (isMe ? " (you)" : "")),
      h("div", { class: "pl-chips" }, chipDisc(seat.chips), h("span", { class: "tnum" }, chips(seat.chips))),
    ),
    right ? h("div", { class: "pl-right" }, right) : null,
  );
}

function resultMessage(view: ClientView): string {
  if (view.stage !== "showdown" || !view.result) return "";
  const names = (idxs: number[]) => idxs.map((i) => view.seats[i]?.name ?? "?").join(" & ");
  const top = view.result.pots.find((p) => p.winners.length > 0);
  if (!top) return "";
  const total = Object.values(view.result.payouts).reduce((a, b) => a + b, 0);
  if (!view.result.wentToShowdown) return `${names(top.winners)} wins ${total.toLocaleString()}`;
  return `${names(top.winners)} wins ${total.toLocaleString()} chips`;
}

function centerMessage(view: ClientView): string {
  if (view.tournamentWinner !== null) {
    return `🏆 ${view.seats[view.tournamentWinner]?.name} wins the tournament!`;
  }
  if (view.stage === "waiting") {
    const n = view.seats.filter(Boolean).length;
    return n < 2 ? "Waiting for players to join…" : "Starting soon…";
  }
  if (view.stage === "showdown") return resultMessage(view);
  return "";
}

function community(view: ClientView, winSet: Set<Card>, animFrom: number): HTMLElement {
  const slots: HTMLElement[] = [];
  for (let k = 0; k < 5; k++) {
    const card = view.board[k];
    slots.push(
      card
        ? cardEl(card, { big: true, dim: winSet.size > 0 && !winSet.has(card), anim: k >= animFrom })
        : cardEl(null, { big: true, slot: true }),
    );
  }
  return h("div", { class: "community" }, ...slots);
}

// --- Action controls -------------------------------------------------------

interface Legal {
  toCall: number;
  canCheck: boolean;
  canRaise: boolean;
  minTo: number;
  maxTo: number;
}

function computeLegal(view: ClientView): Legal | null {
  const seat = view.yourSeat >= 0 ? view.seats[view.yourSeat] : null;
  if (!seat || seat.status !== "active") return null;
  const toCall = Math.max(0, view.currentBet - seat.committedRound);
  const maxTo = seat.committedRound + seat.chips;
  const minTo = Math.min(view.currentBet + view.lastRaiseSize, maxTo);
  return {
    toCall: Math.min(toCall, seat.chips),
    canCheck: toCall === 0,
    canRaise: seat.chips > toCall && maxTo > view.currentBet,
    minTo,
    maxTo,
  };
}

function controls(view: ClientView, ui: UIState, hs: TableHandlers): HTMLElement {
  const myTurn = view.yourSeat >= 0 && view.toActSeat === view.yourSeat && view.stage !== "showdown";
  const legal = myTurn ? computeLegal(view) : null;

  if (!legal) {
    raiseOpen = false;
    // Not my turn / not in hand.
    const mySeat = view.yourSeat >= 0 ? view.seats[view.yourSeat] : null;
    const enough = view.seats.filter((s) => s && s.chips > 0 && !s.sitOutNext && !s.afk).length >= 2;

    let note = "Watching the table.";
    if (mySeat?.afk) note = "You're away — tap “I'm back” to rejoin.";
    else if (view.stage === "showdown") note = "Next hand starting…";
    else if (view.stage === "waiting") note = enough ? "Ready — waiting for the host to deal." : "Waiting for players to join…";
    else if (view.toActSeat >= 0) note = `Waiting for ${view.seats[view.toActSeat]?.name ?? "the table"}…`;

    const kids: Array<Node | false> = [h("div", { class: "wait-note" }, h("span", { class: "pulse-dot" }), note)];
    if (view.isHost && view.stage === "waiting" && enough) {
      const b = h("button", { class: "btn btn-gold deal-btn", type: "button" }, "Deal now");
      b.onclick = () => hs.start();
      kids.push(b);
    }
    return h("div", { class: "controls controls--idle" }, ...kids.filter(Boolean) as Node[]);
  }

  const facing = legal.toCall > 0;
  ui.raiseTo = Math.min(legal.maxTo, Math.max(legal.minTo, ui.raiseTo || legal.minTo));

  // Compact bet slider — shown only after tapping Raise.
  if (raiseOpen && legal.canRaise) {
    const slider = h("input", {
      class: "slider", type: "range", min: String(legal.minTo), max: String(legal.maxTo), value: String(ui.raiseTo), step: String(view.bigBlind || 1),
    }) as HTMLInputElement;
    const lbl = h("span", { class: "bet-amt tnum" }, "");
    const isAllIn = () => ui.raiseTo >= legal.maxTo;
    const label = () => (isAllIn() ? "All in" : `${facing ? "Raise" : "Bet"} ${chips(ui.raiseTo)}`);
    const sync = (v: number) => {
      ui.raiseTo = Math.min(legal.maxTo, Math.max(legal.minTo, Math.round(v)));
      slider.value = String(ui.raiseTo);
      slider.style.setProperty("--fill", `${((ui.raiseTo - legal.minTo) / Math.max(1, legal.maxTo - legal.minTo)) * 100}%`);
      lbl.textContent = label();
    };
    slider.oninput = () => sync(+slider.value);
    sync(ui.raiseTo);

    const cancel = h("button", { class: "act act-back", type: "button", title: "Back" }, icon("xmark"));
    cancel.onclick = () => { raiseOpen = false; hs.rerender(); };
    const confirm = h("button", { class: "act act-raise", type: "button" }, icon("angles-up"), lbl);
    confirm.onclick = () => { raiseOpen = false; hs.act({ type: "raise", to: ui.raiseTo }); };

    return h("div", { class: "controls" },
      h("div", { class: "bet-bar" }, cancel, h("div", { class: "bet-slider" }, slider), confirm),
    );
  }

  const foldBtn = h("button", { class: "act act-fold", type: "button" }, icon("xmark"), h("span", {}, "Fold"));
  foldBtn.onclick = () => hs.act({ type: "fold" });

  const midBtn = facing
    ? h("button", { class: "act act-call", type: "button" }, icon("check"), h("span", {}, `Call ${chips(legal.toCall)}`))
    : h("button", { class: "act act-check", type: "button" }, icon("check"), h("span", {}, "Check"));
  (midBtn as HTMLButtonElement).onclick = () => hs.act(facing ? { type: "call" } : { type: "check" });

  const row = h("div", { class: "action-row" }, foldBtn, midBtn);

  if (legal.canRaise) {
    const raiseBtn = h("button", { class: "act act-raise", type: "button" }, icon("angles-up"), h("span", {}, "Raise"));
    raiseBtn.onclick = () => {
      // Open the slider, pre-set to a half-pot raise.
      const potAfter = view.pot + legal.toCall;
      ui.raiseTo = Math.min(legal.maxTo, Math.max(legal.minTo, view.currentBet + Math.round(potAfter / 2)));
      raiseOpen = true;
      hs.rerender();
    };
    row.append(raiseBtn);
  } else {
    row.append(h("button", { class: "act act-raise", type: "button", disabled: true }, icon("angles-up"), h("span", {}, "Raise")));
  }

  return h("div", { class: "controls" }, row);
}

// --- My cards (peekable) + secondary buttons -------------------------------

/** Your hole cards as a hold/tap-to-peek element. `wrap` sizes them (footer vs seat). */
function peekCards(cards: readonly Card[], folded: boolean, animHole: boolean, wrap: string): HTMLElement {
  const mode = getReveal();
  const el = h("div", { class: `${wrap} peekable` },
    ...cards.map((c) => flipCard(c, { big: true, dim: folded, anim: animHole })),
    h("div", { class: "peek-hint" }, mode === "tap" ? "tap to reveal" : "hold to peek"),
  );
  if (revealHeld || revealToggled) el.classList.add("revealed");
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  if (mode === "tap") {
    el.addEventListener("click", () => {
      revealToggled = !revealToggled;
      el.classList.toggle("revealed", revealToggled);
    });
  } else {
    const hold = (e: Event) => { e.preventDefault(); revealHeld = true; el.classList.add("revealed"); };
    el.addEventListener("touchstart", hold, { passive: false });
    el.addEventListener("mousedown", hold);
    ensureReleaseListeners();
  }
  return el;
}

/** Muck / show / rebuy / I'm-back buttons for the local player. */
function myButtons(view: ClientView, hs: TableHandlers): HTMLElement[] {
  const seat = view.yourSeat >= 0 ? view.seats[view.yourSeat] : null;
  const buttons: HTMLElement[] = [];
  if (!seat) return buttons;
  if (seat.afk) {
    const back = h("button", { class: "mini-btn on", type: "button" }, "I'm back");
    back.onclick = () => hs.sitOut(false);
    buttons.push(back);
  }
  if (view.stage === "showdown" && (seat.status === "active" || seat.status === "allin")) {
    if (view.result?.wentToShowdown && !seat.mucked) {
      const b = h("button", { class: "mini-btn", type: "button" }, "Muck");
      b.onclick = () => hs.show(false);
      buttons.push(b);
    } else if (!view.result?.wentToShowdown && view.result?.pots.some((p) => p.winners.includes(view.yourSeat)) && !seat.revealVoluntary && !seat.holeCards) {
      const b = h("button", { class: "mini-btn", type: "button" }, "Show cards");
      b.onclick = () => hs.show(true);
      buttons.push(b);
    }
  }
  if (view.config.format === "cash" && seat.chips < view.config.buyIn && view.stage !== "preflop" && view.stage !== "flop" && view.stage !== "turn" && view.stage !== "river") {
    const b = h("button", { class: "mini-btn on", type: "button" }, seat.chips <= 0 ? "Rebuy" : "Top up");
    b.onclick = () => hs.rebuy();
    buttons.push(b);
  }
  return buttons;
}

/** Big my-cards + name/chips block — used in the LIST layout footer. */
function mine(view: ClientView, hs: TableHandlers, animHole: boolean): HTMLElement {
  const seat = view.yourSeat >= 0 ? view.seats[view.yourSeat] : null;
  const dealt = seat && (seat.status === "active" || seat.status === "allin" || seat.status === "folded");

  let cardsEl: HTMLElement;
  if (seat?.holeCards) {
    cardsEl = peekCards(seat.holeCards, seat.status === "folded", animHole, "my-cards");
  } else if (dealt) {
    cardsEl = h("div", { class: "my-cards" }, cardEl(null, { big: true, faceDown: true }), cardEl(null, { big: true, faceDown: true }));
  } else if (seat) {
    cardsEl = h("div", { class: "my-cards" }, cardEl(null, { big: true, slot: true }), cardEl(null, { big: true, slot: true }));
  } else {
    cardsEl = h("div", { class: "my-cards" }, h("span", { class: "placeholder" }, "Spectating"));
  }

  return h("div", { class: "mine" },
    cardsEl,
    h("div", { class: "my-bar" },
      seat ? h("span", { class: "my-name" }, seat.name) : null,
      seat ? h("span", { class: "my-chips" }, chipDisc(seat.chips), h("span", { class: "tnum" }, chips(seat.chips))) : null,
      ...myButtons(view, hs),
    ),
  );
}

// --- Assemble --------------------------------------------------------------

export function renderTable(root: HTMLElement, view: ClientView, ui: UIState, hs: TableHandlers): void {
  const winSet = winningCards(view);

  // Animate only genuinely new cards: community cards past the previous count,
  // and hole cards on a fresh hand. Everything else stays put (no flicker).
  const sameHand = view.handNumber === ui.prevHand;
  const animFrom = sameHand ? ui.prevBoardLen : 0;
  const animHole = !sameHand;
  ui.prevBoardLen = view.board.length;
  ui.prevHand = view.handNumber;
  // New hand -> cards hidden again by default, bet slider closed.
  if (!sameHand) {
    revealHeld = false;
    revealToggled = false;
    raiseOpen = false;
  }

  const pot = () => h("div", { class: "pot" }, chipDisc(view.pot), "Pot ", h("span", { class: "tnum" }, view.pot.toLocaleString()));
  const stageLabel = () => h("div", { class: "stage-label" }, STAGE_LABEL[view.stage] ?? "");
  const msg = () => h("div", { class: "msg" }, centerMessage(view));

  const layout = getLayout();
  let body: HTMLElement;
  if (layout === "list") {
    // Old list/grid layout.
    const players = h("div", { class: "players" },
      h("div", { class: "players-head" }, "Players"),
      ...view.seats.map((_, i) => playerRow(view, i, winSet)),
    );
    const tableMain = h("div", { class: "table-main" }, pot(), community(view, winSet, animFrom), stageLabel(), msg());
    body = h("div", { class: "stage-wrap" }, players, tableMain);
  } else {
    // Green-felt oval: pot + board in the center, seats around the edge.
    const center = h("div", { class: "center" }, pot(), community(view, winSet, animFrom), stageLabel(), msg());
    const total = view.config.maxSeats;
    const arena = h("div", { class: "arena", "data-seats": String(total) }, h("div", { class: "felt" }), center);
    const anchor = view.yourSeat >= 0 ? view.yourSeat : 0;
    for (let i = 0; i < total; i++) {
      const relPos = (i - anchor + total) % total;
      const { left, top } = seatCoords(relPos, total);
      const style = `left:${left.toFixed(2)}%;top:${top.toFixed(2)}%`;
      arena.append(h("div", { class: "seat", style }, seatPod(view, i, winSet, animHole)));
    }
    body = arena;
  }

  const blinds = `${view.smallBlind}/${view.bigBlind}`;
  const meta = `${view.config.format === "tournament" ? "Tournament" : "Cash"} · blinds ${blinds}`;

  const copyBtn = h("button", { class: "copy-btn", type: "button", title: "Copy invite link" },
    icon("link"),
    h("span", { class: "copy-txt" }, "Copy link"),
  );
  copyBtn.onclick = () => hs.copyLink();
  const leaveBtn = h("button", { class: "leave-btn", type: "button" }, icon("right-from-bracket"), h("span", { class: "leave-txt" }, "Leave"));
  leaveBtn.onclick = () => hs.leave();

  // Table view: slim footer with just the action controls (your cards live at your
  // seat). List view: the full footer with your big cards.
  const footer =
    layout === "list"
      ? h("div", { class: "footer" }, controls(view, ui, hs), mine(view, hs, animHole))
      : (() => {
          const btns = myButtons(view, hs);
          return h("div", { class: "footer footer--table" },
            controls(view, ui, hs),
            btns.length ? h("div", { class: "my-actions" }, ...btns) : null,
          );
        })();

  clear(root).append(
    h("div", { class: "table-screen" },
      h("div", { class: "topbar" },
        h("span", { class: "tb-brand" }, "Hold'em"),
        h("span", { class: "tb-key" }, h("span", { class: "tb-room-label" }, "Room "), h("b", {}, roomKeyFromHash()), copyBtn),
        h("span", { class: "tb-spacer" }),
        h("span", { class: "tb-meta" }, meta, view.spectatorCount > 0 ? ` · ${view.spectatorCount} watching` : "", " · hand ", h("b", {}, String(view.handNumber))),
        muteButton(),
        settingsMenu(hs),
        leaveBtn,
      ),
      body,
      footer,
    ),
  );
}

function roomKeyFromHash(): string {
  const m = location.hash.match(/room=([A-Za-z0-9-]+)/);
  return m ? m[1] : "—";
}
