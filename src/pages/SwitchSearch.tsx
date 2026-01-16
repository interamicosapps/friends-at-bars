import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import wordLibrary from "@/data/wordLibrary.json";
import { cn } from "@/lib/utils";

type View = "homescreen" | "game" | "end";
type Difficulty = "easy" | "hard";
type SelectionType = "none" | "point-to-point" | "drag";

interface Cell {
  row: number;
  col: number;
}

interface WordPosition {
  row: number;
  col: number;
}

interface GridCell {
  letter: string;
  row: number;
  col: number;
  highlighted?: boolean;
  found?: boolean;
  unfoundHighlight?: boolean;
  backgroundColor?: string;
  color?: string;
}

const SwitchSearch = () => {
  const navigate = useNavigate();
  const [view, setView] = useState<View>("homescreen");
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [currentWords, setCurrentWords] = useState<string[]>([]);
  const [foundWords, setFoundWords] = useState<string[]>([]);
  const [totalFoundWords, setTotalFoundWords] = useState(0);
  const [usedWords, setUsedWords] = useState<string[]>([]);
  const [grid, setGrid] = useState<GridCell[][]>([]);
  const [wordPositions, setWordPositions] = useState<WordPosition[]>([]);
  const [gameTime, setGameTime] = useState(0);
  const [timeLeft, setTimeLeft] = useState(56);
  const [countdownTime, setCountdownTime] = useState(12);
  const [wordHints, setWordHints] = useState<string>("");
  const [isSelecting, setIsSelecting] = useState(false);
  const [startCell, setStartCell] = useState<Cell | null>(null);
  const [endCell, setEndCell] = useState<Cell | null>(null);
  const [selectionType, setSelectionType] = useState<SelectionType>("none");

  const gameTimeLimit = difficulty === "easy" ? 56 : 60;
  const gameDuration = difficulty === "easy" ? 12 : 20;
  const gridSize = difficulty === "easy" ? 7 : 8;

  const gameTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const gameCountdownRef = useRef<NodeJS.Timeout | null>(null);
  const wordSearchIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  // Get random word from array
  const getRandomWord = useCallback((words: string[]): string => {
    return words[Math.floor(Math.random() * words.length)];
  }, []);

  // Select words for game based on difficulty
  const selectWordsForGame = useCallback(() => {
    const newUsedWords = [...usedWords];
    const newCurrentWords: string[] = [];

    if (difficulty === "easy") {
      // First word from fourLetter
      let word: string;
      let attempts = 0;
      do {
        word = getRandomWord(wordLibrary.fourLetter);
        attempts++;
        if (attempts > wordLibrary.fourLetter.length) {
          newUsedWords.splice(
            0,
            newUsedWords.filter((w) => wordLibrary.fourLetter.includes(w)).length
          );
        }
      } while (newUsedWords.includes(word));
      newUsedWords.push(word);
      newCurrentWords.push(word);

      // Second word from fiveLetter or sixLetter
      const secondWordList =
        wordLibrary[
          Math.random() > 0.5 ? "fiveLetter" : "sixLetter"
        ] as string[];
      attempts = 0;
      do {
        word = getRandomWord(secondWordList);
        attempts++;
        if (attempts > secondWordList.length) {
          newUsedWords.splice(
            0,
            newUsedWords.filter((w) => secondWordList.includes(w)).length
          );
        }
      } while (newUsedWords.includes(word));
      newUsedWords.push(word);
      newCurrentWords.push(word);
    } else {
      // Hard mode: one from each list
      const wordLists = [
        wordLibrary.fiveLetter,
        wordLibrary.sixLetter,
        wordLibrary.sevenLetter,
      ];
      for (const wordList of wordLists) {
        let word: string;
        let attempts = 0;
        do {
          word = getRandomWord(wordList);
          attempts++;
          if (attempts > wordList.length) {
            newUsedWords.splice(
              0,
              newUsedWords.filter((w) => wordList.includes(w)).length
            );
          }
        } while (newUsedWords.includes(word));
        newUsedWords.push(word);
        newCurrentWords.push(word);
      }
    }

    setUsedWords(newUsedWords);
    setCurrentWords(newCurrentWords);
    return newCurrentWords;
  }, [difficulty, usedWords, getRandomWord]);

  // Check if word can be placed
  const canPlaceWord = useCallback(
    (
      word: string,
      grid: (string | null)[][],
      startRow: number,
      startCol: number,
      direction: string
    ): boolean => {
      for (let i = 0; i < word.length; i++) {
        const row =
          startRow + (direction === "vertical" || direction === "diagonal" ? i : 0);
        const col =
          startCol + (direction === "horizontal" || direction === "diagonal" ? i : 0);

        if (row >= gridSize || col >= gridSize || grid[row][col] !== null) {
          return false;
        }
      }
      return true;
    },
    [gridSize]
  );

  // Place word in grid
  const placeWordInGrid = useCallback(
    (word: string, grid: (string | null)[][]): WordPosition[] => {
      const directions = ["horizontal", "vertical", "diagonal"];
      const positions: WordPosition[] = [];
      let placed = false;

      while (!placed) {
        const direction =
          directions[Math.floor(Math.random() * directions.length)];
        const startRow = Math.floor(Math.random() * gridSize);
        const startCol = Math.floor(Math.random() * gridSize);

        if (canPlaceWord(word, grid, startRow, startCol, direction)) {
          for (let i = 0; i < word.length; i++) {
            const row =
              startRow +
              (direction === "vertical" || direction === "diagonal" ? i : 0);
            const col =
              startCol +
              (direction === "horizontal" || direction === "diagonal" ? i : 0);
            grid[row][col] = word[i];
            positions.push({ row, col });
          }
          placed = true;
        }
      }
      return positions;
    },
    [gridSize, canPlaceWord]
  );

  // Generate word search grid
  const generateWordSearch = useCallback(() => {
    const words = selectWordsForGame();
    const newGrid: (string | null)[][] = Array.from({ length: gridSize }, () =>
      Array(gridSize).fill(null)
    );
    const allPositions: WordPosition[] = [];

    words.forEach((word) => {
      const positions = placeWordInGrid(word, newGrid);
      allPositions.push(...positions);
    });

    // Fill empty spaces
    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        if (newGrid[row][col] === null) {
          newGrid[row][col] = String.fromCharCode(
            97 + Math.floor(Math.random() * 26)
          );
        }
      }
    }

    // Convert to GridCell format
    const gridCells: GridCell[][] = newGrid.map((row, rowIndex) =>
      row.map((letter, colIndex) => ({
        letter: letter!,
        row: rowIndex,
        col: colIndex,
      }))
    );

    // Generate word hints
    const isEasyMode = difficulty === "easy";
    const label = isEasyMode ? "Words:" : "Hints:";
    const hints = words.map((word) => {
      if (isEasyMode) {
        return `<span class='easy-hint-word'>${word
          .toLowerCase()
          .split("")
          .map((char) => `<span class='easy-hint-character'>${char}</span>`)
          .join("")}</span>`;
      } else {
        const hintArray = word.toLowerCase().split("");
        const shownIndices = new Set<number>();
        while (shownIndices.size < 2) {
          shownIndices.add(Math.floor(Math.random() * hintArray.length));
        }
        return `<span class='hard-hint-word'>${hintArray
          .map((char, index) =>
            `<span class='hard-hint-character'>${
              shownIndices.has(index) ? char : "_"
            }</span>`
          )
          .join("")}</span>`;
      }
    });

    setGrid(gridCells);
    setWordPositions(allPositions);
    setFoundWords([]);
    setCountdownTime(gameDuration);
    setWordHints(`${label} ${hints.join(", ")}`);
  }, [selectWordsForGame, placeWordInGrid, gridSize, gameDuration, difficulty]);

  // Get color based on game time
  const getColorAndTextColorByTime = useCallback(
    (elapsedTime: number): { backgroundColor: string; textColor: string } => {
      const endTime = 130;
      const fraction = Math.min(elapsedTime / endTime, 1);

      let red: number, green: number;
      const blue = 0;

      if (fraction <= 0.5) {
        red = 255;
        green = Math.floor(255 * fraction * 2);
      } else {
        green = 255;
        red = Math.floor(255 * (1 - (fraction - 0.5) * 2));
      }

      const hexColor = `#${red.toString(16).padStart(2, "0")}${green
        .toString(16)
        .padStart(2, "0")}00`;

      const textColor = fraction > 0.4 ? "#000000" : "#FFFFFF";

      return { backgroundColor: hexColor, textColor };
    },
    []
  );

  // Highlight selection
  const highlightSelection = useCallback(
    (start: Cell, end: Cell) => {
      setGrid((prevGrid) => {
        if (prevGrid.length === 0) return prevGrid;
        
        const newGrid = prevGrid.map((row) =>
          row.map((cell) => ({ ...cell, highlighted: false }))
        );

        const rowDifference = end.row - start.row;
        const colDifference = end.col - start.col;
        const steps = Math.max(Math.abs(rowDifference), Math.abs(colDifference));
        if (steps === 0) return newGrid;
        
        const rowStep = rowDifference / steps;
        const colStep = colDifference / steps;

        let currentRow = start.row;
        let currentCol = start.col;

        for (let i = 0; i <= steps; i++) {
          if (
            currentRow >= 0 &&
            currentRow < gridSize &&
            currentCol >= 0 &&
            currentCol < gridSize &&
            newGrid[currentRow] &&
            newGrid[currentRow][currentCol]
          ) {
            newGrid[currentRow][currentCol].highlighted = true;
          }
          currentRow += rowStep;
          currentCol += colStep;
        }

        return newGrid;
      });
    },
    [gridSize]
  );

  // Check selection
  const checkSelection = useCallback((overrideEndCell?: Cell | null) => {
    const cellToUse = overrideEndCell !== undefined ? overrideEndCell : endCell;
    if (!startCell || !cellToUse || grid.length === 0) {
      return;
    }

    let selectedWord = "";
    let row = startCell.row;
    let col = startCell.col;
    const rowIncrement =
      cellToUse.row !== startCell.row
        ? (cellToUse.row - startCell.row) /
          Math.abs(cellToUse.row - startCell.row)
        : 0;
    const colIncrement =
      cellToUse.col !== startCell.col
        ? (cellToUse.col - startCell.col) /
          Math.abs(cellToUse.col - startCell.col)
        : 0;

    const steps = Math.max(
      Math.abs(cellToUse.row - startCell.row),
      Math.abs(cellToUse.col - startCell.col)
    );

    for (let i = 0; i <= steps; i++) {
      if (
        row >= 0 &&
        row < gridSize &&
        col >= 0 &&
        col < gridSize &&
        grid[row] &&
        grid[row][col]
      ) {
        selectedWord += grid[row][col].letter;
      }
      row += rowIncrement;
      col += colIncrement;
    }

    selectedWord = selectedWord.toLowerCase();

    if (
      currentWords.includes(selectedWord) &&
      !foundWords.includes(selectedWord)
    ) {
      // Highlight found word
      setGrid((prevGrid) => {
        if (prevGrid.length === 0) return prevGrid;
        const newGrid = prevGrid.map((row) => row.map((cell) => ({ ...cell })));
        const { backgroundColor, textColor } = getColorAndTextColorByTime(gameTime);

        let row = startCell.row;
        let col = startCell.col;
        const rowIncrement =
          cellToUse.row !== startCell.row
            ? (cellToUse.row - startCell.row) /
              Math.abs(cellToUse.row - startCell.row)
            : 0;
        const colIncrement =
          cellToUse.col !== startCell.col
            ? (cellToUse.col - startCell.col) /
              Math.abs(cellToUse.col - startCell.col)
            : 0;

        const steps = Math.max(
          Math.abs(cellToUse.row - startCell.row),
          Math.abs(cellToUse.col - startCell.col)
        );

        for (let i = 0; i <= steps; i++) {
          if (
            row >= 0 &&
            row < gridSize &&
            col >= 0 &&
            col < gridSize &&
            newGrid[row] &&
            newGrid[row][col]
          ) {
            newGrid[row][col].found = true;
            newGrid[row][col].backgroundColor = backgroundColor;
            newGrid[row][col].color = textColor;
          }
          row += rowIncrement;
          col += colIncrement;
        }

        return newGrid;
      });

      const newFoundWords = [...foundWords, selectedWord];
      setFoundWords(newFoundWords);
      setTotalFoundWords((prev) => prev + 1);

      // Check if all words found
      if (newFoundWords.length === currentWords.length) {
        const additionalTime = difficulty === "easy" ? 2 : 6;
        setTimeLeft((prev) => Math.min(prev + additionalTime, gameTimeLimit));

        setTimeout(() => {
          generateWordSearch();
        }, 300);
      }
    } else {
      // Clear highlights
      setGrid((prevGrid) => {
        if (prevGrid.length === 0) return prevGrid;
        return prevGrid.map((row) =>
          row.map((cell) => ({ ...cell, highlighted: false }))
        );
      });
    }

    resetSelection();
  }, [
    startCell,
    endCell,
    grid,
    gridSize,
    currentWords,
    foundWords,
    gameTime,
    getColorAndTextColorByTime,
    difficulty,
    gameTimeLimit,
    generateWordSearch,
  ]);

  // Reset selection
  const resetSelection = useCallback(() => {
    setIsSelecting(false);
    setSelectionType("none");
    setStartCell(null);
    setEndCell(null);
    setGrid((prevGrid) => {
      if (prevGrid.length === 0) return prevGrid;
      return prevGrid.map((row) =>
        row.map((cell) => ({
          ...cell,
          highlighted: false,
          unfoundHighlight: false,
        }))
      );
    });
  }, []);

  // Start selection
  const startSelection = useCallback(
    (row: number, col: number) => {
      if (!isSelecting) {
        setStartCell({ row, col });
        setIsSelecting(true);
        setSelectionType("none");
        setGrid((prevGrid) => {
          if (prevGrid.length === 0) return prevGrid;
          const newGrid = prevGrid.map((row) => row.map((cell) => ({ ...cell })));
          if (newGrid[row] && newGrid[row][col]) {
            newGrid[row][col].highlighted = true;
          }
          return newGrid;
        });
      } else if (isSelecting && (selectionType === "point-to-point" || selectionType === "none")) {
        const endCellValue = { row, col };
        setEndCell(endCellValue);
        if (startCell) {
          highlightSelection(startCell, endCellValue);
          // Pass endCell directly to checkSelection to avoid state timing issues
          setTimeout(() => {
            checkSelection(endCellValue);
            // Reset after checkSelection completes
            setTimeout(() => {
              resetSelection();
            }, 50);
          }, 50);
        } else {
          resetSelection();
        }
      }
    },
    [isSelecting, selectionType, startCell, highlightSelection, checkSelection, resetSelection]
  );

  // Continue selection (drag)
  const continueSelection = useCallback(
    (row: number, col: number) => {
      if (
        isSelecting &&
        startCell &&
        (row !== startCell.row || col !== startCell.col)
      ) {
        setSelectionType("drag");
        setEndCell({ row, col });
        highlightSelection(startCell, { row, col });
      }
    },
    [isSelecting, startCell, highlightSelection]
  );

  // End selection
  const endSelection = useCallback(() => {
    if (isSelecting && selectionType === "drag" && startCell && endCell) {
      checkSelection();
    } else if (isSelecting && selectionType === "none" && startCell && endCell) {
      checkSelection();
    } else if (isSelecting && selectionType === "none" && startCell && !endCell) {
      // First click released without dragging - switch to point-to-point mode
      // Keep isSelecting true so the second click can be detected
      setSelectionType("point-to-point");
      // Don't reset selection yet - wait for second click
    }
  }, [isSelecting, selectionType, startCell, endCell, checkSelection]);

  // Start game
  const startGame = useCallback(() => {
    setView("game");
    setTimeLeft(gameTimeLimit);
    setCountdownTime(gameDuration);
    setTotalFoundWords(0);
    setFoundWords([]);
    setGameTime(0);
    setUsedWords([]);
    generateWordSearch();
  }, [gameTimeLimit, gameDuration, generateWordSearch]);

  // Restart game
  const restartGame = useCallback(() => {
    setView("game");
    setTimeLeft(gameTimeLimit);
    setCountdownTime(gameDuration);
    setTotalFoundWords(0);
    setFoundWords([]);
    setGameTime(0);
    setUsedWords([]);
    generateWordSearch();
  }, [gameTimeLimit, gameDuration, generateWordSearch]);

  // Exit to homescreen
  const exitToHomescreen = useCallback(() => {
    setView("homescreen");
    resetSelection();
  }, [resetSelection]);

  // Skip word search
  const skipWordSearch = useCallback(() => {
    generateWordSearch();
  }, [generateWordSearch]);

  // Highlight unfound positions
  const highlightUnfoundPositions = useCallback(() => {
    setGrid((prevGrid) => {
      if (prevGrid.length === 0) return prevGrid;
      const newGrid = prevGrid.map((row) => row.map((cell) => ({ ...cell })));
      wordPositions.forEach((position) => {
        if (
          newGrid[position.row] &&
          newGrid[position.row][position.col] &&
          !newGrid[position.row][position.col].found
        ) {
          newGrid[position.row][position.col].unfoundHighlight = true;
        }
      });
      return newGrid;
    });
  }, [wordPositions]);

  // Game timer
  useEffect(() => {
    if (view === "game") {
      gameTimerRef.current = setInterval(() => {
        setGameTime((prev) => prev + 1);
      }, 1000);

      return () => {
        if (gameTimerRef.current) {
          clearInterval(gameTimerRef.current);
        }
      };
    }
  }, [view]);

  // Game countdown timer
  useEffect(() => {
    if (view === "game" && timeLeft > 0) {
      gameCountdownRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            setView("end");
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => {
        if (gameCountdownRef.current) {
          clearInterval(gameCountdownRef.current);
        }
      };
    }
  }, [view, timeLeft]);

  // Word search countdown timer
  useEffect(() => {
    if (view === "game" && countdownTime > 0) {
      countdownTimerRef.current = setInterval(() => {
        setCountdownTime((prev) => {
          if (prev <= 1) {
            highlightUnfoundPositions();
            setTimeout(() => {
              generateWordSearch();
            }, 500);
            return gameDuration;
          }
          return prev - 1;
        });
      }, 1000);

      return () => {
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
        }
      };
    }
  }, [view, countdownTime, gameDuration, highlightUnfoundPositions, generateWordSearch]);

  // Attach touch event listeners with non-passive option
  useEffect(() => {
    if (!gridRef.current || grid.length === 0) return;

    const gridElement = gridRef.current;
    const cells = gridElement.querySelectorAll<HTMLElement>('[data-row][data-col]');

    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      const target = e.target as HTMLElement;
      const row = parseInt(target.dataset.row || "0", 10);
      const col = parseInt(target.dataset.col || "0", 10);
      startSelection(row, col);
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch || !gridElement) return;
      
      const gridRect = gridElement.getBoundingClientRect();
      const row = Math.floor(
        ((touch.clientY - gridRect.top) / gridRect.height) * gridSize
      );
      const col = Math.floor(
        ((touch.clientX - gridRect.left) / gridRect.width) * gridSize
      );
      if (row >= 0 && row < gridSize && col >= 0 && col < gridSize) {
        continueSelection(row, col);
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      endSelection();
    };

    cells.forEach((cell) => {
      cell.addEventListener("touchstart", handleTouchStart, { passive: false });
      cell.addEventListener("touchmove", handleTouchMove, { passive: false });
      cell.addEventListener("touchend", handleTouchEnd, { passive: false });
    });

    return () => {
      cells.forEach((cell) => {
        cell.removeEventListener("touchstart", handleTouchStart);
        cell.removeEventListener("touchmove", handleTouchMove);
        cell.removeEventListener("touchend", handleTouchEnd);
      });
    };
  }, [grid, gridSize, startSelection, continueSelection, endSelection]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (gameTimerRef.current) clearInterval(gameTimerRef.current);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      if (gameCountdownRef.current) clearInterval(gameCountdownRef.current);
      if (wordSearchIntervalRef.current) clearInterval(wordSearchIntervalRef.current);
    };
  }, []);


  // Render homescreen
  if (view === "homescreen") {
    return (
      <div className="flex flex-col bg-background px-4 overflow-hidden min-h-0" style={{ height: 'calc(100vh - 4rem - 4rem)' }}>
        <div className="flex-1 flex flex-col items-center justify-center w-full max-w-2xl mx-auto text-center gap-3 md:gap-6 min-h-0">
          <h1 className="text-4xl md:text-6xl font-bold text-foreground">Switch Search</h1>

          <div className="flex justify-center gap-4 md:gap-6">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="difficulty"
                value="easy"
                checked={difficulty === "easy"}
                onChange={(e) => setDifficulty(e.target.value as Difficulty)}
                className="h-4 w-4"
              />
              <span className="text-lg md:text-xl text-foreground">Easy</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="difficulty"
                value="hard"
                checked={difficulty === "hard"}
                onChange={(e) => setDifficulty(e.target.value as Difficulty)}
                className="h-4 w-4"
              />
              <span className="text-lg md:text-xl text-foreground">Hard</span>
            </label>
          </div>

          <div className="flex flex-col gap-2 md:gap-4 w-full">
            <Button onClick={startGame} size="lg" className="w-full text-base md:text-lg">
              Start Game
            </Button>
            <Button
              onClick={() => navigate("/games")}
              variant="outline"
              size="lg"
              className="w-full text-base md:text-lg"
            >
              Exit
            </Button>
          </div>
        </div>

        <p className="text-xs md:text-sm text-muted-foreground text-center py-1 md:py-4 flex-shrink-0">
          Developed by: Isaac Edwards
        </p>
      </div>
    );
  }

  // Render end screen
  if (view === "end") {
    const wordCountMessage = totalFoundWords === 1 ? "word" : "words";
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
        <div className="w-full max-w-2xl text-center">
          <h1 className="mb-6 text-3xl font-bold text-foreground">
            Time is up! You found {totalFoundWords} {wordCountMessage}.
          </h1>
          <div className="flex flex-col gap-4">
            <Button onClick={restartGame} size="lg" className="w-full">
              Restart
            </Button>
            <Button
              onClick={exitToHomescreen}
              variant="outline"
              size="lg"
              className="w-full"
            >
              Exit
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Render game view
  const gameTimeProgress = (timeLeft / gameTimeLimit) * 100;
  const countdownProgress = (countdownTime / gameDuration) * 100;

  return (
    <>
      <style>{`
        .easy-hint-character {
          margin: 2px;
          display: inline-block;
        }
        .easy-hint-word {
          margin-left: 10px;
          display: inline-block;
        }
        .hard-hint-character {
          margin: 4px;
          display: inline-block;
        }
        .hard-hint-word {
          margin-left: 12px;
          display: inline-block;
        }
      `}</style>
      <div className="flex h-[calc(100vh-4rem)] md:h-[calc(100vh-4rem)] flex-col items-center justify-center bg-background px-4 py-1 md:py-8 overflow-hidden">
      <div className="w-full max-w-4xl flex flex-col items-center justify-center flex-1 min-h-0 gap-0.5 md:gap-2">
        <div className="mb-1 md:mb-4 text-center text-xl md:text-2xl font-bold text-foreground">
          Switch Search
        </div>

        {/* Game Timer Progress Bar */}
        <div className="mb-1 md:mb-2 h-1.5 md:h-2.5 w-full max-w-[300px] mx-auto relative bg-muted rounded">
          <div
            className="absolute top-0 left-0 h-full bg-blue-600 transition-all duration-1000 rounded"
            style={{ width: `${gameTimeProgress}%` }}
          />
        </div>

        {/* Word Search Grid */}
        {grid.length > 0 && (
          <div
            ref={gridRef}
            className={cn(
              "mx-auto my-1 md:my-4 grid gap-0.5 md:gap-1",
              difficulty === "easy" ? "grid-cols-7" : "grid-cols-8",
              "aspect-square flex-shrink-0"
            )}
            style={{
              width: "min(75vw, 45vh)",
              height: "min(75vw, 45vh)",
            }}
          >
            {grid.map((row) =>
              row.map((cell) => (
              <div
                key={`${cell.row}-${cell.col}`}
                data-row={cell.row}
                data-col={cell.col}
                className={cn(
                  "flex items-center justify-center rounded-[10%] border cursor-pointer select-none text-center font-bold transition-colors",
                  difficulty === "hard"
                    ? "bg-gray-600 text-white border-gray-500"
                    : "bg-gray-200 text-black border-gray-300",
                  cell.highlighted && "bg-cyan-400/64 text-white",
                  cell.unfoundHighlight && "bg-gray-400 text-white"
                )}
                style={{
                  backgroundColor: cell.backgroundColor || undefined,
                  color: cell.color || undefined,
                  fontSize: `clamp(12px, calc(17.5vw / ${gridSize}), 24px)`,
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  // If we're in point-to-point mode and clicking a different cell, handle as second click
                  if (isSelecting && selectionType === "point-to-point" && startCell) {
                    if (cell.row !== startCell.row || cell.col !== startCell.col) {
                      const endCellValue = { row: cell.row, col: cell.col };
                      setEndCell(endCellValue);
                      highlightSelection(startCell, endCellValue);
                      setTimeout(() => {
                        checkSelection(endCellValue);
                        setTimeout(() => {
                          resetSelection();
                        }, 50);
                      }, 50);
                      return;
                    }
                  }
                  startSelection(cell.row, cell.col);
                }}
                onMouseEnter={() => {
                  if (isSelecting) {
                    continueSelection(cell.row, cell.col);
                  }
                }}
                onMouseUp={() => {
                  endSelection();
                }}
                onClick={(e) => {
                  // Handle point-to-point: if we're in point-to-point mode, treat click as second selection
                  if (isSelecting && selectionType === "point-to-point" && startCell) {
                    e.preventDefault();
                    // Make sure we're not clicking the same cell
                    if (cell.row !== startCell.row || cell.col !== startCell.col) {
                      const endCellValue = { row: cell.row, col: cell.col };
                      setEndCell(endCellValue);
                      highlightSelection(startCell, endCellValue);
                      setTimeout(() => {
                        checkSelection(endCellValue);
                        setTimeout(() => {
                          resetSelection();
                        }, 50);
                      }, 50);
                    }
                  }
                }}
              >
                {cell.letter.toUpperCase()}
              </div>
              ))
            )}
          </div>
        )}

        {/* Word Search Timer Progress Bar */}
        <div className="mb-1 md:mb-2 h-1.5 md:h-2.5 w-full max-w-[300px] mx-auto relative bg-muted rounded">
          <div
            className="absolute top-0 left-0 h-full bg-red-600 transition-all duration-1000 rounded"
            style={{ width: `${countdownProgress}%` }}
          />
        </div>

        {/* Word Hints */}
        <div
          className="mb-1 md:mb-4 text-center text-sm md:text-base text-foreground"
          dangerouslySetInnerHTML={{ __html: wordHints }}
        />

        {/* Found Words Counter */}
        <div className="mb-1 md:mb-4 text-center text-sm md:text-lg text-foreground">
          Words found: {totalFoundWords}
        </div>

        {/* Control Buttons */}
        <div className="flex justify-center gap-2 md:gap-4">
          <Button onClick={skipWordSearch} variant="outline" className="text-xs md:text-sm px-2 md:px-4 py-1.5 md:py-2">
            Skip
          </Button>
          <Button onClick={restartGame} variant="outline" className="text-xs md:text-sm px-2 md:px-4 py-1.5 md:py-2">
            Restart
          </Button>
          <Button onClick={exitToHomescreen} variant="outline" className="text-xs md:text-sm px-2 md:px-4 py-1.5 md:py-2">
            Exit
          </Button>
        </div>
      </div>
      </div>
    </>
  );
};

export default SwitchSearch;
