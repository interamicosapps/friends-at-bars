import { MapPinned } from "lucide-react";

export type LocationPermissionPromptVariant = "launch" | "map";

export interface MapLocationPermissionPromptProps {
  open: boolean;
  onAllow: () => void | Promise<void>;
  onSecondary: () => void;
  secondaryLabel: "Skip" | "Back";
  variant: LocationPermissionPromptVariant;
  busy?: boolean;
  coverNav?: boolean;
  /** Native: explain that the primary action opens system Settings. */
  nativeSettingsNote?: boolean;
  /** Web: show how to allow location via the browser site controls. */
  showWebLocationHelp?: boolean;
}

const COPY: Record<
  LocationPermissionPromptVariant,
  { description: string }
> = {
  launch: {
    description:
      "Find the best bars in your area and scope out their vibe. You can skip for now and explore the app - the map will ask again when you open it.",
  },
  map: {
    description:
      "The map needs your location to show where you are and what's nearby. Go back to keep browsing, or allow access to open the map.",
  },
};

function MapLocationPermissionPrompt({
  open,
  onAllow,
  onSecondary,
  secondaryLabel,
  variant,
  busy = false,
  coverNav = false,
  nativeSettingsNote = false,
  showWebLocationHelp = false,
}: MapLocationPermissionPromptProps) {
  if (!open) return null;

  const { description } = COPY[variant];
  const primaryLabel = busy
    ? "Opening..."
    : nativeSettingsNote
      ? "Open Settings"
      : "Allow location access";

  return (
    <div
      className={`flex flex-col bg-zinc-950 text-white ${
        coverNav
          ? "fixed inset-0 z-[200]"
          : "fixed inset-x-0 top-0 z-[100]"
      }`}
      style={
        coverNav
          ? { paddingTop: "var(--safe-area-inset-top)" }
          : {
              bottom: "calc(3.5rem + var(--safe-area-inset-bottom))",
              paddingTop: "var(--safe-area-inset-top)",
            }
      }
      role="dialog"
      aria-modal="true"
      aria-labelledby="location-prompt-title"
      aria-describedby="location-prompt-desc"
    >
      <div className="flex min-h-0 flex-1 flex-col px-6 pb-6 pt-4">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <h1
            id="location-prompt-title"
            className="text-balance text-2xl font-bold tracking-tight text-white sm:text-3xl"
          >
            Allow location access
          </h1>
          <p
            id="location-prompt-desc"
            className="mt-3 max-w-sm text-pretty text-base leading-relaxed text-zinc-400"
          >
            {description}
          </p>
          {nativeSettingsNote && (
            <p className="mt-2 max-w-sm text-pretty text-xs leading-relaxed text-zinc-500">
              The button below opens Settings for this app so you can turn Location
              on. Return here when you are done.
            </p>
          )}
          {showWebLocationHelp && (
            <p
              className="mt-3 max-w-sm text-pretty text-xs leading-relaxed text-amber-200/90"
              role="status"
            >
              If the browser did not ask for location: use the lock or site icon in
              the address bar, open site settings or permissions, set Location to
              Allow, then come back to this tab.
            </p>
          )}
          <div
            className="mt-10 flex h-36 w-36 items-center justify-center rounded-3xl bg-zinc-900/80 ring-1 ring-white/10"
            aria-hidden
          >
            <MapPinned
              className="h-20 w-20 text-rose-400/90"
              strokeWidth={1.25}
            />
          </div>
        </div>

        <div className="mt-auto flex w-full max-w-md flex-col gap-3 self-center pb-[var(--safe-area-inset-bottom)]">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onAllow()}
            className="w-full rounded-2xl bg-white py-3.5 text-center text-base font-semibold text-zinc-950 shadow-lg transition enabled:hover:bg-zinc-100 enabled:active:scale-[0.99] disabled:opacity-60"
          >
            {primaryLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onSecondary}
            className="w-full rounded-2xl border border-white/25 bg-transparent py-3.5 text-center text-base font-semibold text-white transition enabled:hover:bg-white/10 enabled:active:scale-[0.99] disabled:opacity-50"
          >
            {secondaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default MapLocationPermissionPrompt;
