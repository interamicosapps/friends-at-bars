import { Button } from "@/components/ui/Button";
import { shellHeightImmersive } from "@/constants/layoutHeights";
import { getRankedPlayDateEastern } from "./playDate";
import {
  formatLeaderboardScore,
  getMyRank,
} from "./rankedService";
import type { RankedGameType, RankedLeaderboardEntry } from "./types";

const GAME_TITLES: Record<RankedGameType, string> = {
  "switch-search": "Switch Search",
  "ride-the-bus": "Ride the Bus",
  boozed: "Boozed",
};

type RankedLeaderboardProps = {
  gameType: RankedGameType;
  entries: RankedLeaderboardEntry[];
  userId: string;
  onBack: () => void;
  loading?: boolean;
};

export function RankedLeaderboard({
  gameType,
  entries,
  userId,
  onBack,
  loading = false,
}: RankedLeaderboardProps) {
  const playDate = getRankedPlayDateEastern();
  const myEntry = getMyRank(entries, userId);
  const shellH = shellHeightImmersive();

  return (
    <div
      className="flex flex-col overflow-hidden px-4"
      style={{ height: shellH }}
    >
      <div className="mx-auto flex w-full max-w-lg min-h-0 flex-1 flex-col gap-4 py-4">
        <div className="flex-shrink-0 text-center">
          <h1 className="text-2xl font-bold text-foreground">
            {GAME_TITLES[gameType]} — Ranked
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Today&apos;s leaderboard (Eastern) · {playDate}
          </p>
          {myEntry && (
            <p className="mt-2 text-sm font-medium text-foreground">
              Your rank: #{myEntry.rank} ·{" "}
              {formatLeaderboardScore(gameType, myEntry)}
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
          {loading ? (
            <p className="p-4 text-center text-sm text-muted-foreground">
              Loading…
            </p>
          ) : entries.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">
              No scores yet today. Be the first at a bar!
            </p>
          ) : (
            <ol className="divide-y divide-border">
              {entries.map((row) => {
                const isMe = row.user_id === userId;
                return (
                  <li
                    key={row.id}
                    className={`flex items-start gap-3 px-3 py-2.5 text-sm ${
                      isMe ? "bg-primary/10" : ""
                    }`}
                  >
                    <span
                      className={`w-8 flex-shrink-0 font-semibold tabular-nums ${
                        isMe ? "text-primary" : "text-muted-foreground"
                      }`}
                    >
                      {row.rank}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">
                        {row.venue_name}
                        {isMe ? (
                          <span className="ml-1 text-xs text-muted-foreground">
                            (you)
                          </span>
                        ) : null}
                      </p>
                      <p className="text-muted-foreground">
                        {formatLeaderboardScore(gameType, row)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <Button size="lg" className="w-full flex-shrink-0" onClick={onBack}>
          Back to Menu
        </Button>
      </div>
    </div>
  );
}
