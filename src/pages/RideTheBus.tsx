import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { RideTheBusGameBoard } from "@/components/rideTheBus/RideTheBusGameBoard";
import { CardBack } from "@/components/rideTheBus/CardBack";
import { shellHeightImmersive } from "@/constants/layoutHeights";
import {
  RankedGate,
  RankedLeaderboard,
  submitRankedScore,
  useRankedEntry,
} from "@/features/ranked";
import {
  applyGuess,
  continueSessionAfterWin,
  enterFailInterstitial,
  finishFailInterstitial,
  initialState,
  startFreshSession,
  type Guess,
  type RideTheBusState,
} from "@/lib/rideTheBus";

type View = "lobby" | "rules" | "game";
type PlayMode = "casual" | "ranked";

const RULES_COPY = (
  <div className="space-y-3 text-sm leading-relaxed text-white/65">
    <p>
      Ride the Bus — four rounds. Each round you get one card face down, make a
      guess, then the card is revealed. Wrong guess: the drink counter goes up,
      you start again from round 1 (house rules decide how many sips per drink).
    </p>
    <ol className="list-decimal space-y-1 pl-5">
      <li>
        <strong className="text-white">Red or black</strong> — hearts and
        diamonds are red; clubs and spades are black.
      </li>
      <li>
        <strong className="text-white">Higher or lower</strong> — compared to
        your first card. Ace is high. Same rank loses either way.
      </li>
      <li>
        <strong className="text-white">Inside or outside</strong> — compared to
        the first two cards. Must be strictly between (not equal to either). Same
        rank as a boundary loses either way.
      </li>
      <li>
        <strong className="text-white">Suit</strong> — hearts, diamonds, clubs,
        or spades.
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

function SecondaryButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-xl border border-white/20 bg-transparent py-3.5 text-base font-semibold text-white/90 active:bg-white/5"
    >
      {children}
    </button>
  );
}

