import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { List, MapPin, Gamepad2 } from "lucide-react";
import { useTestMode } from "@/contexts/TestModeContext";
import { ENABLE_DEV_TEST_MODE_UI } from "@/config/devTestMode";

export default function BottomNav() {
  const location = useLocation();
  const pathname = location.pathname;
  const { useMockCheckIns, setUseMockCheckIns } = useTestMode();

  const isActivities = pathname === "/";
  const isGames = pathname === "/games" || pathname.startsWith("/games/");
  const isMap = pathname === "/map";

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card"
      style={{ paddingBottom: "var(--safe-area-inset-bottom)" }}
    >
      <div className="container mx-auto flex h-14 items-center justify-around px-1 sm:px-2">
        <Link
          to="/"
          className={cn(
            "flex flex-col items-center justify-center gap-0.5 px-2 py-2 text-xs font-medium transition-colors sm:px-4",
            isActivities ? "text-primary" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <List className="h-5 w-5" />
          <span>Activities</span>
        </Link>
        {ENABLE_DEV_TEST_MODE_UI ? (
          <button
            type="button"
            onClick={() => setUseMockCheckIns(!useMockCheckIns)}
            className={cn(
              "flex min-w-[4.5rem] flex-col items-center justify-center gap-0.5 rounded-md border-2 px-1.5 py-1 text-[10px] font-semibold leading-tight transition-colors sm:min-w-[5rem] sm:px-2 sm:text-xs",
              useMockCheckIns
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-foreground bg-transparent text-foreground"
            )}
            aria-pressed={useMockCheckIns}
            aria-label={
              useMockCheckIns
                ? "Test mode on, using mock data"
                : "Test mode off, using live data"
            }
          >
            <span className="block">Test</span>
            <span className="block">Mode</span>
          </button>
        ) : null}
        <Link
          to="/map"
          className={cn(
            "flex flex-col items-center justify-center gap-0.5 px-2 py-2 text-xs font-medium transition-colors sm:px-4",
            isMap ? "text-primary" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <MapPin className="h-5 w-5" />
          <span>Map</span>
        </Link>
        <Link
          to="/games"
          className={cn(
            "flex flex-col items-center justify-center gap-0.5 px-2 py-2 text-xs font-medium transition-colors sm:px-4",
            isGames ? "text-primary" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Gamepad2 className="h-5 w-5" />
          <span>Games</span>
        </Link>
      </div>
    </nav>
  );
}
