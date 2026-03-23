import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type GameImmersiveContextValue = {
  /** True while Switch Search is in active game or end screen — bottom nav is hidden. */
  immersive: boolean;
  setImmersive: (value: boolean) => void;
};

const GameImmersiveContext = createContext<GameImmersiveContextValue | null>(
  null
);

export function GameImmersiveProvider({ children }: { children: ReactNode }) {
  const [immersive, setImmersiveState] = useState(false);
  const setImmersive = useCallback((value: boolean) => {
    setImmersiveState(value);
  }, []);

  const value = useMemo(
    () => ({ immersive, setImmersive }),
    [immersive, setImmersive]
  );

  return (
    <GameImmersiveContext.Provider value={value}>
      {children}
    </GameImmersiveContext.Provider>
  );
}

export function useGameImmersive() {
  const ctx = useContext(GameImmersiveContext);
  if (!ctx) {
    throw new Error(
      "useGameImmersive must be used within GameImmersiveProvider"
    );
  }
  return ctx;
}
