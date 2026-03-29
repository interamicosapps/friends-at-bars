import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { shellHeightImmersive } from "@/constants/layoutHeights";

/**
 * Mega Toe — Ultimate tic-tac-toe (mechanics aligned with temp-ttt).
 */

type Player = "O" | "X";
type MiniOutcome = "active" | Player | "draw";
type MetaCell = null | Player | "draw";
type GameMode = "pvp" | "computer_easy" | "computer_hard";

const LINES: [number, number, number][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

function emptyMinis(): (Player | null)[][] {
  return Array.from({ length: 9 }, () => Array<Player | null>(9).fill(null));
}

function miniResult(cells: (Player | null)[]): Player | "draw" | null {
  for (const [a, b, c] of LINES) {
    const v = cells[a];
    if (v && v === cells[b] && v === cells[c]) return v;
  }
  if (cells.every((c) => c !== null)) return "draw";
  return null;
}

function metaWinner(meta: MetaCell[]): Player | null {
  for (const [a, b, c] of LINES) {
    const x = meta[a];
    const y = meta[b];
    const z = meta[c];
    if (x === "O" && y === "O" && z === "O") return "O";
    if (x === "X" && y === "X" && z === "X") return "X";
  }
  return null;
}

function metaFullyResolved(meta: MetaCell[]): boolean {
  return meta.every((m) => m !== null);
}

function sendToMetaIndex(smallIdx: number): number {
  const sr = Math.floor(smallIdx / 3);
  const sc = smallIdx % 3;
  return sr * 3 + sc;
}

type View = "lobby" | "rules" | "game";

const RULES_COPY = (
  <p className="text-sm leading-relaxed text-muted-foreground">
    Ultimate tic-tac-toe: nine small boards in one grid.{" "}
    <strong className="text-foreground">O</strong> goes first. Moves send the
    opponent to the matching big cell; finished targets mean a free move. Against
    the computer you are <strong className="text-foreground">O</strong> and the
    app plays <strong className="text-foreground">X</strong>.{" "}
    <strong className="text-foreground">Computer – Easy</strong> uses simple
    heuristics; <strong className="text-foreground">Computer – Hard</strong>{" "}
    also avoids obvious mistakes and favors stronger meta play.
  </p>
);

type LastMove = { bigIdx: number; smallIdx: number; player: Player };

type GameState = {
  minis: (Player | null)[][];
  miniStatus: MiniOutcome[];
  meta: MetaCell[];
  nextTarget: number | null;
  currentPlayer: Player;
  gameResult: "playing" | Player | "draw";
  lastMove: LastMove | null;
};

function initialGameState(): GameState {
  return {
    minis: emptyMinis(),
    miniStatus: Array<MiniOutcome>(9).fill("active"),
    meta: Array<MetaCell>(9).fill(null),
    nextTarget: null,
    currentPlayer: "O",
    gameResult: "playing",
    lastMove: null,
  };
}

function computeNextState(
  prev: GameState,
  bigIdx: number,
  smallIdx: number
): GameState | null {
  if (prev.gameResult !== "playing") return null;
  if (prev.miniStatus[bigIdx] !== "active") return null;
  if (prev.nextTarget !== null && bigIdx !== prev.nextTarget) return null;
  if (prev.minis[bigIdx][smallIdx] !== null) return null;

  const nextMinis = prev.minis.map((board, i) =>
    i === bigIdx ? [...board] : board
  );
  nextMinis[bigIdx][smallIdx] = prev.currentPlayer;

  const nextMiniStatus = [...prev.miniStatus] as MiniOutcome[];
  const nextMeta = [...prev.meta] as MetaCell[];
  const outcome = miniResult(nextMinis[bigIdx]);

  if (outcome !== null) {
    nextMiniStatus[bigIdx] = outcome;
    nextMeta[bigIdx] = outcome;
  }

  const gw = metaWinner(nextMeta);
  const full = metaFullyResolved(nextMeta);
  let gameResult: "playing" | Player | "draw" = prev.gameResult;
  if (gw) gameResult = gw;
  else if (full) gameResult = "draw";

  const nextPlayer: Player = prev.currentPlayer === "O" ? "X" : "O";

  let nextTarget: number | null = null;
  if (gameResult === "playing") {
    const sendTo = sendToMetaIndex(smallIdx);
    nextTarget = nextMiniStatus[sendTo] === "active" ? sendTo : null;
  }

  return {
    minis: nextMinis,
    miniStatus: nextMiniStatus,
    meta: nextMeta,
    nextTarget,
    currentPlayer: nextPlayer,
    gameResult,
    lastMove: {
      bigIdx,
      smallIdx,
      player: prev.currentPlayer,
    },
  };
}

function getValidMoves(prev: GameState): { bigIdx: number; smallIdx: number }[] {
  const out: { bigIdx: number; smallIdx: number }[] = [];
  for (let b = 0; b < 9; b++) {
    if (prev.miniStatus[b] !== "active") continue;
    if (prev.nextTarget !== null && b !== prev.nextTarget) continue;
    for (let s = 0; s < 9; s++) {
      if (prev.minis[b][s] === null) out.push({ bigIdx: b, smallIdx: s });
    }
  }
  return out;
}

function pickAiMoveEasy(prev: GameState): { bigIdx: number; smallIdx: number } | null {
  const moves = getValidMoves(prev);
  if (moves.length === 0) return null;

  for (const m of moves) {
    const cells = [...prev.minis[m.bigIdx]];
    cells[m.smallIdx] = "X";
    if (miniResult(cells) === "X") return m;
  }

  for (const m of moves) {
    const cells = [...prev.minis[m.bigIdx]];
    if (cells[m.smallIdx] !== null) continue;
    cells[m.smallIdx] = "O";
    if (miniResult(cells) === "O") return m;
  }

  return moves[Math.floor(Math.random() * moves.length)]!;
}

function oCanWinInOne(state: GameState): boolean {
  if (state.gameResult !== "playing" || state.currentPlayer !== "O") return false;
  for (const m of getValidMoves(state)) {
    const next = computeNextState(state, m.bigIdx, m.smallIdx);
    if (next?.gameResult === "O") return true;
  }
  return false;
}

function oHasMiniWinThreat(
  board: (Player | null)[],
  miniStatusForBoard: MiniOutcome
): boolean {
  if (miniStatusForBoard !== "active") return false;
  for (let s = 0; s < 9; s++) {
    if (board[s] !== null) continue;
    const cells = [...board];
    cells[s] = "O";
    if (miniResult(cells) === "O") return true;
  }
  return false;
}

function countMetaThreats(meta: MetaCell[]): number {
  let n = 0;
  for (const [a, b, c] of LINES) {
    const va = meta[a];
    const vb = meta[b];
    const vc = meta[c];
    const xCount = [va, vb, vc].filter((x) => x === "X").length;
    const openCount = [va, vb, vc].filter((x) => x === null).length;
    if (xCount === 2 && openCount === 1) n++;
  }
  return n;
}

function pickRandomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function pickAiMoveHard(prev: GameState): { bigIdx: number; smallIdx: number } | null {
  const moves = getValidMoves(prev);
  if (moves.length === 0) return null;

  for (const m of moves) {
    const next = computeNextState(prev, m.bigIdx, m.smallIdx);
    if (next?.gameResult === "X") return m;
  }

  for (const m of moves) {
    const cells = [...prev.minis[m.bigIdx]];
    cells[m.smallIdx] = "X";
    if (miniResult(cells) === "X") return m;
  }

  for (const m of moves) {
    const cells = [...prev.minis[m.bigIdx]];
    if (cells[m.smallIdx] !== null) continue;
    cells[m.smallIdx] = "O";
    if (miniResult(cells) === "O") return m;
  }

  const safeMoves: { bigIdx: number; smallIdx: number }[] = [];
  for (const m of moves) {
    const next = computeNextState(prev, m.bigIdx, m.smallIdx);
    if (!next) continue;
    if (next.gameResult !== "playing") {
      if (next.gameResult === "O") continue;
      safeMoves.push(m);
      continue;
    }
    if (!oCanWinInOne(next)) safeMoves.push(m);
  }
  const pool = safeMoves.length > 0 ? safeMoves : moves;

  const BONUS_MINI_WON = 100;
  const BONUS_META_THREAT = 12;
  const BONUS_CENTER = 4;
  const BONUS_CORNER = 2;
  const PENALTY_SEND_TO_ATTACK = -55;

  type Move = (typeof moves)[number];
  const scored: { m: Move; score: number }[] = pool.map((m) => {
    const next = computeNextState(prev, m.bigIdx, m.smallIdx)!;
    let score = 0;
    if (
      prev.miniStatus[m.bigIdx] === "active" &&
      next.miniStatus[m.bigIdx] === "X"
    ) {
      score += BONUS_MINI_WON;
    }
    score += countMetaThreats(next.meta) * BONUS_META_THREAT;
    if (m.smallIdx === 4) score += BONUS_CENTER;
    else if ([0, 2, 6, 8].includes(m.smallIdx)) score += BONUS_CORNER;

    const targetBoard = sendToMetaIndex(m.smallIdx);
    if (
      next.gameResult === "playing" &&
      next.nextTarget === targetBoard &&
      oHasMiniWinThreat(next.minis[targetBoard], next.miniStatus[targetBoard])
    ) {
      score += PENALTY_SEND_TO_ATTACK;
    }
    return { m, score };
  });

  let best = scored[0]!.score;
  const bestMoves: typeof scored = [];
  for (const s of scored) {
    if (s.score > best) {
      best = s.score;
      bestMoves.length = 0;
      bestMoves.push(s);
    } else if (s.score === best) {
      bestMoves.push(s);
    }
  }
  return pickRandomFrom(bestMoves).m;
}

function Mark({
  player,
  size = "sm",
  className,
}: {
  player: Player;
  size?: "sm" | "lg";
  className?: string;
}) {
  const dim =
    size === "lg" ? "h-[min(72%,4rem)] w-[min(72%,4rem)]" : "h-[65%] w-[65%]";
  if (player === "O") {
    return (
      <svg
        viewBox="0 0 32 32"
        className={cn(dim, className)}
        fill="none"
        aria-hidden
      >
        <circle
          cx="16"
          cy="16"
          r="10"
          className="stroke-current"
          strokeWidth="3"
        />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn(dim, className)}
      fill="none"
      aria-hidden
    >
      <path
        d="M8 8l16 16M24 8L8 24"
        className="stroke-current"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

const shellH = shellHeightImmersive();

export default function MegaToe() {
  const navigate = useNavigate();
  const [view, setView] = useState<View>("lobby");
  const [gameMode, setGameMode] = useState<GameMode>("computer_easy");
  const [modeModalOpen, setModeModalOpen] = useState(false);
  const [state, setState] = useState<GameState>(() => initialGameState());

  const restartGame = useCallback(() => {
    setState(initialGameState());
  }, []);

  const applyMove = useCallback((bigIdx: number, smallIdx: number) => {
    setState((prev) => computeNextState(prev, bigIdx, smallIdx) ?? prev);
  }, []);

  useEffect(() => {
    if (
      view !== "game" ||
      (gameMode !== "computer_easy" && gameMode !== "computer_hard") ||
      state.gameResult !== "playing" ||
      state.currentPlayer !== "X"
    ) {
      return;
    }

    const id = window.setTimeout(() => {
      setState((prev) => {
        if (
          prev.gameResult !== "playing" ||
          prev.currentPlayer !== "X"
        ) {
          return prev;
        }
        const move =
          gameMode === "computer_hard"
            ? pickAiMoveHard(prev)
            : pickAiMoveEasy(prev);
        if (!move) return prev;
        return computeNextState(prev, move.bigIdx, move.smallIdx) ?? prev;
      });
    }, 350);

    return () => clearTimeout(id);
  }, [view, gameMode, state.currentPlayer, state.gameResult]);

  const playing = state.gameResult === "playing";

  const humanCanClick =
    gameMode === "pvp" ||
    ((gameMode === "computer_easy" || gameMode === "computer_hard") &&
      state.currentPlayer === "O");

  const modeTitleSuffix =
    gameMode === "pvp"
      ? "— Local PvP"
      : gameMode === "computer_easy"
        ? "— Computer – Easy"
        : "— Computer – Hard";

  const outcomeLine =
    state.gameResult === "playing"
      ? null
      : state.gameResult === "draw"
        ? "Draw."
        : `${state.gameResult} wins.`;

  if (view === "lobby") {
    return (
      <div
        className="flex flex-col overflow-hidden px-4"
        style={{ height: shellH }}
      >
        <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-8">
          <h1 className="text-3xl font-bold text-foreground">Mega Toe</h1>
          <div className="flex flex-col gap-3">
            <Button size="lg" className="w-full" onClick={() => setView("game")}>
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
      {modeModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mode-dialog-title"
          onClick={() => setModeModalOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="mode-dialog-title"
              className="text-lg font-semibold text-foreground"
            >
              Mode
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose how to play. Starting a new mode applies on your next
              restart or new round.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <Button
                className="w-full"
                variant={gameMode === "pvp" ? "default" : "outline"}
                onClick={() => {
                  setGameMode("pvp");
                  setModeModalOpen(false);
                }}
              >
                Local PvP
              </Button>
              <Button
                className="w-full"
                variant={gameMode === "computer_easy" ? "default" : "outline"}
                onClick={() => {
                  setGameMode("computer_easy");
                  setModeModalOpen(false);
                }}
              >
                Computer – Easy
              </Button>
              <Button
                className="w-full"
                variant={gameMode === "computer_hard" ? "default" : "outline"}
                onClick={() => {
                  setGameMode("computer_hard");
                  setModeModalOpen(false);
                }}
              >
                Computer – Hard
              </Button>
            </div>
            <Button
              variant="ghost"
              className="mt-4 w-full"
              onClick={() => setModeModalOpen(false)}
            >
              Close
            </Button>
          </div>
        </div>
      )}

      <div
        className="flex flex-col overflow-hidden px-2 sm:px-3"
        style={{ height: shellH }}
      >
        <header className="flex flex-shrink-0 items-baseline gap-2 pt-1">
          <h1 className="text-lg font-bold text-foreground sm:text-xl">
            Mega Toe
          </h1>
          <span className="min-w-0 truncate text-sm font-medium text-muted-foreground sm:text-base">
            {modeTitleSuffix}
          </span>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          {outcomeLine && (
            <p
              className="flex-shrink-0 py-1 text-center text-sm font-medium text-foreground"
              role="status"
              aria-live="polite"
            >
              {outcomeLine}
            </p>
          )}

          <div className="flex min-h-0 flex-1 items-center justify-center py-1">
            <div
              className="h-full w-full max-h-full min-h-0 max-w-full rounded-lg p-0.5"
            >
              <div
                className="mx-auto grid aspect-square h-full w-full max-h-full grid-cols-3 gap-0.5 sm:gap-1"
                style={{ maxWidth: "min(100vw - 1rem, 100%)" }}
                role="grid"
                aria-label="Mega tic-tac-toe board"
              >
                {Array.from({ length: 9 }, (_, bigIdx) => {
                  const miniLegalForTurn =
                    playing &&
                    state.miniStatus[bigIdx] === "active" &&
                    (state.nextTarget === null ||
                      state.nextTarget === bigIdx);
                  const dimInactiveMini =
                    playing &&
                    state.miniStatus[bigIdx] === "active" &&
                    !miniLegalForTurn;
                  return (
                    <MiniBoard
                      key={bigIdx}
                      bigIdx={bigIdx}
                      cells={state.minis[bigIdx]}
                      miniStatus={state.miniStatus[bigIdx]}
                      highlightTurn={miniLegalForTurn}
                      turnPlayer={state.currentPlayer}
                      dimInactiveMini={dimInactiveMini}
                      isPlayable={
                        playing &&
                        humanCanClick &&
                        state.miniStatus[bigIdx] === "active" &&
                        (state.nextTarget === null ||
                          state.nextTarget === bigIdx)
                      }
                      lastSmallIdx={
                        state.lastMove?.bigIdx === bigIdx
                          ? state.lastMove.smallIdx
                          : null
                      }
                      lastPlayer={
                        state.lastMove?.bigIdx === bigIdx
                          ? state.lastMove.player
                          : null
                      }
                      onCellClick={(smallIdx) => applyMove(bigIdx, smallIdx)}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          <nav
            className="flex flex-shrink-0 flex-wrap items-center justify-center gap-1 border-t border-border pt-2 pb-1 sm:gap-2"
            aria-label="Game actions"
          >
            <Button
              variant="outline"
              size="sm"
              className="min-w-0 flex-1 px-2 sm:px-3"
              onClick={() => setModeModalOpen(true)}
            >
              Mode
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="min-w-0 flex-1 px-2 sm:px-3"
              onClick={() => setView("lobby")}
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

type MiniBoardProps = {
  bigIdx: number;
  cells: (Player | null)[];
  miniStatus: MiniOutcome;
  /** Current player can legally move in this mini — outline in their color (blue O / red X). */
  highlightTurn: boolean;
  turnPlayer: Player;
  /** Active mini where current player cannot move — subtle dim. */
  dimInactiveMini: boolean;
  isPlayable: boolean;
  lastSmallIdx: number | null;
  lastPlayer: Player | null;
  onCellClick: (smallIdx: number) => void;
};

function MiniBoard({
  bigIdx,
  cells,
  miniStatus,
  highlightTurn,
  turnPlayer,
  dimInactiveMini,
  isPlayable,
  lastSmallIdx,
  lastPlayer,
  onCellClick,
}: MiniBoardProps) {
  const finished = miniStatus !== "active";

  const turnRingO =
    highlightTurn &&
    !finished &&
    turnPlayer === "O" &&
    "border-sky-600 ring-2 ring-sky-500 ring-offset-1 ring-offset-background sm:ring-offset-2";
  const turnRingX =
    highlightTurn &&
    !finished &&
    turnPlayer === "X" &&
    "border-red-600 ring-2 ring-red-500 ring-offset-1 ring-offset-background sm:ring-offset-2";

  return (
    <div
      className={cn(
        "relative min-h-0 min-w-0 rounded border-2 p-px sm:p-0.5",
        miniStatus === "active" && !finished && "bg-card",
        miniStatus === "O" &&
          finished &&
          "border-sky-700/50 bg-sky-500/25 dark:border-sky-500/40 dark:bg-sky-500/20",
        miniStatus === "X" &&
          finished &&
          "border-red-700/50 bg-red-500/25 dark:border-red-500/40 dark:bg-red-500/20",
        miniStatus === "draw" &&
          finished &&
          "border-muted-foreground/40 bg-muted/40",
        !highlightTurn &&
          miniStatus === "active" &&
          "border-border",
        dimInactiveMini && "opacity-[0.88]",
        turnRingO,
        turnRingX
      )}
      aria-label={`Board ${bigIdx + 1}`}
    >
      {finished && (
        <div
          className={cn(
            "absolute inset-0 z-10 flex items-center justify-center rounded",
            miniStatus === "O" && "bg-sky-500/35 dark:bg-sky-500/30",
            miniStatus === "X" && "bg-red-500/35 dark:bg-red-500/30",
            miniStatus === "draw" && "bg-muted/50"
          )}
          aria-hidden
        >
          {miniStatus === "draw" ? (
            <span className="text-lg font-bold text-neutral-900 sm:text-2xl">
              —
            </span>
          ) : (
            <Mark
              player={miniStatus}
              size="lg"
              className="text-neutral-900"
            />
          )}
        </div>
      )}

      <div className="grid h-full w-full grid-cols-3 grid-rows-3 gap-px">
        {cells.map((cell, smallIdx) => {
          const isLast =
            lastSmallIdx === smallIdx && lastPlayer !== null && !finished;
          return (
            <button
              key={smallIdx}
              type="button"
              disabled={finished || !isPlayable || cell !== null}
              onClick={() => onCellClick(smallIdx)}
              className={cn(
                "flex aspect-square min-h-0 min-w-0 items-center justify-center rounded-[2px] border border-border/80 bg-background text-foreground",
                isLast &&
                  lastPlayer === "O" &&
                  "bg-sky-500/25 dark:bg-sky-400/20",
                isLast &&
                  lastPlayer === "X" &&
                  "bg-red-500/25 dark:bg-red-400/20",
                !isLast &&
                  !finished &&
                  isPlayable &&
                  cell === null &&
                  "hover:bg-accent/50",
                (finished || !isPlayable || cell !== null) &&
                  cell === null &&
                  "cursor-default opacity-70"
              )}
              aria-label={`Cell ${smallIdx + 1}, ${cell ?? "empty"}`}
            >
              {cell ? (
                <Mark player={cell} className="text-foreground" />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
