import { cn } from "@/lib/utils";

export interface MapFloatingLogoProps {
  /** Defaults to matching the map date pill height (`h-10`). */
  className?: string;
}

/** Map page only: decorative logo mark — square; size with `className` to match the date pill row. */
export default function MapFloatingLogo({ className }: MapFloatingLogoProps) {
  return (
    <div
      className={cn(
        "pointer-events-none flex aspect-square h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary shadow-sm",
        className
      )}
    >
      <img
        src="/brand/logo-mark.png"
        alt="Bar Fest"
        draggable={false}
        className="h-8 w-8 object-contain"
      />
    </div>
  );
}
