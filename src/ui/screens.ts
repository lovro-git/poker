import type { Card } from "../engine/cards";
import type { Format, PlayerAction } from "../engine/types";
import { cardEl, chipBadge } from "./cards";
import { chips, clear, h } from "./dom";
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
  const keyInput = h("input", { class: "input", placeholder: "PKR-XXXX", value: initialKey }) as HTMLInputElement;
  const buyIn = h("input", { class: "input", type: "number", value: "1000", min: "1" }) as HTMLInputElement;
  const sb = h("input", { class: "input", type: "number", value: "10", min: "1" }) as HTMLInputElement;
  const bb = h("input", { class: "input", type: "number", value: "20", min: "2" }) as HTMLInputElement;
  const seats = h("input", { class: "input", type: "number", value: "6", min: "2", max: "9" }) as HTMLInputElement;
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

  const createBtn = h("button", { class: "btn btn-gold", type: "button" }, "Create room");
  createBtn.onclick = () => {
    const n = needName();
    if (!n) return;
    h_.create(n, {
      format,
      buyIn: Math.max(1, +buyIn.value | 0),
      sb: Math.max(1, +sb.value | 0),
      bb: Math.max(2, +bb.value | 0),
      seats: Math.min(9, Math.max(2, +seats.value | 0)),
      clock: Math.max(10, +clock.value | 0),
    });
  };

  const joinBtn = h("button", { class: "btn btn-ghost", type: "button" }, "Join room");
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
        h("div", { class: "brand" },
          h("h1", {}, "Hold'em"),
          h("span", { class: "suits" }, h("span", {}, "♠"), h("span", { class: "r" }, "♥"), h("span", { class: "r" }, "♦"), h("span", {}, "♣")),
        ),
        h("p", { class: "lobby-sub" }, "Peer-to-peer poker. Create a room, share the key, deal in."),
        h("div", { class: "field" }, h("label", {}, "Your name"), nameInput),
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
        h("div", { class: "divider" }, "or join an existing one"),
        h("div", { class: "field" }, h("label", {}, "Room key"), keyInput),
        joinBtn,
        errEl,
      ),
    ),
  );
  if (!savedName) nameInput.focus();
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
}

