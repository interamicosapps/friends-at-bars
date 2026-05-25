import { rankValue } from "./deck";
import type { Card, RoundIndex } from "./types";

export type DrawContext = {
  round: RoundIndex;
  runCards: Card[];
  lastDrawnRank: number | null;
};

function filterCandidates(
  deck: Card[],
  predicate: (c: Card) => boolean
): Card[] {
  return deck.filter(predicate);
}

/**
 * Pick the next card from the deck with smart constraints when possible.
 * Relax constraints in order if no card matches.
 */
export function pickNextCard(deck: Card[], context: DrawContext): Card | null {
  if (deck.length === 0) return null;

  const lastRank = context.lastDrawnRank;
  const avoidConsecutive =
    lastRank !== null
      ? (c: Card) => rankValue(c.rank) !== lastRank
      : () => true;

  const avoidRound1 =
    context.round >= 1 && context.runCards[0]
      ? (c: Card) => c.rank !== context.runCards[0]!.rank
      : () => true;

  const avoidRound2 =
    context.round >= 2 && context.runCards[0] && context.runCards[1]
      ? (c: Card) =>
          c.rank !== context.runCards[0]!.rank &&
          c.rank !== context.runCards[1]!.rank
      : () => true;

  const tiers: ((c: Card) => boolean)[] = [
    (c) => avoidConsecutive(c) && avoidRound1(c) && avoidRound2(c),
    (c) => avoidConsecutive(c) && avoidRound1(c),
    (c) => avoidConsecutive(c),
    () => true,
  ];

  for (const pred of tiers) {
    const pool = filterCandidates(deck, pred);
    if (pool.length > 0) {
      const idx = Math.floor(Math.random() * pool.length);
      return pool[idx]!;
    }
  }

  return deck[0] ?? null;
}
