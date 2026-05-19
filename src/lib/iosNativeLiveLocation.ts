import { Capacitor } from "@capacitor/core";
import { BarFestNativeLiveLocation } from "capacitor-barfest-native-live-location";
import { OHIO_STATE_VENUES } from "@/data/venues";
import {
  VENUE_LIVE_SUPABASE_HEARTBEAT_MS,
  VENUE_LOCATION_POLL_INTERVAL_MS,
} from "@/constants/liveLocation";
import { appendDiagnosticLog } from "@/lib/diagnosticLog";
import { liveLocLog } from "@/lib/liveLocationDebug";

const VENUE_RADIUS_METERS = 100;

let nativeListenersReady = false;
let nativeLocationHandler:
  | ((loc: { latitude: number; longitude: number }) => void)
  | null = null;

export function usesIosNativeLiveLocation(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

function getSupabasePublicConfig(): { url: string; key: string } {
  const env = import.meta.env;
  return {
    url: (env.VITE_SUPABASE_URL as string | undefined) ?? "",
    key:
      (env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
      (env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
      "",
  };
}

function ensureNativePluginListeners(
  onAuthorizationLost: () => void,
  onWriteError?: (message: string) => void
): void {
  if (nativeListenersReady || !usesIosNativeLiveLocation()) return;
  nativeListenersReady = true;

  void BarFestNativeLiveLocation.addListener("locationUpdate", (event) => {
    appendDiagnosticLog("native", "locationUpdate", {
      latitude: event.latitude,
      longitude: event.longitude,
    });
    nativeLocationHandler?.({
      latitude: event.latitude,
      longitude: event.longitude,
    });
  });

  void BarFestNativeLiveLocation.addListener("authorizationLost", () => {
    appendDiagnosticLog("native", "authorizationLost", {}, "warn");
    liveLocLog("native authorizationLost");
    onAuthorizationLost();
  });

  void BarFestNativeLiveLocation.addListener("writeError", (event) => {
    appendDiagnosticLog("native", "writeError", { message: event.message }, "error");
    liveLocLog("native writeError", { message: event.message });
    onWriteError?.(event.message);
  });
}

export async function configureNativeLiveTracking(
  userId: string,
  skipSupabase: boolean,
  onAuthorizationLost: () => void,
  onWriteError?: (message: string) => void
): Promise<void> {
  if (!usesIosNativeLiveLocation()) return;

  ensureNativePluginListeners(onAuthorizationLost, onWriteError);

  const { url, key } = getSupabasePublicConfig();
  if (!skipSupabase && (!url || !key)) {
    throw new Error(
      "Supabase URL and public key are required for native live tracking."
    );
  }

  appendDiagnosticLog("native", "configure", {
    skipSupabase,
    userIdPrefix: userId.slice(0, 12),
    venueCount: OHIO_STATE_VENUES.length,
    heartbeatMs: VENUE_LIVE_SUPABASE_HEARTBEAT_MS,
    pollIntervalMs: VENUE_LOCATION_POLL_INTERVAL_MS,
    hasSupabaseUrl: Boolean(url),
    hasSupabaseKey: Boolean(key),
  });

  await BarFestNativeLiveLocation.configure({
    supabaseUrl: url,
    supabaseAnonKey: key,
    userId,
    venues: OHIO_STATE_VENUES,
    venuesJson: JSON.stringify(OHIO_STATE_VENUES),
    heartbeatMs: VENUE_LIVE_SUPABASE_HEARTBEAT_MS,
    pollIntervalMs: VENUE_LOCATION_POLL_INTERVAL_MS,
    venueRadiusMeters: VENUE_RADIUS_METERS,
    skipSupabase,
  });

  liveLocLog("native live location configured", { skipSupabase, userId });
}

export async function startNativeLiveTracking(
  onLocationUpdate: (loc: { latitude: number; longitude: number }) => void
): Promise<void> {
  if (!usesIosNativeLiveLocation()) return;
  nativeLocationHandler = onLocationUpdate;
  appendDiagnosticLog("native", "startTracking");
  await BarFestNativeLiveLocation.startTracking();
  const state = await getNativeTrackingState();
  appendDiagnosticLog("native", "startTracking complete", { state: state ?? undefined });
  liveLocLog("native live tracking started", { state });
}

export async function stopNativeLiveTracking(): Promise<void> {
  if (!usesIosNativeLiveLocation()) return;
  nativeLocationHandler = null;
  appendDiagnosticLog("native", "stopTracking");
  await BarFestNativeLiveLocation.stopTracking();
  liveLocLog("native live tracking stopped");
}

export async function getNativeTrackingState(): Promise<{
  isRunning: boolean;
  lastVenue: string | null;
  lastWriteAtMs: number;
} | null> {
  if (!usesIosNativeLiveLocation()) return null;
  try {
    const state = await BarFestNativeLiveLocation.getState();
    return {
      isRunning: state.isRunning,
      lastVenue: state.lastVenue ?? null,
      lastWriteAtMs: state.lastWriteAtMs,
    };
  } catch (e) {
    liveLocLog(
      "native getState failed",
      { message: e instanceof Error ? e.message : String(e) },
      "warn"
    );
    return null;
  }
}
