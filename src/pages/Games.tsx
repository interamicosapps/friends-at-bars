import { Link } from "react-router-dom";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

type GameTile = {
  id: number;
  title: string;
  path?: string;
  image?: string;
};

// Game tile data: optional image path (under public/ is served from root) and optional path to game
const games: GameTile[] = [
  { id: 1, title: "Switch Search", path: "/games/switch-search", image: "/images/games/switchsearchpic.png" },
  { id: 2, title: "Mega Toe", path: "/games/mega-toe" },
  { id: 3, title: "Game 3" },
  { id: 4, title: "Game 4" },
  { id: 5, title: "Game 5" },
  { id: 6, title: "Game 6" },
  { id: 7, title: "Game 7" },
  { id: 8, title: "Game 8" },
];

export default function Games() {
  const handleTileClick = (gameId: number) => {
    console.log(`Clicked game ${gameId} (animation test)`);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="mb-8 text-3xl font-bold text-foreground">Games</h1>
        
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {games.map((game) => {
            const hasPath = Boolean(game.path);
            const TileContent = (
              <Card
                className={cn(
                  "group relative flex flex-col overflow-hidden transition-all duration-200",
                  "hover:scale-105 hover:shadow-lg",
                  "active:scale-95",
                  "cursor-pointer"
                )}
                onClick={() => !hasPath && handleTileClick(game.id)}
              >
                {/* Tile image or placeholder - image fits inside box (no crop), centered with space on sides or top/bottom */}
                <div className="relative flex aspect-[4/3] w-full items-center justify-center bg-white overflow-hidden">
                  {game.image ? (
                    <img
                      src={game.image}
                      alt={game.title}
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <span className="text-muted-foreground">Image Placeholder</span>
                  )}
                </div>

                {/* Title Box */}
                <div className="border border-border rounded-md bg-card p-4 mx-4 mb-4">
                  <h3 className="text-lg font-semibold text-foreground text-center">
                    {game.title}
                  </h3>
                </div>
              </Card>
            );

            if (game.path) {
              return (
                <Link key={game.id} to={game.path} className="block">
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
