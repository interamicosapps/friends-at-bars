import { cn } from "@/lib/utils";
import type { Card } from "@/lib/rideTheBus/types";
import { CardBack } from "./CardBack";
import { PlayingCard } from "./PlayingCard";

type CardPileProps = {
  label: string;
  count?: number;
  variant: "deck" | "current" | "history";
  currentCard?: Card | null;
  currentFaceDown?: boolean;
  historyCards?: Card[];
  size?: "sm" | "md" | "lg";
  className?: string;
};

export function CardPile({
  label,
  count,
  variant,
  currentCard,
  currentFaceDown = false,
  historyCards = [],
  size = "md",
  className,
}: CardPileProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col items-center gap-1.5",
        className
      )}
    >
      <span className="text-xs font-medium text-muted-foreground sm:text-sm">
        {label}
        {count !== undefined ? ` (${count})` : ""}
      </span>
      <div className="flex min-h-[8rem] items-center justify-center sm:min-h-[9.5rem]">
        {variant === "deck" && (
          <div className="relative">
            {count !== undefined && count > 1 && (
              <CardBack
                size={size}
                className="absolute left-1 top-1 -z-10 opacity-90"
              />
            )}
            <CardBack size={size} />
          </div>
        )}
        {variant === "current" && (
          <>
            {currentCard ? (
              currentFaceDown ? (
                <CardBack size={size} />
              ) : (
                <PlayingCard card={currentCard} size={size} />
              )
            ) : (
              <div
                className={cn(
                  "rounded-md border-2 border-dashed border-border/60 bg-muted/30",
                  size === "sm" && "h-16 w-11",
                  size === "md" && "h-24 w-[4.25rem]",
                  size === "lg" && "h-32 w-24"
                )}
                aria-hidden
              />
            )}
          </>
        )}
        {variant === "history" && (
          <div className="flex max-w-full flex-wrap items-center justify-center gap-0.5 px-1">
            {historyCards.length === 0 ? (
              <div
                className={cn(
                  "rounded-md border-2 border-dashed border-border/60 bg-muted/30",
                  size === "sm" && "h-16 w-11",
                  size === "md" && "h-24 w-[4.25rem]",
                  size === "lg" && "h-32 w-24"
                )}
                aria-hidden
              />
            ) : (
              historyCards.map((card, i) => (
                <PlayingCard
                  key={card.id}
                  card={card}
                  size="sm"
                  className={cn(
                    i > 0 && "-ml-6 sm:-ml-8",
                    "ring-1 ring-background"
                  )}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
