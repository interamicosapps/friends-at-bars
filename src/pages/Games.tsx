import { Link } from "react-router-dom";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

// Placeholder game data
const games = [
  { id: 1, title: "Switch Search", path: "/games/switch-search" },
  { id: 2, title: "Game 2" },
  { id: 3, title: "Game 3" },
  { id: 4, title: "Game 4" },
  { id: 5, title: "Game 5" },
  { id: 6, title: "Game 6" },
  { id: 7, title: "Game 7" },
  { id: 8, title: "Game 8" },
];

export default function Games() {
  const handleTileClick = (gameId: number) => {
    // Only the first tile navigates, others just for animation testing
    if (gameId === 1) {
      return; // Let Link handle navigation
    }
    // Animation testing - tiles are clickable but don't navigate
    console.log(`Clicked game ${gameId} (animation test)`);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="mb-8 text-3xl font-bold text-foreground">Games</h1>
        
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {games.map((game) => {
            const isFirstGame = game.id === 1;
            const TileContent = (
              <Card
                className={cn(
                  "group relative flex flex-col overflow-hidden transition-all duration-200",
                  "hover:scale-105 hover:shadow-lg",
                  "active:scale-95",
                  "cursor-pointer"
                )}
                onClick={() => !isFirstGame && handleTileClick(game.id)}
              >
                {/* Image Placeholder */}
                <div className="relative aspect-[4/3] w-full bg-muted">
                  <div className="flex h-full items-center justify-center">
                    <span className="text-muted-foreground">Image Placeholder</span>
                  </div>
                </div>

                {/* Title Box */}
                <div className="border border-border rounded-md bg-card p-4 mx-4 mb-4">
                  <h3 className="text-lg font-semibold text-foreground text-center">
                    {game.title}
                  </h3>
                </div>
              </Card>
            );

            if (isFirstGame && game.path) {
              return (
                <Link
                  key={game.id}
                  to={game.path}
                  className="block"
                >
                  {TileContent}
                </Link>
              );
            }

            return <div key={game.id}>{TileContent}</div>;
          })}
        </div>
      </div>
    </div>
  );
}
