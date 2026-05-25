import { cn } from "@/lib/utils";
import type { Card, Suit } from "@/lib/rideTheBus/types";

type PlayingCardProps = {
  card: Card;
  className?: string;
  size?: "sm" | "md" | "lg" | "fill";
  faceDown?: boolean;
};

const sizeClass = {
  sm: "h-16 w-11 text-[10px]",
  md: "h-24 w-[4.25rem] text-xs",
  lg: "h-32 w-24 text-sm",
  fill: "h-full w-full min-h-0 min-w-0 text-[clamp(0.5rem,3.5vw,0.75rem)]",
};

const SUIT_SYMBOL: Record<Suit, string> = {
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
  spades: "♠",
};

function isRed(suit: Suit) {
  return suit === "hearts" || suit === "diamonds";
}

export function PlayingCard({
  card,
  className,
  size = "md",
  faceDown = false,
}: PlayingCardProps) {
  if (faceDown) {
    return null;
  }

  const red = isRed(card.suit);
  const sym = SUIT_SYMBOL[card.suit];

  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden rounded-md border border-neutral-300 bg-white shadow-md",
        sizeClass[size],
        className
      )}
      aria-label={`${card.rank} of ${card.suit}`}
    >
      <div
        className={cn(
          "flex flex-col items-start px-1 pt-0.5 font-bold leading-none",
          red ? "text-red-600" : "text-neutral-900"
        )}
      >
        <span>{card.rank}</span>
        <span className="text-base leading-none">{sym}</span>
      </div>
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center text-2xl sm:text-3xl",
          red ? "text-red-600" : "text-neutral-900",
          size === "sm" && "text-xl",
          size === "lg" && "text-4xl",
          size === "fill" && "text-[clamp(1.25rem,42%,2.75rem)]"
        )}
      >
        {sym}
      </div>
      <div
        className={cn(
          "mt-auto flex rotate-180 flex-col items-start px-1 pb-0.5 font-bold leading-none",
          red ? "text-red-600" : "text-neutral-900"
        )}
      >
        <span>{card.rank}</span>
        <span className="text-base leading-none">{sym}</span>
      </div>
    </div>
  );
}
