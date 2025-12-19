import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface DropdownOption {
  label: string;
  value: string;
  group?: string;
}

interface DropdownSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export default function DropdownSelect({
  value,
  onChange,
  options,
  placeholder = "Select...",
  disabled,
  className,
}: DropdownSelectProps) {
  const [open, setOpen] = useState(false);
  const [positionAbove, setPositionAbove] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Calculate dropdown position based on available space
  useEffect(() => {
    if (open && triggerRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - triggerRect.bottom;
      const spaceAbove = triggerRect.top;
      const estimatedMenuHeight = Math.min(300, viewportHeight * 0.5); // Max 50vh or 300px

      // Position above if there's not enough space below but enough space above
      if (spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow) {
        setPositionAbove(true);
      } else {
        setPositionAbove(false);
      }
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Build grouped structure
  const groups = Array.from(
    options.reduce((map, opt) => {
      const key = opt.group || "__ungrouped";
      if (!map.has(key)) map.set(key, [] as DropdownOption[]);
      map.get(key)!.push(opt);
      return map;
    }, new Map<string, DropdownOption[]>())
  );

  const selected = options.find((o) => o.value === value);

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((s) => !s)}
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-left text-sm ring-offset-background",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          disabled && "cursor-not-allowed bg-muted opacity-50"
        )}
      >
        <span className={cn(!selected && "text-muted-foreground")}>
          {selected ? selected.label : placeholder}
        </span>
        <svg
          className="ml-2 h-4 w-4 shrink-0 text-muted-foreground"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.25 8.29a.75.75 0 01-.02-1.08z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div
          ref={menuRef}
          className={cn(
            "absolute z-50 w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md",
            // Ensure the menu stays within the viewport height
            "max-h-[50vh] overflow-auto",
            // Prevent overflow on mobile small screens
            "sm:max-h-[60vh]",
            // Position above or below based on available space
            positionAbove ? "bottom-full mb-2" : "top-full mt-2"
          )}
        >
          <div className="py-1">
            {groups.map(([groupName, opts]) => (
              <div key={groupName}>
                {groupName !== "__ungrouped" && (
                  <div className="px-3 py-2 text-xs font-medium uppercase text-muted-foreground">
                    {groupName}
                  </div>
                )}
                {opts.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                      value === opt.value && "bg-accent/60"
                    )}
                  >
                    <span>{opt.label}</span>
                    {value === opt.value && (
                      <svg
                        className="h-4 w-4 text-primary"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.704 5.29a1 1 0 010 1.42l-7.01 7.01a1 1 0 01-1.42 0L3.296 8.742a1 1 0 111.414-1.414l4.153 4.153 6.303-6.303a1 1 0 011.538.112z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
