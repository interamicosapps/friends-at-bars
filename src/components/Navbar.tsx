import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

export default function Navbar() {
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav 
      className="sticky top-0 z-50 border-b border-border bg-card"
      style={{ paddingTop: 'var(--safe-area-inset-top)' }}
    >
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <span className="text-sm font-bold text-primary-foreground">
                N
              </span>
            </div>
            <span className="text-sm sm:text-base md:text-lg lg:text-xl xl:text-2xl font-bold text-foreground">
              Bar Fest
            </span>
          </Link>

          {/* Navigation Links */}
          <div className="flex items-center space-x-8">
            <Link
              to="/"
              className={cn(
                "flex items-center justify-center text-sm font-medium transition-colors hover:text-primary",
                isActive("/") ? "text-primary" : "text-muted-foreground"
              )}
            >
              Home
            </Link>
            <Link
              to="/test"
              className={cn(
                "flex items-center justify-center text-sm font-medium transition-colors hover:text-primary",
                isActive("/test") ? "text-primary" : "text-muted-foreground"
              )}
            >
              Test
            </Link>
            <Link
              to="/about"
              className={cn(
                "flex items-center justify-center text-sm font-medium transition-colors hover:text-primary",
                isActive("/about") ? "text-primary" : "text-muted-foreground"
              )}
            >
              About
            </Link>
            <Link
              to="/games"
              className={cn(
                "flex items-center justify-center text-sm font-medium transition-colors hover:text-primary",
                isActive("/games") ? "text-primary" : "text-muted-foreground"
              )}
            >
              Games
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
