import { isRedSuit, rankValue } from "./deck";
import type { Card, Guess, RoundIndex } from "./types";

export function isCorrectGuess(
  guess: Guess,
  round: RoundIndex,
  runCards: Card[],
  current: Card
): boolean {
  if (guess.round !== round) return false;

  switch (round) {
    case 0: {
      const red = isRedSuit(current.suit);
      return guess.value === "red" ? red : !red;
    }
    case 1: {
      const first = runCards[0];
      if (!first) return false;
      const v1 = rankValue(first.rank);
      const v2 = rankValue(current.rank);
      if (v2 === v1) return false;
      return guess.value === "higher" ? v2 > v1 : v2 < v1;
    }
    case 2: {
      const c1 = runCards[0];
      const c2 = runCards[1];
      if (!c1 || !c2) return false;
      const v3 = rankValue(current.rank);
      const v1 = rankValue(c1.rank);
      const v2 = rankValue(c2.rank);
      if (v3 === v1 || v3 === v2) return false;
      const lo = Math.min(v1, v2);
      const hi = Math.max(v1, v2);
      const inside = v3 > lo && v3 < hi;
      return guess.value === "inside" ? inside : !inside;
    }
    case 3:
      return current.suit === guess.value;
    default:
      return false;
  }
}
