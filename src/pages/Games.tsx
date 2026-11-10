import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import { ENABLE_DEV_TEST_MODE_UI } from "@/config/devTestMode";
import { catalogService, type CatalogGame } from "@/lib/catalogService";

type GameTile = {
  key: string;
  title: string;
  path?: string;
  image?: string;
};

const PATHS: Record<string, string> = {
  "switch-search": "/games/switch-search",
  "ride-the-bus": "/games/ride-the-bus",
  "mega-toe": "/games/mega-toe",
};

const IMAGES: Record<string, string> = {
  "switch-search": "/images/games/switchsearchpic.png",
};

const FALLBACK: CatalogGame[] = [
  {
    game_key: "switch-search",
    title: "Switch Search",
    sort_order: 10,
    enabled_in_test: true,
    enabled_in_production: true,
    has_details: true,
  },
  {
    game_key: "ride-the-bus",
    title: "Ride the Bus",
    sort_order: 20,
    enabled_in_test: true,
    enabled_in_production: true,
    has_details: false,
  },
  {
    game_key: "boozed",
    title: "Boozed",
    sort_order: 30,
    enabled_in_test: true,
    enabled_in_production: true,
    has_details: false,
  },
  {
    game_key: "mega-toe",
    title: "Mega Toe",
    sort_order: 40,
    enabled_in_test: true,
    enabled_in_production: false,
    has_details: false,
  },
];

function toTile(game: CatalogGame): GameTile {
  return {
    key: game.game_key,
    title: game.title,
    path: PATHS[game.game_key],
    image: IMAGES[game.game_key],
  };
}

export default function Games() {
  const [catalogGames, setCatalogGames] = useState<CatalogGame[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rows = await catalogService.fetchGames();
      if (!cancelled) setCatalogGames(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const games = useMemo(() => {
    const source = catalogGames.length ? catalogGames : FALLBACK;
    const includeTest = ENABLE_DEV_TEST_MODE_UI;
    return source
      .filter((g) =>
        includeTest ? g.enabled_in_test : g.enabled_in_production
      )
      .map(toTile);
  }, [catalogGames]);

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
              >
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

                <div className="border border-border rounded-md bg-card p-4 mx-4 mb-4">
                  <h3 className="text-lg font-semibold text-foreground text-center">
                    {game.title}
                  </h3>
                </div>
              </Card>
            );

            if (game.path) {
              return (
                <Link key={game.key} to={game.path} className="block">
                  {TileContent}
                </Link>
              );
            }

            return <div key={game.key}>{TileContent}</div>;
          })}
        </div>
      </div>
    </div>
  );
}
