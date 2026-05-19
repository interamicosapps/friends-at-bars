import { appendDiagnosticLog, isDiagnosticLogEnabled } from "@/lib/diagnosticLog";

/**
 * Structured logs for diagnosing map pin + `live_locations` + Activities live counts.
 * Console: run `npm run dev`, or `VITE_DEBUG_LIVE_LOCATION=true`.
 * In-app Log screen: `VITE_ENABLE_DEV_TEST_MODE_UI=true` (see diagnosticLog).
 */
export function isLiveLocationDebugEnabled(): boolean {
  return (
    Boolean(import.meta.env.DEV) ||
    import.meta.env.VITE_DEBUG_LIVE_LOCATION === "true"
  );
}

export function liveLocLog(
  event: string,
  detail?: Record<string, unknown>,
  level: "info" | "warn" | "error" = "info"
): void {
  appendDiagnosticLog("liveLoc", event, detail, level);

  if (!isLiveLocationDebugEnabled()) return;
  if (detail !== undefined) {
    console.log(`[BarFest liveLoc] ${event}`, detail);
  } else {
    console.log(`[BarFest liveLoc] ${event}`);
  }
}

const throttleUntil = new Map<string, number>();

/** Same event key: log at most once per interval (ms). */
export function liveLocLogThrottle(
  key: string,
  intervalMs: number,
  event: string,
  detail?: Record<string, unknown>
): void {
  if (!isLiveLocationDebugEnabled() && !isDiagnosticLogEnabled()) {
    return;
  }
  const now = Date.now();
  const until = throttleUntil.get(key) ?? 0;
  if (now < until) return;
  throttleUntil.set(key, now + intervalMs);
  liveLocLog(event, detail);
}
