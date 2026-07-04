import { describe, expect, it } from "vitest";
import {
  applyAction,
  createGame,
  defaultConfig,
  isHandInProgress,
  legalActions,
  seatPlayer,
  startHand,
} from "./game";
import { awardPots, buildPots } from "./pots";
import type { GameState } from "./types";

function table(seats: number, cfg = {}): GameState {
  const g = createGame(defaultConfig({ maxSeats: seats, ...cfg }));
  for (let i = 0; i < seats; i++) seatPlayer(g, `p${i}`, `P${i}`);
  return g;
}

describe("blinds & position", () => {
  it("heads-up: button posts SB, acts first pre-flop", () => {
    const g = table(2, { smallBlind: 10, bigBlind: 20 });
    startHand(g);
    expect(g.buttonSeat).toBe(0);
    expect(g.seats[0]!.committedRound).toBe(10); // button = SB
    expect(g.seats[1]!.committedRound).toBe(20); // BB
    expect(g.currentBet).toBe(20);
    expect(g.toActSeat).toBe(0); // button acts first heads-up
  });

  it("3-handed: SB left of button, BB next, button acts first pre-flop", () => {
    const g = table(3, { smallBlind: 10, bigBlind: 20 });
    startHand(g);
    expect(g.buttonSeat).toBe(0);
    expect(g.seats[1]!.committedRound).toBe(10); // SB
    expect(g.seats[2]!.committedRound).toBe(20); // BB
    expect(g.toActSeat).toBe(0); // UTG = button in 3-handed
  });
});

describe("betting legality", () => {
  it("rejects a raise below the minimum", () => {
    const g = table(3);
    startHand(g);
    // currentBet 20, min raise to 40. A raise to 30 is illegal.
    expect(applyAction(g, 0, { type: "raise", to: 30 })).toBe(false);
    expect(applyAction(g, 0, { type: "raise", to: 40 })).toBe(true);
    expect(g.currentBet).toBe(40);
    expect(g.lastRaiseSize).toBe(20);
  });

  it("a full raise reopens action for players who already called", () => {
    const g = table(3);
    startHand(g); // toAct 0
    applyAction(g, 0, { type: "call" }); // button calls 20
    applyAction(g, 1, { type: "call" }); // SB calls to 20
    // BB now has the option; BB raises.
    expect(g.toActSeat).toBe(2);
    applyAction(g, 2, { type: "raise", to: 60 });
    // Button must act again.
    expect(g.toActSeat).toBe(0);
    expect(g.seats[0]!.hasActedThisRound).toBe(false);
  });

  it("cannot check when facing a bet", () => {
    const g = table(3);
    startHand(g);
    expect(legalActions(g, 0)!.canCheck).toBe(false);
    expect(applyAction(g, 0, { type: "check" })).toBe(false);
  });
});

describe("hand resolution", () => {
  it("awards an uncalled pot without showdown when all fold", () => {
    const g = table(3, { smallBlind: 10, bigBlind: 20 });
    startHand(g);
    applyAction(g, 0, { type: "fold" }); // button folds
    applyAction(g, 1, { type: "fold" }); // SB folds
    expect(g.stage).toBe("showdown");
    expect(g.result!.wentToShowdown).toBe(false);
    // BB wins SB(10) + BB(20) = 30; started 1000, posted 20.
    expect(g.seats[2]!.chips).toBe(1000 - 20 + 30);
  });

  it("plays a full hand of checks/calls to showdown with 5 board cards", () => {
    const g = table(3);
    startHand(g);
    let guard = 0;
    while (isHandInProgress(g) && guard++ < 200) {
      const seat = g.toActSeat;
      const la = legalActions(g, seat)!;
      applyAction(g, seat, la.canCheck ? { type: "check" } : { type: "call" });
    }
    expect(g.stage).toBe("showdown");
    expect(g.board).toHaveLength(5);
    expect(g.result).not.toBeNull();
    // Chip conservation: total chips constant.
    const total = g.seats.reduce((s, x) => s + (x?.chips ?? 0), 0);
    expect(total).toBe(3000);
  });
});

describe("side pots (buildPots)", () => {
  it("layers a short all-in into a main + side pot", () => {
    const pots = buildPots([
      { seat: 0, amount: 100, folded: false },
      { seat: 1, amount: 100, folded: false },
      { seat: 2, amount: 50, folded: false },
    ]);
    expect(pots).toEqual([
      { amount: 150, eligible: [0, 1, 2] },
      { amount: 100, eligible: [0, 1] },
    ]);
  });

  it("keeps a folded player's chips as dead money but excludes them from eligibility", () => {
    const pots = buildPots([
      { seat: 0, amount: 100, folded: false },
      { seat: 1, amount: 100, folded: false },
      { seat: 2, amount: 40, folded: true }, // folded short stack
    ]);
    // 40*3 = 120 (eligible 0,1) then 60*2 = 120 (eligible 0,1); same eligible set,
    // so the two layers merge into a single 240 pot.
    expect(pots).toEqual([{ amount: 240, eligible: [0, 1] }]);
  });
});

describe("awardPots — showdown", () => {
  it("awards main and side pots correctly on a multi-way all-in", () => {
    const g = table(3);
    g.buttonSeat = 0;
    g.board = ["2c", "7d", "Th", "Js", "8h"];
    // seat0 trip aces, seat1 pair kings, seat2 pair queens.
    g.seats[0]!.holeCards = ["Ah", "Ad"];
    g.seats[1]!.holeCards = ["Kh", "Kd"];
    g.seats[2]!.holeCards = ["Qh", "Qd"];
    g.seats[0]!.committedHand = 100;
    g.seats[1]!.committedHand = 100;
    g.seats[2]!.committedHand = 50; // short all-in
    for (const s of g.seats) if (s) s.status = "allin";

    const res = awardPots(g);
    // Board has no ace/king/queen pairs to change this: seat0 wins both pots.
    expect(res.wentToShowdown).toBe(true);
    expect(res.payouts[0]).toBe(250); // 150 main + 100 side
    expect(res.payouts[1]).toBeUndefined();
    expect(res.payouts[2]).toBeUndefined();
  });

  it("splits a tied pot and gives the odd chip to the first seat left of the button", () => {
    const g = table(3);
    g.buttonSeat = 0;
    g.board = ["Qc", "Jd", "Tc", "2h", "3s"];
    g.seats[1]!.holeCards = ["Ah", "Kh"]; // broadway straight
    g.seats[2]!.holeCards = ["As", "Ks"]; // identical broadway straight
    g.seats[0]!.holeCards = ["5c", "5d"];
    g.seats[0]!.committedHand = 1; // folded dead money
    g.seats[1]!.committedHand = 2;
    g.seats[2]!.committedHand = 2;
    g.seats[0]!.status = "folded";
    g.seats[1]!.status = "allin";
    g.seats[2]!.status = "allin";

    const res = awardPots(g);
    // Pot = 5, split between seats 1 & 2; odd chip to seat 1 (first left of button 0).
    expect(res.payouts[1]).toBe(3);
    expect(res.payouts[2]).toBe(2);
  });
});
