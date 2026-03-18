import { Outlet, useLocation } from "react-router-dom";
import Navbar from "./Navbar";
import BottomNav from "./BottomNav";
import MapFloatingLogo from "./MapFloatingLogo";

export default function Layout() {
  const location = useLocation();
  const pathname = location.pathname;
  const isActivities = pathname === "/";
  const isMap = pathname === "/map";
  const isGames = pathname === "/games" || pathname.startsWith("/games/");
  const isSwitchSearch = pathname.includes("switch-search");
  const showBottomNav = isActivities || isMap || isGames;
  const fullHeightMain = isActivities || isMap || isSwitchSearch;

  const bottomNavPad = "calc(3.5rem + var(--safe-area-inset-bottom))";

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
              : undefined
          }
        >
          <Outlet />
        </div>
      </main>
      {isMap && <MapFloatingLogo />}
      {showBottomNav && <BottomNav />}
    </div>
  );
}
