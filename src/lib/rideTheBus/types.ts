export type Suit = "hearts" | "diamonds" | "clubs" | "spades";

export type Rank =
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K"
  | "A";

export type Card = {
  id: string;
  suit: Suit;
  rank: Rank;
};

export type RoundIndex = 0 | 1 | 2 | 3;

export type ColorGuess = "red" | "black";
export type CompareGuess = "higher" | "lower";
export type RangeGuess = "inside" | "outside";

export type Guess =
  | { round: 0; value: ColorGuess }
  | { round: 1; value: CompareGuess }
  | { round: 2; value: RangeGuess }
  | { round: 3; value: Suit };

export type GamePhase = "prompt" | "reveal" | "roundComplete" | "won";

export type ModalKind = "none" | "win";

/** Four slots left→right; filled left→right as rounds 0→3 complete */
export type RoundSlots = [Card | null, Card | null, Card | null, Card | null];

export type RideTheBusState = {
  deck: Card[];
  /** Trash pile — reshuffled into deck when deck is empty */
  discard: Card[];
  current: Card | null;
  roundSlots: RoundSlots;
  round: RoundIndex;
  runCards: Card[];
  phase: GamePhase;
  lastDrawnRank: number | null;
  modal: ModalKind;
  /** Wrong guesses increment this; resets on Restart / new game from lobby */
  drinkCount: number;
};

export function emptyRoundSlots(): RoundSlots {
  return [null, null, null, null];
}

/** Slot index for a completed round (0→leftmost, 3→rightmost) */
export function slotIndexForRound(round: RoundIndex): 0 | 1 | 2 | 3 {
  return round;
}
