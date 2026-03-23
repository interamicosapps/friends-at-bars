import { Outlet, useLocation } from "react-router-dom";
import Navbar from "./Navbar";
import BottomNav from "./BottomNav";
import { useGameImmersive } from "@/contexts/GameImmersiveContext";

export default function Layout() {
  const location = useLocation();
  const pathname = location.pathname;
  const { immersive } = useGameImmersive();
  const isActivities = pathname === "/";
  const isMap = pathname === "/map";
  const isGames = pathname === "/games" || pathname.startsWith("/games/");
  const isSwitchSearch = pathname.includes("switch-search");
  /** Hide bottom bar during Switch Search gameplay / end screen (immersive). */
  const showBottomNav =
    isActivities || isMap || (isGames && !(isSwitchSearch && immersive));
  const fullHeightMain = isActivities || isMap || isSwitchSearch;

  const bottomNavPad = "calc(3.5rem + var(--safe-area-inset-bottom))";
  const navbarHeight = "4rem";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {!isMap && <Navbar />}
      <main
        className={
          fullHeightMain
            ? isMap
              ? "min-h-0 w-full flex-1 overflow-hidden p-0"
              : "flex-1 min-h-0 w-full overflow-hidden"
            : "container mx-auto flex-1 px-4 py-8"
        }
        style={
          showBottomNav
            ? isMap
              ? { paddingBottom: 0, minHeight: 0 }
              : { paddingBottom: bottomNavPad }
            : undefined
        }
      >
        <div
          className={
            fullHeightMain ? "h-full min-h-0 w-full" : ""
          }
          style={
            isMap && showBottomNav
              ? {
                  height: `calc(100dvh - ${bottomNavPad})`,
                  maxHeight: `calc(100dvh - ${bottomNavPad})`,
                }
              : isSwitchSearch && immersive
                ? {
                    height: `calc(100dvh - ${navbarHeight})`,
                    maxHeight: `calc(100dvh - ${navbarHeight})`,
                  }
                : undefined
          }
        >
          <Outlet />
        </div>
      </main>
      {showBottomNav && <BottomNav />}
    </div>
  );
}
