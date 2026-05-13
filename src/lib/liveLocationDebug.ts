/**
 * Structured logs for diagnosing map pin + `live_locations` + Activities live counts.
 * Enable: run `npm run dev`, or set `VITE_DEBUG_LIVE_LOCATION=true` in `.env.local` for production builds.
 */
export function isLiveLocationDebugEnabled(): boolean {
  return (
    Boolean(import.meta.env.DEV) ||
    import.meta.env.VITE_DEBUG_LIVE_LOCATION === "true"
  );
}

export function liveLocLog(
  event: string,
  detail?: Record<string, unknown>
): void {
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
  if (!isLiveLocationDebugEnabled()) return;
  const now = Date.now();
  const until = throttleUntil.get(key) ?? 0;
  if (now < until) return;
  throttleUntil.set(key, now + intervalMs);
  liveLocLog(event, detail);
}
