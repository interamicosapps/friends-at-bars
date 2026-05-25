import { freshShuffledDeck, rankValue, shuffle } from "./deck";
import { pickNextCard } from "./draw";
import { isCorrectGuess } from "./evaluate";
import type { Card, Guess, RideTheBusState } from "./types";
import { emptyRoundSlots, slotIndexForRound } from "./types";

function reshuffleIfNeeded(state: RideTheBusState): RideTheBusState {
  if (state.deck.length > 0) return state;

  const pool = [...state.discard];
  if (pool.length === 0) {
    return {
      ...state,
      deck: freshShuffledDeck(),
      discard: [],
    };
  }

  return {
    ...state,
    deck: shuffle(pool),
    discard: [],
  };
}

function drawForRound(state: RideTheBusState): RideTheBusState {
  let next = reshuffleIfNeeded(state);
  const card = pickNextCard(next.deck, {
    round: next.round,
    runCards: next.runCards,
    lastDrawnRank: next.lastDrawnRank,
  });

  if (!card) {
    next = {
      ...next,
      deck: freshShuffledDeck(),
      discard: [],
    };
    const retry = pickNextCard(next.deck, {
      round: next.round,
      runCards: next.runCards,
      lastDrawnRank: next.lastDrawnRank,
    });
    if (!retry) return next;
    const deck = next.deck.filter((c) => c.id !== retry.id);
    return {
      ...next,
      deck,
      current: retry,
      phase: "prompt",
      lastDrawnRank: rankValue(retry.rank),
    };
  }

  const deck = next.deck.filter((c) => c.id !== card.id);
  return {
    ...next,
    deck,
    current: card,
    phase: "prompt",
    lastDrawnRank: rankValue(card.rank),
  };
}

function collectRunCards(state: RideTheBusState): Card[] {
  const seen = new Set<string>();
  const out: Card[] = [];
  for (const c of [
    ...state.roundSlots.filter((x): x is Card => x !== null),
    ...state.runCards,
    ...(state.current ? [state.current] : []),
  ]) {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      out.push(c);
    }
  }
  return out;
}

export function initialState(): RideTheBusState {
  return {
    deck: freshShuffledDeck(),
    discard: [],
    current: null,
    roundSlots: emptyRoundSlots(),
    round: 0,
    runCards: [],
    phase: "prompt",
    lastDrawnRank: null,
    modal: "none",
    drinkCount: 0,
  };
}

function failRun(state: RideTheBusState): RideTheBusState {
  const failed = collectRunCards(state);
  return startRun({
    ...state,
    drinkCount: state.drinkCount + 1,
    discard: [...state.discard, ...failed],
    modal: "none",
  });
}

/** Begin or restart the four-round run from round 0 */
export function startRun(state: RideTheBusState): RideTheBusState {
  const base: RideTheBusState = {
    ...state,
    current: null,
    roundSlots: emptyRoundSlots(),
    round: 0,
    runCards: [],
    phase: "prompt",
    modal: "none",
  };
  return base;
}

export function dismissWinModal(): RideTheBusState {
  return initialState();
}

export function submitGuess(
  state: RideTheBusState,
  guess: Guess
): RideTheBusState {
  if (!state.current || state.modal !== "none") return state;
  if (guess.round !== state.round) return state;

  if (state.phase === "prompt") {
    const reveal: RideTheBusState = { ...state, phase: "reveal" };
    const correct = isCorrectGuess(
      guess,
      state.round,
      state.runCards,
      state.current
    );
    if (!correct) return failRun(reveal);
    return afterCorrectGuess(reveal);
  }

  return state;
}

function afterCorrectGuess(state: RideTheBusState): RideTheBusState {
  const card = state.current!;
  const idx = slotIndexForRound(state.round);
  const roundSlots = [...state.roundSlots] as RideTheBusState["roundSlots"];
  roundSlots[idx] = card;

  const runCards = [...state.runCards, card];
  const completed = state.round === 3;

  if (completed) {
    return {
      ...state,
      runCards,
      roundSlots,
      current: null,
      phase: "won",
      modal: "win",
    };
  }

  const nextRound = (state.round + 1) as 0 | 1 | 2 | 3;
  return {
    ...state,
    runCards,
    roundSlots,
    round: nextRound,
    phase: "roundComplete",
    current: null,
  };
}

/** After a correct guess: next-round button draws a new card then evaluates that guess */
export function applyGuess(
  state: RideTheBusState,
  guess: Guess
): RideTheBusState {
  if (state.modal !== "none") return state;

  if (state.phase === "roundComplete") {
    if (guess.round !== state.round) return state;
    const drawn = drawForRound({ ...state, phase: "prompt" });
    return submitGuess(drawn, guess);
  }

  if (
    state.phase === "prompt" &&
    state.round === 0 &&
    state.current === null
  ) {
    const drawn = drawForRound(state);
    return submitGuess(drawn, guess);
  }

  return submitGuess(state, guess);
}

export const ROUND_LABELS = [
  "Red or black",
  "Higher or lower",
  "Inside or outside",
  "Suit",
] as const;