export default function RideTheBus() {
  const navigate = useNavigate();
  const [view, setView] = useState<View>("lobby");
  const [playMode, setPlayMode] = useState<PlayMode>("casual");
  const [state, setState] = useState<RideTheBusState>(() => initialState());
  const rankedVenueRef = useRef<string | null>(null);
  const rankedSubmittedRef = useRef(false);
  const beginGameRef = useRef<() => void>(() => {});

  const ranked = useRankedEntry({
    gameType: "ride-the-bus",
    onStartPlay: (venueName) => {
      rankedVenueRef.current = venueName;
      rankedSubmittedRef.current = false;
      setPlayMode("ranked");
      beginGameRef.current();
    },
  });

  const beginGame = useCallback(() => {
    setState(startFreshSession());
    setView("game");
  }, []);

  beginGameRef.current = beginGame;

  const submitRankedRun = useCallback(
    async (completed: boolean) => {
      const venue = rankedVenueRef.current;
      if (!venue || rankedSubmittedRef.current) return;
      rankedSubmittedRef.current = true;
      await submitRankedScore(ranked.userId, {
        gameType: "ride-the-bus",
        venueName: venue,
        drinkCount: 0,
        completed,
      });
      setPlayMode("casual");
      rankedVenueRef.current = null;
      await ranked.showLeaderboardAfterSubmit();
    },
    [ranked.userId, ranked.showLeaderboardAfterSubmit]
  );

  useEffect(() => {
    if (playMode !== "ranked" || state.modal !== "win" || rankedSubmittedRef.current) {
      return;
    }
    void submitRankedRun(true);
  }, [playMode, state.modal, submitRankedRun]);

  // Fail: brief headline (same window as Correct!), then reset and deal.
  useEffect(() => {
    if (state.phase !== "failing") return;
    const t = window.setTimeout(() => {
      setState((prev) => enterFailInterstitial(prev));
    }, 700);
    return () => window.clearTimeout(t);
  }, [state.phase]);

  useEffect(() => {
    if (state.phase !== "failInterstitial") return;
    const t = window.setTimeout(() => {
      setState((prev) => finishFailInterstitial(prev));
    }, 400);
    return () => window.clearTimeout(t);
  }, [state.phase]);

  const handleGuess = useCallback((guess: Guess) => {
    setState((prev) => applyGuess(prev, guess));
  }, []);

  const exitToLobbyOrGames = useCallback(() => {
    if (playMode === "ranked") {
      if (!rankedSubmittedRef.current) {
        void submitRankedRun(false);
      } else {
        setPlayMode("casual");
        rankedVenueRef.current = null;
        rankedSubmittedRef.current = false;
        setView("lobby");
        setState(initialState());
      }
      return;
    }
    setState(initialState());
    navigate("/games");
  }, [playMode, submitRankedRun, navigate]);

  const canGuess =
    state.modal === "none" &&
    state.phase === "prompt" &&
    state.current !== null;

  const trashTopCard =
    state.discard.length > 0
      ? state.discard[state.discard.length - 1]!
      : null;

  const won = state.modal === "win" || state.phase === "won";
  const isRankedWin = playMode === "ranked" && won;

  const rankedOverlays = (
    <>
      <RankedGate
        overlay={ranked.gateOverlay}
        onClose={ranked.closeGate}
        onAllowLocation={ranked.handleAllowLocation}
        locationBusy={ranked.locationBusy}
        showWebLocationHelp={ranked.showWebLocationHelp}
        nativeSettingsError={ranked.nativeSettingsError}
      />
      {ranked.isChecking && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 text-sm text-white"
          aria-busy="true"
        >
          Loading…
        </div>
      )}
    </>
  );

  if (ranked.screen === "leaderboard") {
    return (
      <>
        {rankedOverlays}
        <RankedLeaderboard
          gameType="ride-the-bus"
          entries={ranked.leaderboardEntries}
          userId={ranked.userId}
          loading={ranked.leaderboardLoading}
          onBack={() => {
            ranked.closeLeaderboard();
            setView("lobby");
            setState(initialState());
          }}
        />
      </>
    );
  }

  if (view === "lobby") {
    return (
      <>
        {rankedOverlays}
        <div
          className="flex flex-col overflow-hidden bg-black px-7 text-white"
          style={{ height: shellH }}
        >
          <div className="flex flex-shrink-0 items-center pt-1">
            <button
              type="button"
              onClick={() => navigate("/games")}
              className="flex h-11 w-11 items-center justify-center text-white"
              aria-label="Exit"
            >
              <span className="text-lg font-semibold" aria-hidden>
                ‹
              </span>
            </button>
          </div>

          <div className="mx-auto flex w-full max-w-lg flex-1 flex-col">
            <div className="flex flex-1 flex-col items-center justify-center gap-7">
              <h1 className="text-[2.125rem] font-bold tracking-tight">
                Ride The Bus
              </h1>
              <CardBack
                size="lg"
                label="Deck"
                className="shadow-[0_4px_16px_rgba(255,255,255,0.08)]"
              />
            </div>

            <div className="flex flex-col gap-3 pb-9">
              <button
                type="button"
                onClick={beginGame}
                className="w-full rounded-xl bg-green-500 py-4 text-base font-semibold text-black active:scale-[0.99]"
              >
                Start Game
              </button>
              <SecondaryButton onClick={() => void ranked.handleRankedClick()}>
                Ranked
              </SecondaryButton>
              <SecondaryButton onClick={() => setView("rules")}>
                Rules
              </SecondaryButton>
              <SecondaryButton onClick={() => navigate("/games")}>
                Exit
              </SecondaryButton>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (view === "rules") {
    return (
      <div
        className="flex flex-col overflow-hidden bg-black px-4 text-white"
        style={{ height: shellH }}
      >
        <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-6 px-3">
          <div>
            <h1 className="text-2xl font-bold">How to play</h1>
            <div className="mt-4">{RULES_COPY}</div>
          </div>
          <button
            type="button"
            onClick={() => setView("lobby")}
            className="w-full rounded-xl bg-green-500 py-4 text-base font-semibold text-black"
          >
            Return to Lobby
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {rankedOverlays}
      <div
        className="flex min-h-0 flex-col overflow-hidden bg-black px-1"
        style={{ height: shellH }}
      >
        <RideTheBusGameBoard
          deckCount={state.deck.length}
          trashTopCard={trashTopCard}
          roundSlots={state.roundSlots}
          round={state.round}
          phase={state.phase}
          current={state.current}
          won={won}
          canGuess={canGuess && !isRankedWin}
          showNewGame={won && playMode !== "ranked"}
          selectedGuess={state.selectedGuess}
          failHeadline={state.failHeadline}
          failSubtitle={state.failSubtitle}
          onGuess={handleGuess}
          onExit={exitToLobbyOrGames}
          onNewGame={() => {
            setState(continueSessionAfterWin(state));
            setView("game");
          }}
        />
      </div>
    </>
  );
}
