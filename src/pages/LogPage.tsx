import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Navigate } from "react-router-dom";
import { Trash2, Copy, RefreshCw } from "lucide-react";
import { isDevTestModeUiEnabled } from "@/config/devTestMode";
import {
  clearDiagnosticLog,
  getDiagnosticEntries,
  subscribeDiagnosticLog,
  type DiagnosticCategory,
  type DiagnosticEntry,
  appendDiagnosticLog,
} from "@/lib/diagnosticLog";
import {
  getLocationTrackingEnabled,
  locationService,
  usesIosNativeLiveLocation,
} from "@/lib/locationService";
import { getNativeTrackingState } from "@/lib/iosNativeLiveLocation";
import { liveLocLog } from "@/lib/liveLocationDebug";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

type FilterCategory = "all" | DiagnosticCategory;

function levelClass(level: DiagnosticEntry["level"]): string {
  if (level === "error") return "text-red-600";
  if (level === "warn") return "text-amber-700";
  return "text-foreground";
}

export default function LogPage() {
  const [, bump] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<FilterCategory>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const [status, setStatus] = useState<Record<string, unknown>>({});

  const refreshStatus = useCallback(async () => {
    const platform = Capacitor.getPlatform();
    const isNative = Capacitor.isNativePlatform();
    const permission = await locationService.checkPermissions();
    const tracking = getLocationTrackingEnabled();
    const userId = locationService.getUserId();
    const venueAt = await locationService.getCurrentLocation();
    const nearest =
      venueAt &&
      locationService.getVenueNameIfAtVenue(venueAt.latitude, venueAt.longitude);

    let nativeState: Awaited<ReturnType<typeof getNativeTrackingState>> = null;
    if (usesIosNativeLiveLocation()) {
      nativeState = await getNativeTrackingState();
    }

    const next = {
      platform,
      isNative,
      usesIosNativeLiveLocation: usesIosNativeLiveLocation(),
      capacitorPermissionGranted: permission,
      localStorageTrackingEnabled: tracking,
      userIdPrefix: userId.slice(0, 20),
      lastFix: venueAt
        ? {
            lat: venueAt.latitude,
            lon: venueAt.longitude,
            accuracy: venueAt.accuracy,
          }
        : null,
      nearestVenue: nearest,
      nativeEngine: nativeState,
      supabaseUrlConfigured: Boolean(import.meta.env.VITE_SUPABASE_URL),
      supabaseKeyConfigured: Boolean(
        import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
          import.meta.env.VITE_SUPABASE_ANON_KEY
      ),
    };
    setStatus(next);
    liveLocLog("Log page status refresh", next);
  }, []);

  useEffect(() => {
    appendDiagnosticLog("system", "Log page opened");
    void refreshStatus();
    const id = window.setInterval(() => void refreshStatus(), 8000);
    return () => window.clearInterval(id);
  }, [refreshStatus]);

  useEffect(() => {
    return subscribeDiagnosticLog(() => bump((n) => n + 1));
  }, []);

  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  });

  const entries = useMemo(() => {
    const all = getDiagnosticEntries();
    if (filter === "all") return [...all].reverse();
    return [...all].filter((e) => e.category === filter).reverse();
  }, [filter, status]);

  const copyLogs = async () => {
    const text = entries
      .map((e) => {
        const detail = e.detail ? ` ${JSON.stringify(e.detail)}` : "";
        return `${e.time} [${e.level}] [${e.category}] ${e.event}${detail}`;
      })
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      appendDiagnosticLog("system", "logs copied to clipboard");
    } catch {
      appendDiagnosticLog("system", "clipboard copy failed", {}, "warn");
    }
  };

  if (!isDevTestModeUiEnabled()) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 pb-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Live location log</h1>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void refreshStatus()}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            Status
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={copyLogs}>
            <Copy className="mr-1 h-3.5 w-3.5" />
            Copy
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              clearDiagnosticLog();
              appendDiagnosticLog("system", "log cleared");
            }}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
      </div>

      <pre className="max-h-40 overflow-auto rounded-lg border border-border bg-muted/40 p-2 text-[10px] leading-snug">
        {JSON.stringify(status, null, 2)}
      </pre>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {(["all", "liveLoc", "native", "permission", "supabase", "system"] as const).map(
          (cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setFilter(cat)}
              className={cn(
                "rounded-full border px-2 py-0.5",
                filter === cat
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card"
              )}
            >
              {cat}
            </button>
          )
        )}
        <label className="ml-auto flex items-center gap-1">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
          />
          Auto-scroll
        </label>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-card p-2 font-mono text-[11px] leading-relaxed"
      >
        {entries.length === 0 ? (
          <p className="text-muted-foreground">
            No entries yet. Turn on live tracking on Activities or Map, then lock the device
            and watch for native / liveLoc lines.
          </p>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="mb-2 border-b border-border/50 pb-2 last:border-0">
              <div className={levelClass(e.level)}>
                <span className="text-muted-foreground">{e.time}</span>{" "}
                <span className="font-semibold">[{e.category}]</span> {e.event}
              </div>
              {e.detail ? (
                <pre className="mt-0.5 whitespace-pre-wrap break-all text-muted-foreground">
                  {JSON.stringify(e.detail, null, 2)}
                </pre>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
