import { freshShuffledDeck, rankValue, shuffle } from "./deck";
import { pickNextCard } from "./draw";
import { isCorrectGuess } from "./evaluate";
import { ALL_FAIL_HEADLINES } from "./failMessages";
import type { Card, Guess, RideTheBusState } from "./types";
import { emptyRoundSlots, slotIndexForRound } from "./types";

function nextFailHeadline(state: RideTheBusState): {
  headline: string;
  failCycleIndex: number;
} {
  const pool = ALL_FAIL_HEADLINES;
  const idx = state.failCycleIndex % pool.length;
  return {
    headline: pool[idx]!,
    failCycleIndex: state.failCycleIndex + 1,
  };
}
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
      selectedGuess: null,
      failHeadline: null,
      failSubtitle: null,
      pendingFailSubtitle: null,
    };
  }

  const deck = next.deck.filter((c) => c.id !== card.id);
  return {
    ...next,
    deck,
    current: card,
    phase: "prompt",
    lastDrawnRank: rankValue(card.rank),
    selectedGuess: null,
    failHeadline: null,
    failSubtitle: null,
    pendingFailSubtitle: null,
  };
}

function collectRunCards(state: RideTheBusState): Card[] {
  const seen = new Set<string>();
  const out: Card[] = [];
  for (const c of [
    ...state.roundSlots.filter((x): x is Card => x !== null),
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
    selectedGuess: null,
    failHeadline: null,
    failSubtitle: null,
    pendingFailSubtitle: null,
    failCycleIndex: 0,
    tieFailCycleIndex: 0,
  };
}

/** Begin or restart the four-round run from round 0 (keeps deck/discard). */
export function startRun(state: RideTheBusState): RideTheBusState {
  return {
    ...state,
    current: null,
    roundSlots: emptyRoundSlots(),
    round: 0,
    runCards: [],
    phase: "prompt",
    modal: "none",
    selectedGuess: null,
    failHeadline: null,
    failSubtitle: null,
    pendingFailSubtitle: null,
  };
}

/** Fresh 52 from lobby. */
export function startFreshSession(): RideTheBusState {
  return drawForRound(startRun(initialState()));
}

/** Win → next run keeps remaining deck/trash for this visit. */
export function continueSessionAfterWin(state: RideTheBusState): RideTheBusState {
  return drawForRound(
    startRun({
      ...state,
      modal: "none",
    })
  );
}

/** @deprecated use continueSessionAfterWin / startFreshSession */
export function dismissWinModal(): RideTheBusState {
  return initialState();
}

/**
 * Synchronous guess evaluation for Cap UI.
 * Wrong answers enter `failing` (short banner) — call `enterFailInterstitial`
 * then `finishFailInterstitial` from the UI timers.
 */
export function applyGuess(
  state: RideTheBusState,
  guess: Guess
): RideTheBusState {
  if (state.modal !== "none") return state;
  if (
    state.phase === "failing" ||
    state.phase === "failInterstitial" ||
    state.phase === "won"
  ) {
    return state;
  }

  let working = state;

  if (state.phase === "roundComplete") {
    if (guess.round !== state.round) return state;
    working = drawForRound({ ...state, phase: "prompt" });
  } else if (
    state.phase === "prompt" &&
    state.round === 0 &&
    state.current === null
  ) {
    working = drawForRound(state);
  }

  if (!working.current || guess.round !== working.round) return working;

  const correct = isCorrectGuess(
    guess,
    working.round,
    working.runCards,
    working.current
  );

  if (!correct) {
    const { headline, failCycleIndex } = nextFailHeadline(working);
    return {
      ...working,
      selectedGuess: guess,
      phase: "failing",
      failHeadline: headline,
      failSubtitle: null,
      pendingFailSubtitle: null,
      failCycleIndex,
    };
  }

  return afterCorrectGuess({
    ...working,
    selectedGuess: guess,
    phase: "reveal",
  });
}

export function enterFailInterstitial(state: RideTheBusState): RideTheBusState {
  if (state.phase !== "failing") return state;
  const failed = collectRunCards(state);
  return {
    ...state,
    discard: [...state.discard, ...failed],
    current: null,
    roundSlots: emptyRoundSlots(),
    runCards: [],
    round: 0,
    selectedGuess: null,
    lastDrawnRank: null,
    phase: "failInterstitial",
    failHeadline: state.failHeadline,
    failSubtitle: null,
    pendingFailSubtitle: null,
  };
}

export function finishFailInterstitial(state: RideTheBusState): RideTheBusState {
  if (state.phase !== "failInterstitial") return state;
  return drawForRound({
    ...state,
    failHeadline: null,
    failSubtitle: null,
  });
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
      selectedGuess: null,
      failHeadline: null,
      failSubtitle: null,
    };
  }

  const nextRound = (state.round + 1) as 0 | 1 | 2 | 3;
  const advanced = {
    ...state,
    runCards,
    roundSlots,
    round: nextRound,
    phase: "roundComplete" as const,
    current: null,
    selectedGuess: null,
  };
  return drawForRound({ ...advanced, phase: "prompt" });
}

export const ROUND_LABELS = [
  "Red or black",
  "Higher or lower",
  "Inside or outside",
  "Suit",
] as const;
