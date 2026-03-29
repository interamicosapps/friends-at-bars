import { Outlet, useLocation } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import Navbar from "./Navbar";
import BottomNav from "./BottomNav";
import { useGameImmersive } from "@/contexts/GameImmersiveContext";
import { shellHeightImmersive } from "@/constants/layoutHeights";

export default function Layout() {
  const location = useLocation();
  const pathname = location.pathname;
  const { immersive } = useGameImmersive();
  const isActivities = pathname === "/";
  const isMap = pathname === "/map";
  const isGames = pathname === "/games" || pathname.startsWith("/games/");
  const isSwitchSearch = pathname.includes("switch-search");
  const isMegaToe = pathname.includes("mega-toe");
  const isNativeIos =
    Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
  /** Hide bottom bar during Switch Search gameplay / end, or on Mega Toe (full screen). */
  const showBottomNav =
    isActivities ||
    isMap ||
    (isGames && !(isSwitchSearch && immersive) && !isMegaToe);
  const fullHeightMain =
    isActivities || isMap || isSwitchSearch || isMegaToe;

  const bottomNavPad = "calc(3.5rem + var(--safe-area-inset-bottom))";
  const immersiveShell = shellHeightImmersive();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Keep only the iOS status/safe-area strip dark; app header remains white. */}
      {isNativeIos && (
        <div
          className="pointer-events-none fixed inset-x-0 top-0 z-[80] bg-black"
          style={{ height: "var(--safe-area-inset-top)" }}
          aria-hidden
        />
      )}
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
                    height: immersiveShell,
                    maxHeight: immersiveShell,
                  }
                : isMegaToe
                  ? {
                      height: immersiveShell,
                      maxHeight: immersiveShell,
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
