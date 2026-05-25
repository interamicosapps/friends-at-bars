import { cn } from "@/lib/utils";

type CardBackProps = {
  className?: string;
  size?: "sm" | "md" | "lg";
};

const sizeClass = {
  sm: "h-16 w-11",
  md: "h-24 w-[4.25rem]",
  lg: "h-32 w-24",
};

export function CardBack({ className, size = "md" }: CardBackProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md border-2 border-slate-700 bg-gradient-to-br from-sky-800 to-sky-950 shadow-md",
        sizeClass[size],
        className
      )}
      aria-hidden
    >
      <div
        className="absolute inset-1 rounded-sm border border-sky-400/40"
        style={{
          backgroundImage: `
            repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,255,255,0.06) 4px, rgba(255,255,255,0.06) 8px),
            repeating-linear-gradient(-45deg, transparent, transparent 4px, rgba(255,255,255,0.06) 4px, rgba(255,255,255,0.06) 8px)
          `,
        }}
      />
    </div>
  );
}
