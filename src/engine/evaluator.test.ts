import { describe, expect, it } from "vitest";
import { categoryName, compareScore, evaluate } from "./evaluator";

/** Convenience: evaluate a space-separated hand string. */
const h = (s: string) => evaluate(s.split(" "));

describe("evaluate — categories", () => {
  it("names each category correctly", () => {
    expect(categoryName(h("As Ks Qs Js Ts"))).toBe("Straight Flush");
    expect(categoryName(h("As Ah Ad Ac Kd"))).toBe("Four of a Kind");
    expect(categoryName(h("As Ah Ad Kc Kd"))).toBe("Full House");
    expect(categoryName(h("As Ks Qs Js 9s"))).toBe("Flush");
    expect(categoryName(h("As Kh Qd Jc Ts"))).toBe("Straight");
    expect(categoryName(h("As Ah Ad Kc Qd"))).toBe("Three of a Kind");
    expect(categoryName(h("As Ah Kd Kc Qd"))).toBe("Two Pair");
    expect(categoryName(h("As Ah Kd Qc Jd"))).toBe("Pair");
    expect(categoryName(h("As Kh Qd Jc 9s"))).toBe("High Card");
  });

  it("recognizes the wheel (A-2-3-4-5) as a five-high straight", () => {
    const wheel = h("As 2h 3d 4c 5s");
    expect(categoryName(wheel)).toBe("Straight");
    // Five-high straight loses to six-high straight.
    expect(compareScore(wheel, h("2s 3h 4d 5c 6s"))).toBeLessThan(0);
  });
});

describe("evaluate — ordering", () => {
  it("orders categories: SF > quads > boat > flush > straight > trips > 2pair > pair > high", () => {
    const ranked = [
      "As Ks Qs Js Ts", // straight flush
      "9s 9h 9d 9c 2d", // quads
      "8s 8h 8d 3c 3d", // full house
      "As Js 9s 5s 2s", // flush
      "9c 8d 7h 6s 5c", // straight
      "7s 7h 7d 4c 2d", // trips
      "Ks Kh 9d 9c 4d", // two pair
      "5s 5h Kd 9c 2d", // pair
      "As Qh 9d 6c 2s", // high card
    ].map(h);
    for (let i = 0; i < ranked.length - 1; i++) {
      expect(compareScore(ranked[i], ranked[i + 1])).toBeGreaterThan(0);
    }
  });

  it("breaks ties by kicker", () => {
    expect(compareScore(h("As Ah Kd Qc 2s"), h("As Ah Kd Jc 2s"))).toBeGreaterThan(0);
    expect(compareScore(h("As Ah Kd Qc 2s"), h("As Ah Kd Qc 3s"))).toBeLessThan(0);
  });
});

describe("evaluate — 7-card best five", () => {
  it("finds the flush hidden in 7 cards", () => {
    expect(categoryName(evaluate("As Ks 9s 4s 2s 7h 8d".split(" ")))).toBe("Flush");
  });

  it("finds the nut straight across hole + board", () => {
    // board: 7h 8d 9s Ts 2c, hole: Jh Qc -> Q-high straight
    expect(categoryName(evaluate("Jh Qc 7h 8d 9s Ts 2c".split(" ")))).toBe("Straight");
  });
});
