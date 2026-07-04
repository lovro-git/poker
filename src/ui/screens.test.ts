// @vitest-environment jsdom
import { describe, expect, it, beforeAll } from "vitest";
import { createGame, defaultConfig, seatPlayer, startHand } from "../engine/game";
import { viewFor } from "../net/protocol";
import { renderTable, type TableHandlers, type UIState } from "./screens";

const noop = () => {};
const handlers: TableHandlers = {
  act: noop, rebuy: noop, sitOut: noop, show: noop, start: noop, copyLink: noop, leave: noop, toggleLayout: noop, rerender: noop,
};

function freshUI(): UIState {
  return { raiseTo: 0, turnKey: "", prevBoardLen: 0, prevHand: 0 };
}

function viewWith(seated: number, maxSeats = 6) {
  const g = createGame(defaultConfig({ maxSeats }));
  for (let i = 0; i < seated; i++) seatPlayer(g, `p${i}`, `Player${i}`);
  if (seated >= 2) startHand(g, () => 0.4);
  const connected = new Set(Array.from({ length: seated }, (_, i) => `p${i}`));
  return viewFor(g, { you: "p0", isHost: true, hostName: "Player0", connected, spectatorCount: 0 });
}

describe("renderTable — oval table structure", () => {
  beforeAll(() => {
    location.hash = "#room=PKR-TEST";
  });

  it("renders arena, felt, footer, and one seat per maxSeats without throwing", () => {
    const root = document.createElement("div");
    renderTable(root, viewWith(3, 6), freshUI(), handlers);
    expect(root.querySelector(".arena")).not.toBeNull();
    expect(root.querySelector(".felt")).not.toBeNull();
    expect(root.querySelector(".footer")).not.toBeNull();
    expect(root.querySelectorAll(".seat")).toHaveLength(6); // all seats around the oval
    expect(root.querySelectorAll(".pod").length).toBeGreaterThanOrEqual(3);
  });

  it("puts the local player's own pod at the bottom-center of the oval (top ~89%)", () => {
    const root = document.createElement("div");
    renderTable(root, viewWith(3, 6), freshUI(), handlers);
    // Seat 0 is 'you'; anchor makes relPos 0 -> bottom-center.
    const mySeat = [...root.querySelectorAll<HTMLElement>(".seat")].find((s) =>
      s.querySelector(".pod.is-me"),
    );
    expect(mySeat).toBeTruthy();
    const style = mySeat!.getAttribute("style") ?? "";
    expect(style).toMatch(/left:50\.00%/);
    expect(style).toMatch(/top:85\.00%/);
  });

  it("does not render the local player's hole cards on the felt (they live in the footer)", () => {
    const root = document.createElement("div");
    renderTable(root, viewWith(3, 6), freshUI(), handlers);
    const mePod = root.querySelector(".pod.is-me")!;
    expect(mePod.querySelector(".pod-cards")).toBeNull(); // no cards in my oval pod
    expect(root.querySelector(".footer .my-cards")).not.toBeNull(); // cards are in the footer
  });

  it("renders the waiting state (single player) with an idle footer", () => {
    const root = document.createElement("div");
    renderTable(root, viewWith(1, 6), freshUI(), handlers);
    expect(root.querySelector(".controls--idle")).not.toBeNull();
    expect(root.querySelectorAll(".seat")).toHaveLength(6);
  });
});