export interface UIState {
  raiseTo: number;
  turnKey: string; // identifies the current decision, to reset the slider
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

function seatStyle(relPos: number, total: number): string {
  const angle = Math.PI / 2 + (relPos / total) * Math.PI * 2;
  const cx = 50, cy = 50, rx = 46, ry = 45;
  const left = cx + rx * Math.cos(angle);
  const top = cy + ry * Math.sin(angle);
  return `left:${left.toFixed(1)}%;top:${top.toFixed(1)}%`;
}

function winningCards(view: ClientView): Set<Card> {
  const set = new Set<Card>();
  if (view.stage !== "showdown" || !view.result || !view.result.wentToShowdown) return set;
  const top = view.result.pots.find((p) => p.winners.length > 0);
  const w = top?.winners[0];
  if (w === undefined) return set;
  for (const c of view.result.showdown[w]?.best ?? []) set.add(c);
  return set;
}

function seatTag(view: ClientView, i: number, seat: PublicSeat): Node | null {
  if (view.stage !== "showdown" && view.toActSeat === i) {
    return h("div", { class: "pod-tag" }, "⏱ ", h("span", { class: "clock-num" }, "—"));
  }
  if (seat.status === "allin") return h("div", { class: "pod-tag" }, "All in");
  if (seat.status === "folded") return h("div", { class: "pod-tag" }, "Folded");
  if (seat.waitingToPlay) return h("div", { class: "pod-tag" }, "Next hand");
  if (seat.chips <= 0) return h("div", { class: "pod-tag" }, view.config.format === "cash" ? "Busted" : "Out");
  if (seat.status === "sittingOut") return h("div", { class: "pod-tag" }, "Sitting out");
  return null;
}

function seatPod(view: ClientView, i: number, winSet: Set<Card>): HTMLElement {
  const seat = view.seats[i];
  if (!seat) return h("div", { class: "pod is-empty" }, "Open seat");

  const isMe = i === view.yourSeat;
  const acting = view.stage !== "showdown" && view.toActSeat === i;
  const isWinner = view.stage === "showdown" && !!view.result?.pots.some((p) => p.winners.includes(i));
  const cls = ["pod", seat.status === "folded" && "is-folded", acting && "is-acting", isWinner && "is-winner"]
    .filter(Boolean).join(" ");

  const dealt = seat.status === "active" || seat.status === "allin" || seat.status === "folded";
  let cards: HTMLElement | null = null;
  if (dealt) {
    const faces = seat.holeCards && !isMe && !seat.mucked;
    const cardEls = faces
      ? seat.holeCards!.map((c) => cardEl(c, { small: true, dim: winSet.size > 0 && !winSet.has(c) }))
      : [cardEl(null, { small: true, faceDown: true }), cardEl(null, { small: true, faceDown: true })];
    cards = h("div", { class: "pod-cards" }, ...cardEls);
  }

  return h("div", { class: cls },
    seat.isButton && h("div", { class: "dealer-btn" }, "D"),
    cards,
    h("div", { class: "pod-name" },
      !seat.connected && h("span", { class: "off", title: "Disconnected" }, "●"),
      seat.name + (isMe ? " (you)" : ""),
    ),
    h("div", { class: "pod-chips tnum" }, chips(seat.chips)),
    seatTag(view, i, seat),
    seat.committedRound > 0 && h("div", { class: "bet-chip" }, chipBadge(seat.committedRound)),
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

function boardRow(view: ClientView, winSet: Set<Card>): HTMLElement {
  const cards = view.board.map((c) => cardEl(c, { dim: winSet.size > 0 && !winSet.has(c) }));
  return h("div", { class: "board" }, ...cards);
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
    // Not my turn / not in hand.
    let note = "Watching the table.";
    if (view.stage === "showdown") note = "Next hand dealing…";
    else if (view.stage === "waiting") note = "Waiting for the next hand…";
    else if (view.toActSeat >= 0) note = `Waiting for ${view.seats[view.toActSeat]?.name ?? "the table"}…`;

    const kids: Array<Node | false> = [h("div", { class: "wait-note" }, h("span", { class: "pulse-dot" }), note)];
    if (view.isHost && view.stage === "waiting" && view.seats.filter((s) => s && s.chips > 0 && !s.sitOutNext).length >= 2) {
      const b = h("button", { class: "btn btn-gold", type: "button", style: "max-width:220px" }, "Deal now");
      b.onclick = () => hs.start();
      kids.push(b);
    }
    return h("div", { class: "controls" }, ...kids.filter(Boolean) as Node[]);
  }

  const facing = legal.toCall > 0;
  ui.raiseTo = Math.min(legal.maxTo, Math.max(legal.minTo, ui.raiseTo || legal.minTo));

  // Fold
  const foldBtn = h("button", { class: "act act-fold", type: "button" }, "Fold");
  foldBtn.onclick = () => hs.act({ type: "fold" });

  // Check / Call
  const midBtn = facing
    ? h("button", { class: "act act-call", type: "button" }, "Call", h("small", {}, chips(legal.toCall)))
    : h("button", { class: "act act-check", type: "button" }, "Check");
  (midBtn as HTMLButtonElement).onclick = () => hs.act(facing ? { type: "call" } : { type: "check" });

  const row: HTMLElement = h("div", { class: "action-row" }, foldBtn, midBtn);

  let raiseControls: HTMLElement | null = null;
  if (legal.canRaise) {
    const amtEl = h("input", {
      class: "raise-amt tnum", type: "number", value: String(ui.raiseTo), min: String(legal.minTo), max: String(legal.maxTo),
    }) as HTMLInputElement;
    const slider = h("input", {
      class: "slider", type: "range", min: String(legal.minTo), max: String(legal.maxTo), value: String(ui.raiseTo), step: String(view.bigBlind || 1),
    }) as HTMLInputElement;
    const setFill = () => {
      const pct = ((ui.raiseTo - legal.minTo) / Math.max(1, legal.maxTo - legal.minTo)) * 100;
      slider.style.setProperty("--fill", `${pct}%`);
    };
    const sync = (v: number) => {
      ui.raiseTo = Math.min(legal.maxTo, Math.max(legal.minTo, Math.round(v)));
      slider.value = String(ui.raiseTo);
      amtEl.value = String(ui.raiseTo);
      setFill();
      raiseBtn.replaceChildren(document.createTextNode(raiseLabel()));
    };
    slider.oninput = () => sync(+slider.value);
    amtEl.onchange = () => sync(+amtEl.value);

    const isAllIn = () => ui.raiseTo >= legal.maxTo;
    const raiseLabel = () => (isAllIn() ? "All in" : facing ? "Raise" : "Bet");
    const raiseBtn = h("button", { class: "act act-raise", type: "button" }, raiseLabel());
    raiseBtn.onclick = () => hs.act({ type: "raise", to: ui.raiseTo });
    row.append(raiseBtn);

    const potAfter = view.pot + legal.toCall;
    const preset = (label: string, to: number) => {
      const b = h("button", { class: "chip-btn", type: "button" }, label);
      b.onclick = () => sync(to);
      return b;
    };
    raiseControls = h("div", {},
      h("div", { class: "raise-row" }, slider, amtEl),
      h("div", { class: "presets" },
        preset("Min", legal.minTo),
        preset("½ Pot", view.currentBet + Math.round(potAfter / 2)),
        preset("Pot", view.currentBet + potAfter),
        preset("All in", legal.maxTo),
      ),
    );
    setFill();
  } else {
    // Can only call all-in or fold.
    row.append(h("button", { class: "act act-raise", type: "button", disabled: true }, "Raise"));
  }

  return h("div", { class: "controls" }, row, raiseControls);
}

// --- My cards + bar (bottom-right) -----------------------------------------

function mine(view: ClientView, hs: TableHandlers): HTMLElement {
  const seat = view.yourSeat >= 0 ? view.seats[view.yourSeat] : null;
  const dealt = seat && (seat.status === "active" || seat.status === "allin" || seat.status === "folded");

  let cardsEl: HTMLElement;
  if (seat?.holeCards) {
    const folded = seat.status === "folded";
    cardsEl = h("div", { class: "my-cards" }, ...seat.holeCards.map((c) => cardEl(c, { big: true, dim: folded })));
  } else if (dealt) {
    cardsEl = h("div", { class: "my-cards" }, cardEl(null, { big: true, faceDown: true }), cardEl(null, { big: true, faceDown: true }));
  } else {
    cardsEl = h("div", { class: "my-cards" }, h("span", { class: "placeholder" }, view.yourSeat < 0 ? "Spectating" : "Sitting out this hand"));
  }

  const bar = h("div", { class: "my-bar" });
  if (seat) {
    // Showdown muck / show controls.
    if (view.stage === "showdown" && (seat.status === "active" || seat.status === "allin")) {
      if (view.result?.wentToShowdown && !seat.mucked) {
        const b = h("button", { class: "mini-btn", type: "button" }, "Muck");
        b.onclick = () => hs.show(false);
        bar.append(b);
      } else if (!view.result?.wentToShowdown && view.result?.pots.some((p) => p.winners.includes(view.yourSeat)) && !seat.revealVoluntary && !seat.holeCards) {
        const b = h("button", { class: "mini-btn", type: "button" }, "Show cards");
        b.onclick = () => hs.show(true);
        bar.append(b);
      }
    }
    // Rebuy when short (cash only, between hands).
    if (view.config.format === "cash" && seat.chips < view.config.buyIn && view.stage !== "preflop" && view.stage !== "flop" && view.stage !== "turn" && view.stage !== "river") {
      const b = h("button", { class: "mini-btn on", type: "button" }, seat.chips <= 0 ? "Rebuy" : "Top up");
      b.onclick = () => hs.rebuy();
      bar.append(b);
    }
    // Sit out toggle.
    const so = h("button", { class: `mini-btn ${seat.sitOutNext ? "on" : ""}`, type: "button" }, seat.sitOutNext ? "Sitting out" : "Sit out");
    so.onclick = () => hs.sitOut(!seat.sitOutNext);
    bar.append(so);
  }

  return h("div", { class: "mine" },
    cardsEl,
    h("div", { class: "my-bar" },
      seat && h("span", { class: "my-name" }, seat.name),
      seat && h("span", { class: "my-chips tnum" }, chips(seat.chips)),
      bar,
    ),
  );
}

// --- Assemble --------------------------------------------------------------

export function renderTable(root: HTMLElement, view: ClientView, ui: UIState, hs: TableHandlers): void {
  const winSet = winningCards(view);
  const total = view.config.maxSeats;
  const anchor = view.yourSeat >= 0 ? view.yourSeat : 0;

  const felt = h("div", { class: "felt" });
  const center = h("div", { class: "center" },
    h("div", { class: "stage-label" }, STAGE_LABEL[view.stage] ?? ""),
    h("div", { class: "pot" }, h("span", { class: "chipbadge-dot" }), "Pot ", h("span", { class: "tnum" }, view.pot.toLocaleString())),
    boardRow(view, winSet),
    h("div", { class: "msg" }, centerMessage(view)),
  );

  const feltWrap = h("div", { class: "felt-wrap" }, felt, center);
  for (let i = 0; i < total; i++) {
    const relPos = (i - anchor + total) % total;
    const seatEl = h("div", { class: "seat", style: seatStyle(relPos, total) }, seatPod(view, i, winSet));
    feltWrap.append(seatEl);
  }

  const blinds = `${view.smallBlind}/${view.bigBlind}`;
  const meta = view.config.format === "tournament"
    ? `Tournament · blinds ${blinds}`
    : `Cash · blinds ${blinds}`;

  const copyBtn = h("button", { type: "button" }, "Copy link");
  copyBtn.onclick = () => hs.copyLink();
  const leaveBtn = h("button", { type: "button" }, "Leave");
  leaveBtn.onclick = () => hs.leave();

  clear(root).append(
    h("div", { class: "table-screen" },
      h("div", { class: "topbar" },
        h("span", { class: "tb-brand" }, "Hold'em"),
        h("span", { class: "tb-key" }, "Room ", h("b", {}, roomKeyFromHash()), copyBtn),
        h("span", { class: "tb-spacer" }),
        h("span", { class: "tb-meta" }, meta, view.spectatorCount > 0 ? ` · ${view.spectatorCount} watching` : "", " · hand ", h("b", {}, String(view.handNumber))),
        leaveBtn,
      ),
      feltWrap,
      h("div", { class: "dock" }, controls(view, ui, hs), mine(view, hs)),
    ),
  );
}

function roomKeyFromHash(): string {
  const m = location.hash.match(/room=([A-Za-z0-9-]+)/);
  return m ? m[1] : "—";
}
