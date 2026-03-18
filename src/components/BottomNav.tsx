import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { List, MapPin, Gamepad2 } from "lucide-react";

export default function BottomNav() {
  const location = useLocation();
  const pathname = location.pathname;

  const isActivities = pathname === "/";
  const isGames = pathname === "/games" || pathname.startsWith("/games/");
  const isMap = pathname === "/map";

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card"
      style={{ paddingBottom: "var(--safe-area-inset-bottom)" }}
    >
      <div className="container mx-auto flex h-14 items-center justify-around px-2">
        <Link
          to="/"
          className={cn(
            "flex flex-col items-center justify-center gap-0.5 px-4 py-2 text-xs font-medium transition-colors",
            isActivities ? "text-primary" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <List className="h-5 w-5" />
          <span>Activities</span>
        </Link>
        <Link
          to="/map"
          className={cn(
            "flex flex-col items-center justify-center gap-0.5 px-4 py-2 text-xs font-medium transition-colors",
            isMap ? "text-primary" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <MapPin className="h-5 w-5" />
          <span>Map</span>
        </Link>
        <Link
          to="/games"
          className={cn(
            "flex flex-col items-center justify-center gap-0.5 px-4 py-2 text-xs font-medium transition-colors",
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
