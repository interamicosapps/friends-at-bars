import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ENABLE_DEV_TEST_MODE_UI } from "@/config/devTestMode";

const STORAGE_KEY = "barfest_dev_test_mock_data";

export type TestModeContextValue = {
  /** Feature flag: when false, mock is never used and the nav toggle is hidden. */
  devTestModeUiEnabled: boolean;
  /** When true, Activities/Map (and check-in overlay) use `testDataService`. */
  useMockCheckIns: boolean;
  setUseMockCheckIns: (value: boolean) => void;
};

const defaultValue: TestModeContextValue = {
  devTestModeUiEnabled: false,
  useMockCheckIns: false,
  setUseMockCheckIns: () => {},
};

const TestModeContext = createContext<TestModeContextValue>(defaultValue);

function readStoredMockPreference(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  return sessionStorage.getItem(STORAGE_KEY) === "1";
}

export function TestModeProvider({ children }: { children: ReactNode }) {
  const [useMockCheckIns, setUseMockCheckInsState] = useState(
    readStoredMockPreference
  );

  const setUseMockCheckIns = useCallback((value: boolean) => {
    setUseMockCheckInsState(value);
    if (typeof sessionStorage !== "undefined") {
      if (value) sessionStorage.setItem(STORAGE_KEY, "1");
      else sessionStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const value = useMemo<TestModeContextValue>(() => {
    if (!ENABLE_DEV_TEST_MODE_UI) {
      return {
        devTestModeUiEnabled: false,
        useMockCheckIns: false,
        setUseMockCheckIns: () => {},
      };
    }
    return {
      devTestModeUiEnabled: true,
      useMockCheckIns,
      setUseMockCheckIns,
    };
  }, [useMockCheckIns, setUseMockCheckIns]);

  return (
    <TestModeContext.Provider value={value}>{children}</TestModeContext.Provider>
  );
}

export function useTestMode(): TestModeContextValue {
  return useContext(TestModeContext);
}
