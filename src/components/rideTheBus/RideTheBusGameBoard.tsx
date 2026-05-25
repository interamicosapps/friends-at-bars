import { cn } from "@/lib/utils";
import type { Card, RoundSlots } from "@/lib/rideTheBus/types";
import { CardBack } from "./CardBack";
import { PlayingCard } from "./PlayingCard";

/** Matches md playing card aspect (4.25 × 6 rem) */
const CARD_ASPECT = "aspect-[17/24]";
const pileCardSize = "h-[4.5rem] w-[2.75rem] sm:h-24 sm:w-[4.25rem]";

type RideTheBusGameBoardProps = {
  deckCount: number;
  trashCount: number;
  trashTopCard: Card | null;
  drinkCount: number;
  roundSlots: RoundSlots;
};

function PileZone({
  count,
  variant,
  topCard,
}: {
  count: number;
  variant: "deck" | "trash";
  topCard?: Card | null;
}) {
  return (
    <div className="flex w-[3.25rem] flex-shrink-0 flex-col items-center gap-1.5 sm:w-[4.25rem]">
      <div
        className={cn(
          "flex items-center justify-center rounded-md border-2 border-dashed",
          variant === "deck"
            ? "border-border/70 bg-muted/40"
            : "border-border/50 bg-muted/25",
          pileCardSize
        )}
      >
        {variant === "deck" ? (
          <div className="relative">
            {count > 1 && (
              <CardBack
                size="sm"
                className="absolute left-0.5 top-0.5 -z-10 scale-95 opacity-80"
              />
            )}
            {count > 0 ? (
              <CardBack size="sm" />
            ) : (
              <span className="text-[10px] text-muted-foreground">—</span>
            )}
          </div>
        ) : topCard ? (
          <div className="relative">
            {count > 1 && (
              <div
                className={cn(
                  "absolute left-0.5 top-0.5 -z-10 scale-95 rounded-md border border-border/50 bg-muted/40",
                  pileCardSize
                )}
                aria-hidden
              />
            )}
            <PlayingCard card={topCard} size="sm" />
          </div>
        ) : (
          <span className="text-[10px] text-muted-foreground">—</span>
        )}
      </div>
      <span className="sr-only">{variant === "deck" ? "Deck" : "Trash"}</span>
      <span
        className="text-sm font-semibold tabular-nums text-foreground"
        aria-hidden
      >
        {count}
      </span>
    </div>
  );
}

function DrinkCounter({ count }: { count: number }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 px-2">
      <div
        className={cn(
          "flex w-full max-w-[5.5rem] flex-col items-center justify-center rounded-lg border-2 border-indigo-500/45 bg-indigo-500/10 px-2 py-2 sm:max-w-[6.5rem]",
          pileCardSize
        )}
        aria-label={`Drink counter: ${count}`}
      >
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:text-xs">
          Drinks
        </span>
        <span className="text-2xl font-bold tabular-nums leading-none text-foreground sm:text-3xl">
          {count}
        </span>
      </div>
    </div>
  );
}

function RoundSlot({ card }: { card: Card | null }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col p-0.5 sm:p-1">
      <div
        className={cn(
          "flex w-full items-center justify-center rounded-md border-2 border-dashed border-red-400/50 bg-red-500/5 p-0.5 sm:p-1",
          CARD_ASPECT
        )}
      >
        {card ? (
          <PlayingCard card={card} size="fill" className="shadow-sm" />
        ) : (
          <div
            className="h-full w-full rounded-sm border border-border/40 bg-muted/20"
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}

export function RideTheBusGameBoard({
  deckCount,
  trashCount,
  trashTopCard,
  drinkCount,
  roundSlots,
}: RideTheBusGameBoardProps) {
  return (
    <div className="flex w-full max-w-2xl flex-col gap-5 sm:gap-6">
      <div
        className="flex w-full items-stretch justify-center gap-1 rounded-lg border-2 border-red-500/40 bg-red-500/[0.04] px-1 py-2 sm:gap-1.5 sm:px-1.5 sm:py-2.5"
        aria-label="Completed rounds"
      >
        {roundSlots.map((card, i) => (
          <RoundSlot key={i} card={card} />
        ))}
      </div>

      <div className="flex w-full items-end justify-between gap-1 px-0.5 sm:gap-2 sm:px-2">
        <PileZone count={deckCount} variant="deck" />
        <DrinkCounter count={drinkCount} />
        <PileZone
          count={trashCount}
          variant="trash"
          topCard={trashTopCard}
        />
      </div>
    </div>
  );
}
