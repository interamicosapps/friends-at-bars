import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { RideTheBusGameBoard } from "@/components/rideTheBus/RideTheBusGameBoard";
import { shellHeightImmersive } from "@/constants/layoutHeights";
import {
  applyGuess,
  dismissWinModal,
  initialState,
  startRun,
  type ColorGuess,
  type CompareGuess,
  type Guess,
  type RangeGuess,
  type RideTheBusState,
  type Suit,
} from "@/lib/rideTheBus";

// Future: venue PvP + bar deal redemption

type View = "lobby" | "rules" | "game";

const RULES_COPY = (
  <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
    <p>
      Ride the Bus — four rounds. Each round you get one card face down, make a
      guess, then the card is revealed. Wrong guess: the drink counter goes up,
      you start again from round 1 (house rules decide how many sips per drink).
    </p>
    <ol className="list-decimal space-y-1 pl-5">
      <li>
        <strong className="text-foreground">Red or black</strong> — hearts and
        diamonds are red; clubs and spades are black.
      </li>
      <li>
        <strong className="text-foreground">Higher or lower</strong> — compared
        to your first card. Ace is high. Same rank loses either way.
      </li>
      <li>
        <strong className="text-foreground">Inside or outside</strong> — compared
        to the first two cards. Must be strictly between (not equal to either).
        Same rank as a boundary loses either way.
      </li>
      <li>
        <strong className="text-foreground">Suit</strong> — hearts, diamonds,
        clubs, or spades.
      </li>
    </ol>
    <p>
      When the deck runs out, discarded cards are reshuffled. The app avoids
      drawing the same rank twice in a row when possible, and avoids matching
      bound ranks on round 3 when possible.
    </p>
  </div>
);

const shellH = shellHeightImmersive();

const SUITS: { suit: Suit; label: string }[] = [
  { suit: "hearts", label: "Hearts" },
  { suit: "diamonds", label: "Diamonds" },
  { suit: "clubs", label: "Clubs" },
  { suit: "spades", label: "Spades" },
];

export default function RideTheBus() {
  const navigate = useNavigate();
  const [view, setView] = useState<View>("lobby");
  const [state, setState] = useState<RideTheBusState>(() => initialState());

  const beginGame = useCallback(() => {
    setState(startRun(initialState()));
    setView("game");
  }, []);

  const restartGame = useCallback(() => {
    setState(startRun(initialState()));
  }, []);

  const handleGuess = useCallback((guess: Guess) => {
    setState((prev) => applyGuess(prev, guess));
  }, []);

  const canGuess =
    state.modal === "none" &&
    (state.phase === "roundComplete" ||
      (state.phase === "prompt" &&
        (state.current !== null || state.round === 0)));

  const trashTopCard =
    state.discard.length > 0
      ? state.discard[state.discard.length - 1]!
      : null;

  const promptHint =
    state.phase === "roundComplete"
      ? "Make your next guess"
      : state.phase === "prompt"
        ? "Make your guess"
        : "Card revealed";

  if (view === "lobby") {
    return (
      <div
        className="flex flex-col overflow-hidden px-4"
        style={{ height: shellH }}
      >
        <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-8">
          <h1 className="text-3xl font-bold text-foreground">Ride the Bus</h1>
          <div className="flex flex-col gap-3">
            <Button size="lg" className="w-full" onClick={beginGame}>
              Play
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="w-full"
              onClick={() => setView("rules")}
            >
              Rules
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="w-full"
              onClick={() => navigate("/games")}
            >
              Exit
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (view === "rules") {
    return (
      <div
        className="flex flex-col overflow-hidden px-4"
        style={{ height: shellH }}
      >
        <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">How to play</h1>
            <div className="mt-4">{RULES_COPY}</div>
          </div>
          <Button size="lg" className="w-full" onClick={() => setView("lobby")}>
            Return to Lobby
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      {state.modal === "win" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="win-dialog-title"
        >
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
            <h2
              id="win-dialog-title"
              className="text-lg font-semibold text-foreground"
            >
              You rode the bus!
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              All four rounds correct. Nice run.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <Button
                className="w-full"
                onClick={() => {
                  setState(startRun(dismissWinModal()));
                  setView("game");
                }}
              >
                Play again
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setState(dismissWinModal());
                  setView("lobby");
                }}
              >
                Back to lobby
              </Button>
            </div>
          </div>
        </div>
      )}

      <div
        className="flex min-h-0 flex-col overflow-hidden px-3 pb-1 pt-2"
        style={{ height: shellH }}
      >
        <div className="flex min-h-0 flex-1 flex-col justify-between gap-2">
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto py-1">
            <RideTheBusGameBoard
              deckCount={state.deck.length}
              trashCount={state.discard.length}
              trashTopCard={trashTopCard}
              drinkCount={state.drinkCount}
              roundSlots={state.roundSlots}
            />
          </div>

          <div className="flex flex-shrink-0 flex-col gap-2 border-t border-border pt-3">
            <p className="text-center text-sm font-medium text-foreground">
              {promptHint}
            </p>
            <PromptButtons
              round={state.round}
              disabled={!canGuess}
              onColor={(v) => handleGuess({ round: 0, value: v })}
              onCompare={(v) => handleGuess({ round: 1, value: v })}
              onRange={(v) => handleGuess({ round: 2, value: v })}
              onSuit={(v) => handleGuess({ round: 3, value: v })}
            />
          </div>

          <nav
            className="flex flex-shrink-0 flex-wrap items-center justify-center gap-1 border-t border-border pt-2 pb-1 sm:gap-2"
            aria-label="Game actions"
          >
            <Button
              variant="outline"
              size="sm"
              className="min-w-0 flex-1 px-2 sm:px-3"
              onClick={() => setView("rules")}
            >
              Rules
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="min-w-0 flex-1 px-2 sm:px-3"
              onClick={restartGame}
            >
              Restart
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="min-w-0 flex-1 px-2 sm:px-3"
              onClick={() => navigate("/games")}
            >
              Exit
            </Button>
          </nav>
        </div>
      </div>
    </>
  );
}

function PromptButtons({
  round,
  disabled,
  onColor,
  onCompare,
  onRange,
  onSuit,
}: {
  round: 0 | 1 | 2 | 3;
  disabled: boolean;
  onColor: (v: ColorGuess) => void;
  onCompare: (v: CompareGuess) => void;
  onRange: (v: RangeGuess) => void;
  onSuit: (v: Suit) => void;
}) {
  if (round === 0) {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="lg"
          className="w-full"
          disabled={disabled}
          onClick={() => onColor("red")}
        >
          Red
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="w-full"
          disabled={disabled}
          onClick={() => onColor("black")}
        >
          Black
        </Button>
      </div>
    );
  }

  if (round === 1) {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="lg"
          className="w-full"
          disabled={disabled}
          onClick={() => onCompare("higher")}
        >
          Higher
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="w-full"
          disabled={disabled}
          onClick={() => onCompare("lower")}
        >
          Lower
        </Button>
      </div>
    );
  }

  if (round === 2) {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="lg"
          className="w-full"
          disabled={disabled}
          onClick={() => onRange("inside")}
        >
          Inside
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="w-full"
          disabled={disabled}
          onClick={() => onRange("outside")}
        >
          Outside
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {SUITS.map(({ suit, label }) => (
        <Button
          key={suit}
          size="sm"
          variant="outline"
          className="w-full"
          disabled={disabled}
          onClick={() => onSuit(suit)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
