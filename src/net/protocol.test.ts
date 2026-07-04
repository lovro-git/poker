import { describe, expect, it } from "vitest";
import { awardPots } from "../engine/pots";
import { createGame, defaultConfig, seatPlayer, startHand } from "../engine/game";
import type { GameState } from "../engine/types";
import { viewFor } from "./protocol";

function seededGame(): GameState {
  const g = createGame(defaultConfig({ maxSeats: 3 }));
  seatPlayer(g, "a", "Alice");
  seatPlayer(g, "b", "Bob");
  seatPlayer(g, "c", "Cara");
  startHand(g, () => 0.42); // deterministic-ish; contents don't matter here
  return g;
}

const ctx = (you: string) => ({
  you,
  isHost: you === "a",
  hostName: "Alice",
  connected: new Set(["a", "b", "c"]),
  spectatorCount: 0,
});

describe("viewFor — hole card privacy", () => {
  it("shows you only your own cards during a live hand", () => {
    const g = seededGame();
    const v = viewFor(g, ctx("a"));
    const mine = v.seats.find((s) => s?.playerId === "a")!;
    const others = v.seats.filter((s) => s && s.playerId !== "a");
    expect(mine.holeCards).not.toBeNull();
    expect(mine.holeCards).toHaveLength(2);
    for (const o of others) expect(o!.holeCards).toBeNull();
  });

  it("never leaks a folded player's cards", () => {
    const g = seededGame();
    g.seats[1]!.status = "folded";
    const v = viewFor(g, ctx("a")); // Alice viewing Bob (folded)
    expect(v.seats[1]!.holeCards).toBeNull();
  });

  it("reveals non-mucked contenders to everyone at a real showdown", () => {
    const g = seededGame();
    g.board = ["2c", "7d", "Th", "Js", "8h"];
    for (const s of g.seats) if (s) s.status = "allin";
    g.seats[0]!.committedHand = 100;
    g.seats[1]!.committedHand = 100;
    g.seats[2]!.committedHand = 100;
    g.result = awardPots(g);
    g.stage = "showdown";
    g.seats[2]!.mucked = true; // Cara mucks

    const v = viewFor(g, ctx("a"));
    expect(v.seats[0]!.holeCards).not.toBeNull(); // shown
    expect(v.seats[1]!.holeCards).not.toBeNull(); // shown
    expect(v.seats[2]!.holeCards).toBeNull(); // mucked -> hidden
  });

  it("keeps an uncalled winner hidden unless they choose to show", () => {
    const g = seededGame();
    g.seats[1]!.status = "folded";
    g.seats[2]!.status = "folded";
    g.result = awardPots(g); // Alice wins uncalled
    g.stage = "showdown";

    // Bob's view: Alice hidden.
    expect(viewFor(g, ctx("b")).seats[0]!.holeCards).toBeNull();

    // Alice voluntarily shows.
    g.seats[0]!.revealVoluntary = true;
    expect(viewFor(g, ctx("b")).seats[0]!.holeCards).not.toBeNull();
  });
});
