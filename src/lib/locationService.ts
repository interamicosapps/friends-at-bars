/**
 * Native location boundary: @capacitor/geolocation + @capacitor-community/background-geolocation (iOS).
 * Plugin versions (see package-lock): geolocation 7.x; background-geolocation 1.2.x.
 * iOS Info.plist: NSLocationWhenInUseUsageDescription, NSLocationAlwaysAndWhenInUseUsageDescription,
 * UIBackgroundModes location (background plugin). Geolocation README also requires Always+WhenInUse
 * because ion-ios-geolocation may report in background.
 */
import { Capacitor } from "@capacitor/core";
import { Geolocation as CapacitorGeolocation } from "@capacitor/geolocation";
import {
  NativeSettings,
  AndroidSettings,
  IOSSettings,
} from "capacitor-native-settings";
import {
  supabase,
  logSupabaseNetworkOnce,
  isSupabaseNetworkError,
  wasSupabaseNetworkError,
} from "./supabaseClient";
import { OHIO_STATE_VENUES } from "@/data/venues";
import {
  LIVE_LOCATION_MAX_AGE_MS,
  LIVE_LOCATION_STALE_MS,
  VENUE_LIVE_SUPABASE_HEARTBEAT_MS,
} from "@/constants/liveLocation";
import { LiveLocationInsert, VenueCounts, Venue } from "@/types/checkin";

interface LocationData {
  latitude: number;
  longitude: number;
  accuracy: number;
}

interface VenueMatch {
  venue: Venue;
  distance: number;
}

// Type definitions for geolocation
interface GeolocationPosition {
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
  };
}

interface GeolocationPositionError {
  code: number;
  message: string;
}

/** Browser GeolocationPositionError codes (mdn) */
const GEO_ERR = {
  1: "PERMISSION_DENIED",
  2: "POSITION_UNAVAILABLE",
  3: "TIMEOUT",
} as const;

const LOG_PREFIX = "[BarFest location]";

function logGeoError(
  step: string,
  err: unknown,
  extra?: Record<string, unknown>
): void {
  if (err && typeof err === "object" && "code" in err && "message" in err) {
    const e = err as GeolocationPositionError;
    const name = GEO_ERR[e.code as keyof typeof GEO_ERR] ?? `UNKNOWN(${e.code})`;
    console.warn(LOG_PREFIX, step, {
      code: e.code,
      name,
      message: e.message,
      ...extra,
    });
  } else {
    console.warn(LOG_PREFIX, step, err, extra);
  }
}

/** @capacitor/geolocation native error codes (README Errors table) */
const CAP_GEO_DENIED = "OS-PLUG-GLOC-0003";
const CAP_GEO_RESTRICTED = "OS-PLUG-GLOC-0008";
const CAP_GEO_SERVICES_OFF = "OS-PLUG-GLOC-0007";

export type LocationWatchErrorKind =
  | "permission_denied"
  | "restricted"
  | "location_off"
  | "timeout"
  | "unavailable"
  | "unknown";

export type ParsedLocationWatchError = {
  kind: LocationWatchErrorKind;
  /** Short UI string */
  message: string;
  raw?: unknown;
};

function extractCapacitorErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const o = err as Record<string, unknown>;
  if (typeof o.code === "string") return o.code;
  const msg = typeof o.message === "string" ? o.message : "";
  const m = msg.match(/OS-PLUG-GLOC-\d{4}/);
  return m ? m[0] : undefined;
}

/** Map native Capacitor geolocation errors + web numeric codes to UI-friendly categories. */
export function parseLocationWatchError(err: unknown): ParsedLocationWatchError {
  const capCode = extractCapacitorErrorCode(err);
  if (capCode === CAP_GEO_DENIED) {
    return {
      kind: "permission_denied",
      message:
        "Location access was denied. Enable it in Settings to keep live tracking on.",
      raw: err,
    };
  }
  if (capCode === CAP_GEO_RESTRICTED) {
    return {
      kind: "restricted",
      message:
        "Location is restricted on this device (Screen Time or policy). Live tracking was turned off.",
      raw: err,
    };
  }
  if (capCode === CAP_GEO_SERVICES_OFF) {
    return {
      kind: "location_off",
      message:
        "Location Services are off. Turn them on in Settings to use live tracking.",
      raw: err,
    };
  }
  if (capCode === "OS-PLUG-GLOC-0010") {
    return {
      kind: "timeout",
      message: "Location timed out. Try again or move to an area with better GPS.",
      raw: err,
    };
  }
  if (err && typeof err === "object" && "code" in err) {
    const c = (err as GeolocationPositionError).code;
    if (c === 1) {
      return {
        kind: "permission_denied",
        message:
          "Location permission was denied. Allow location for this site or app to keep tracking.",
        raw: err,
      };
    }
    if (c === 2) {
      return {
        kind: "unavailable",
        message: "Position unavailable. Check GPS or network location.",
        raw: err,
      };
    }
    if (c === 3) {
      return {
        kind: "timeout",
        message: "Location timed out. Try again.",
        raw: err,
      };
    }
  }
  return {
    kind: "unknown",
    message: "Location update failed. Try toggling tracking off and on.",
    raw: err,
  };
}

export function isFatalLocationWatchError(parsed: ParsedLocationWatchError): boolean {
  return (
    parsed.kind === "permission_denied" ||
    parsed.kind === "restricted" ||
    parsed.kind === "location_off"
  );
}

const permissionLostListeners = new Set<() => void>();
const appResumeListeners = new Set<() => void>();
let appResumeListenerHandle: { remove: () => Promise<void> } | null = null;

/** Called when background watcher reports NOT_AUTHORIZED or similar; UI should stop tracking. */
export function subscribeLocationPermissionLost(cb: () => void): () => void {
  permissionLostListeners.add(cb);
  return () => permissionLostListeners.delete(cb);
}

function notifyLocationPermissionLost(): void {
  permissionLostListeners.forEach((cb) => {
    try {
      cb();
    } catch (e) {
      console.warn(LOG_PREFIX, "permissionLost listener error", e);
    }
  });
}

let appResumeListenerPending: Promise<void> | null = null;

async function ensureNativeAppResumeListener(): Promise<void> {
  if (!Capacitor.isNativePlatform() || appResumeListenerHandle) return;
  if (appResumeListenerPending) {
    await appResumeListenerPending;
    return;
  }
  appResumeListenerPending = (async () => {
    const { App } = await import("@capacitor/app");
    if (!appResumeListenerHandle) {
      appResumeListenerHandle = await App.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) return;
        appResumeListeners.forEach((cb) => {
          try {
            cb();
          } catch (e) {
            console.warn(LOG_PREFIX, "app resume listener error", e);
          }
        });
      });
    }
  })();
  try {
    await appResumeListenerPending;
  } finally {
    appResumeListenerPending = null;
  }
}

/**
 * Native only: run callbacks when app becomes active (e.g. user changed location permission in Settings).
 */
export function subscribeNativeAppResume(callback: () => void): () => void {
  if (!Capacitor.isNativePlatform()) {
    return () => {};
  }
  appResumeListeners.add(callback);
  void ensureNativeAppResumeListener();
  return () => {
    appResumeListeners.delete(callback);
    if (appResumeListeners.size === 0 && appResumeListenerHandle) {
      const h = appResumeListenerHandle;
      appResumeListenerHandle = null;
      void h.remove();
    }
  };
}

// Calculate distance between two coordinates using Haversine formula (in meters)
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

// Find which venue (if any) the user is at (within 100m radius)
function findNearestVenue(
  latitude: number,
  longitude: number,
  radiusMeters: number = 100
): VenueMatch | null {
  let closestMatch: VenueMatch | null = null;
  let minDistance = radiusMeters;

  for (const venue of OHIO_STATE_VENUES) {
    const distance = calculateDistance(
      latitude,
      longitude,
      venue.coordinates[0],
      venue.coordinates[1]
    );

    if (distance < minDistance) {
      minDistance = distance;
      closestMatch = { venue, distance };
    }
  }

  return closestMatch;
}

const LOCATION_TRACKING_ENABLED_KEY = "location_tracking_enabled";
const BACKGROUND_LOCATION_PREFERRED_KEY = "background_location_preferred";

/** Persist user's choice so tracking stays on across navigation and app restarts. */
export function getLocationTrackingEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(LOCATION_TRACKING_ENABLED_KEY) === "true";
}

export function setLocationTrackingEnabled(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LOCATION_TRACKING_ENABLED_KEY, String(enabled));
}

/** User prefers "Always" / background location (native only). Defaults to true when unset. */
export function getBackgroundLocationPreferred(): boolean {
  if (typeof localStorage === "undefined") return true;
  const raw = localStorage.getItem(BACKGROUND_LOCATION_PREFERRED_KEY);
  if (raw === null) return true;
  return raw === "true";
}

export function setBackgroundLocationPreferred(preferred: boolean): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(BACKGROUND_LOCATION_PREFERRED_KEY, String(preferred));
}

// Generate anonymous user ID (store in localStorage)
function getUserId(): string {
  let userId = localStorage.getItem("location_user_id");
  if (!userId) {
    userId = `anon_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    localStorage.setItem("location_user_id", userId);
  }
  return userId;
}

// Web Geolocation implementation (browser API)
const webGeolocation = {
  async requestPermissions(): Promise<boolean> {
    // Browser geolocation doesn't have explicit permission request
    // We check by attempting to get position
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        console.warn("Geolocation is not supported by this browser");
        resolve(false);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        () => {
          console.log("Web geolocation permission granted");
          resolve(true);
        },
        (error) => {
          console.warn(
            "Web geolocation permission error:",
            error.code,
            error.message
          );
          // Error code 1 = PERMISSION_DENIED
          // Error code 2 = POSITION_UNAVAILABLE
          // Error code 3 = TIMEOUT
          resolve(false);
        },
        {
          timeout: 10000, // Increased from 1000ms to 10000ms to allow time for user to respond
          enableHighAccuracy: false, // Use less accurate for permission check to be faster
          maximumAge: 0, // Don't use cached position
        }
      );
    });
  },

  async checkPermissions(): Promise<boolean> {
    // Browser geolocation permission check via Permissions API if available
    if ("permissions" in navigator && "query" in navigator.permissions) {
      try {
        const result = await navigator.permissions.query({
          name: "geolocation",
        });
        const isGranted = result.state === "granted";
        console.log("Web geolocation permission state:", result.state);

        // Listen for permission state changes (for reactive updates)
        result.onchange = () => {
          console.log(
            "Web geolocation permission state changed to:",
            result.state
          );
        };

        return isGranted;
      } catch (error) {
        console.warn(
          "Permissions API not fully supported, falling back:",
          error
        );
        // Permissions API not fully supported, try via getCurrentPosition
        // But don't prompt - just check silently
        return new Promise((resolve) => {
          if (!navigator.geolocation) {
            resolve(false);
            return;
          }
          navigator.geolocation.getCurrentPosition(
            () => resolve(true),
            () => resolve(false),
            { timeout: 1000, maximumAge: Infinity } // Use cached if available, quick check
          );
        });
      }
    }
    // Fallback: try to get position silently (won't prompt if denied)
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(false);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        () => resolve(true),
        () => resolve(false),
        { timeout: 1000, maximumAge: Infinity } // Use cached if available, quick check
      );
    });
  },

  async getCurrentPosition(options?: {
    enableHighAccuracy?: boolean;
    timeout?: number;
    maximumAge?: number;
  }): Promise<GeolocationPosition> {
    const opts = {
      enableHighAccuracy: options?.enableHighAccuracy ?? true,
      timeout: options?.timeout ?? 10000,
      maximumAge: options?.maximumAge ?? 0,
    };
    console.log(LOG_PREFIX, "getCurrentPosition attempt", opts);
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        console.error(LOG_PREFIX, "navigator.geolocation is not available");
        reject(new Error("Geolocation not supported"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position: GeolocationPosition) => {
          console.log(LOG_PREFIX, "getCurrentPosition success", {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
          resolve(position);
        },
        (error: GeolocationPositionError) => {
          logGeoError("getCurrentPosition error", error, opts);
          reject(error);
        },
        opts
      );
    });
  },

  async watchPosition(
    options: {
      enableHighAccuracy?: boolean;
      timeout?: number;
      maximumAge?: number;
    },
    callback: (
      position: GeolocationPosition | null,
      error?: GeolocationPositionError
    ) => void
  ): Promise<number> {
    const watchOpts = {
      enableHighAccuracy: options.enableHighAccuracy ?? true,
      timeout: options.timeout ?? 10000,
      maximumAge: options.maximumAge ?? 0,
    };
    console.log(LOG_PREFIX, "watchPosition start", watchOpts);
    const watchId = navigator.geolocation.watchPosition(
      (position: GeolocationPosition) => callback(position),
      (error: GeolocationPositionError) => callback(null, error),
      watchOpts
    );
    return watchId;
  },

  async clearWatch(watchId: number | string): Promise<void> {
    navigator.geolocation.clearWatch(Number(watchId));
  },
};

// Platform detection and geolocation adapter
const isNative = Capacitor.isNativePlatform();
export { isNative as isNativePlatform };

export type OpenNativeAppSettingsResult =
  | { ok: true }
  | { ok: false; displayText: string };

function buildSettingsOpenFailureDisplay(
  platform: string,
  summary: string,
  detail?: string
): string {
  const d = detail?.trim() || "(none)";
  return [
    "Couldn't open Settings from the app.",
    "",
    summary,
    "",
    "Detail for support (copy everything below this line):",
    "---",
    `platform=${platform}`,
    d,
  ].join("\n");
}

/** iOS / Android: opens system Settings for this app (app page on iOS, app details on Android). */
export async function openNativeAppLocationSettings(): Promise<OpenNativeAppSettingsResult> {
  if (!Capacitor.isNativePlatform()) {
    return {
      ok: false,
      displayText: buildSettingsOpenFailureDisplay(
        "web-or-unknown",
        "Not running inside the native app shell.",
        "Capacitor.isNativePlatform() is false"
      ),
    };
  }
  const platform = Capacitor.getPlatform();
  if (platform !== "ios" && platform !== "android") {
    return {
      ok: false,
      displayText: buildSettingsOpenFailureDisplay(
        platform,
        "Opening Settings is only set up for iOS and Android.",
        `getPlatform()=${platform}`
      ),
    };
  }
  try {
    const result = await NativeSettings.open({
      optionAndroid: AndroidSettings.ApplicationDetails,
      optionIOS: IOSSettings.App,
    });
    if (result && typeof result === "object" && result.status === false) {
      return {
        ok: false,
        displayText: buildSettingsOpenFailureDisplay(
          platform,
          "The system reported that Settings did not open.",
          `NativeSettings.open returned status=false: ${JSON.stringify(result)}`
        ),
      };
    }
    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    console.warn(LOG_PREFIX, "openNativeAppLocationSettings failed", e);
    return {
      ok: false,
      displayText: buildSettingsOpenFailureDisplay(
        platform,
        msg || "Unknown error",
        stack ? `${msg}\n${stack}` : msg
      ),
    };
  }
}

// Throttle background Supabase writes: same heartbeat as foreground; venue change writes immediately.
let lastBackgroundSupabaseWriteAt = 0;
let lastBackgroundWrittenVenueName: string | null = null;

/** Tracks whether background samples last placed the user inside a geofenced venue. */
type BackgroundVenuePresence = "unknown" | "inside" | "outside";
let backgroundVenuePresence: BackgroundVenuePresence = "outside";

export const locationService = {
  // Request location permissions. Does not call the system dialog if permission is already granted (avoids iOS re-prompt on every app open).
  async requestPermissions(): Promise<boolean> {
    try {
      if (isNative) {
        const alreadyGranted = await this.checkPermissions();
        if (alreadyGranted) {
          console.log("Location permission already granted, skipping request");
          return true;
        }
        console.log("Requesting native location permissions...");
        const status = await CapacitorGeolocation.requestPermissions();
        const granted = status.location === "granted";
        console.log(
          "Native location permission status:",
          status.location,
          "Granted:",
          granted
        );
        return granted;
      }
      const alreadyGranted = await this.checkPermissions();
      if (alreadyGranted) return true;
      console.log("Requesting web location permissions...");
      return await webGeolocation.requestPermissions();
    } catch (error) {
      console.error("Permission request failed:", error);
      return false;
    }
  },

  // Check current permissions
  async checkPermissions(): Promise<boolean> {
    try {
      if (isNative) {
        const status = await CapacitorGeolocation.checkPermissions();
        const granted = status.location === "granted";
        console.log(
          "Native location permission check:",
          status.location,
          "Granted:",
          granted
        );
        return granted;
      }
      return await webGeolocation.checkPermissions();
    } catch (error) {
      console.warn("Permission check failed:", error);
      return false;
    }
  },

  // Get current location (one-time)
  async getCurrentLocation(): Promise<LocationData | null> {
    try {
      if (isNative) {
        // Battery-first on iOS/Android: coarse fix + cache, then high accuracy if needed for venue checks.
        try {
          const capPosition = await CapacitorGeolocation.getCurrentPosition({
            enableHighAccuracy: false,
            timeout: 15000,
            maximumAge: 20000,
          });
          console.log(LOG_PREFIX, "native getCurrentPosition success (balanced)", {
            lat: capPosition.coords.latitude,
            lon: capPosition.coords.longitude,
          });
          return {
            latitude: capPosition.coords.latitude,
            longitude: capPosition.coords.longitude,
            accuracy: capPosition.coords.accuracy || 0,
          };
        } catch (e) {
          console.warn(LOG_PREFIX, "native getCurrentPosition balanced attempt failed", e);
          try {
            const capPosition = await CapacitorGeolocation.getCurrentPosition({
              enableHighAccuracy: true,
              timeout: 12000,
              maximumAge: 0,
            });
            console.log(LOG_PREFIX, "native getCurrentPosition retry (high accuracy) success");
            return {
              latitude: capPosition.coords.latitude,
              longitude: capPosition.coords.longitude,
              accuracy: capPosition.coords.accuracy || 0,
            };
          } catch (e2) {
            console.warn(LOG_PREFIX, "native getCurrentPosition retry failed", e2);
            return null;
          }
        }
      }

      // Web: high accuracy often times out on desktop — retry with low accuracy + cached position
      try {
        const position = await webGeolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        });
        return {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy || 0,
        };
      } catch (firstErr) {
        logGeoError(
          "getCurrentLocation web first attempt failed; retrying with low accuracy + maxAge",
          firstErr
        );
        try {
          const position = await webGeolocation.getCurrentPosition({
            enableHighAccuracy: false,
            timeout: 20000,
            maximumAge: 300000, // 5 min cache acceptable for initial fix
          });
          console.log(LOG_PREFIX, "web getCurrentPosition retry success");
          return {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy || 0,
          };
        } catch (secondErr) {
          logGeoError("getCurrentLocation web retry also failed", secondErr, {
            hint: "Check browser site permissions, HTTPS, and system location services.",
          });
          return null;
        }
      }
    } catch (error) {
      console.error(LOG_PREFIX, "getCurrentLocation unexpected error", error);
      return null;
    }
  },

  // Start watching location (for continuous updates)
  async watchPosition(
    callback: (
      location: LocationData | null,
      watchError?: ParsedLocationWatchError
    ) => void,
    options?: {
      enableHighAccuracy?: boolean;
      timeout?: number;
      maximumAge?: number;
    }
  ): Promise<string> {
    if (isNative) {
      const watchId = await CapacitorGeolocation.watchPosition(
        {
          enableHighAccuracy: options?.enableHighAccuracy ?? false,
          timeout: options?.timeout ?? 20000,
          maximumAge: options?.maximumAge ?? 10000,
        },
        (
          position: GeolocationPosition | null,
          err?: GeolocationPositionError
        ) => {
          if (err) {
            const parsed = parseLocationWatchError(err);
            console.warn(LOG_PREFIX, "native watchPosition error", parsed.kind, err);
            callback(null, parsed);
            return;
          }

          if (position) {
            callback({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy || 0,
            });
          }
        }
      );

      return watchId;
    } else {
      const watchId = await webGeolocation.watchPosition(
        {
          enableHighAccuracy: options?.enableHighAccuracy ?? false,
          timeout: options?.timeout ?? 15000,
          maximumAge: options?.maximumAge ?? 0,
        },
        (
          position: GeolocationPosition | null,
          err?: GeolocationPositionError
        ) => {
          if (err) {
            logGeoError("watchPosition callback error", err);
            callback(null, parseLocationWatchError(err));
            return;
          }

          if (position) {
            callback({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy || 0,
            });
          }
        }
      );

      return String(watchId);
    }
  },

  // Stop watching location
  async clearWatch(watchId: string): Promise<void> {
    if (isNative) {
      await CapacitorGeolocation.clearWatch({ id: watchId });
    } else {
      await webGeolocation.clearWatch(watchId);
    }
  },

  /**
   * Start background location watcher (native only). Use when user prefers "Always" and tracking is on.
   * Returns watcher id to pass to stopBackgroundWatcher, or null if not native or plugin unavailable.
   */
  async startBackgroundWatcher(skipSupabase: boolean): Promise<string | null> {
    if (!isNative) return null;
    backgroundVenuePresence = "unknown";
    lastBackgroundSupabaseWriteAt = 0;
    lastBackgroundWrittenVenueName = null;
    try {
      const { registerPlugin } = await import("@capacitor/core");
      const BackgroundGeolocation = registerPlugin<{
        addWatcher: (options: {
          backgroundMessage?: string;
          backgroundTitle?: string;
          requestPermissions?: boolean;
          stale?: boolean;
          distanceFilter?: number;
        }, callback: (location: { latitude: number; longitude: number; accuracy?: number } | null, error?: { code: string }) => void) => Promise<string>;
        removeWatcher: (options: { id: string }) => Promise<void>;
      }>("BackgroundGeolocation");
      const watcherId = await BackgroundGeolocation.addWatcher(
        {
          backgroundMessage: "Bar Fest uses your location to update bar counts when you're nearby.",
          backgroundTitle: "Bar Fest",
          // Foreground flow already requested via @capacitor/geolocation; avoids duplicate prompts.
          requestPermissions: false,
          stale: false,
          distanceFilter: 75,
        },
        (location, error) => {
          if (error?.code === "NOT_AUTHORIZED") {
            setLocationTrackingEnabled(false);
            notifyLocationPermissionLost();
            return;
          }
          if (!location) return;
          const now = Date.now();
          const venueMatch = findNearestVenue(
            location.latitude,
            location.longitude
          );
          const venueName = venueMatch?.venue.name ?? null;

          if (!venueName) {
            if (backgroundVenuePresence !== "outside") {
              backgroundVenuePresence = "outside";
              lastBackgroundWrittenVenueName = null;
              lastBackgroundSupabaseWriteAt = 0;
              if (!skipSupabase) {
                locationService
                  .deactivateUserLocation()
                  .catch((err) =>
                    console.error("Background deactivate location failed:", err)
                  );
              }
            }
            return;
          }

          const venueChanged = venueName !== lastBackgroundWrittenVenueName;
          const heartbeatDue =
            now - lastBackgroundSupabaseWriteAt >=
            VENUE_LIVE_SUPABASE_HEARTBEAT_MS;

          if (!skipSupabase && (venueChanged || heartbeatDue)) {
            lastBackgroundSupabaseWriteAt = now;
            lastBackgroundWrittenVenueName = venueName;
            backgroundVenuePresence = "inside";
            locationService
              .updateLiveLocation({
                latitude: location.latitude,
                longitude: location.longitude,
                accuracy: location.accuracy ?? 0,
              })
              .catch((err) =>
                console.error("Background location update failed:", err)
              );
          } else if (!skipSupabase) {
            backgroundVenuePresence = "inside";
          }
        }
      );
      return watcherId;
    } catch (e) {
      console.warn("Background geolocation not available:", e);
      return null;
    }
  },

  async stopBackgroundWatcher(watcherId: string | null): Promise<void> {
    if (!watcherId || !isNative) return;
    backgroundVenuePresence = "outside";
    lastBackgroundWrittenVenueName = null;
    lastBackgroundSupabaseWriteAt = 0;
    try {
      const { registerPlugin } = await import("@capacitor/core");
      const BackgroundGeolocation = registerPlugin<{ removeWatcher: (options: { id: string }) => Promise<void> }>("BackgroundGeolocation");
      await BackgroundGeolocation.removeWatcher({ id: watcherId });
    } catch (e) {
      console.warn("Stop background watcher failed:", e);
    }
  },

  // Update user's live location in database
  async updateLiveLocation(location: LocationData): Promise<void> {
    const userId = getUserId();
    const venueMatch = findNearestVenue(location.latitude, location.longitude);

    // Only update backend if at a venue
    // If not at venue, do nothing (no backend effect)
    if (!venueMatch) {
      return; // No backend update when not at venue
    }

    const nowIso = new Date().toISOString();
    // User is at a venue - upsert location (always refresh last_updated for live counts)
    const locationData: LiveLocationInsert = {
      user_id: userId,
      venue_name: venueMatch.venue.name,
      latitude: location.latitude,
      longitude: location.longitude,
      is_active: true,
      last_updated: nowIso,
    };

    const { error } = await supabase
      .from("live_locations")
      .upsert(locationData, {
        onConflict: "user_id",
      });

    if (error) {
      if (isSupabaseNetworkError(error)) {
        logSupabaseNetworkOnce(error);
        return;
      }
      console.error("Error updating live location:", error);
    }
  },

  // Deactivate user's location in database (when tracking stops)
  async deactivateUserLocation(): Promise<void> {
    const userId = getUserId();
    const { error } = await supabase
      .from("live_locations")
      .update({
        is_active: false,
        last_updated: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (error) {
      if (isSupabaseNetworkError(error)) {
        logSupabaseNetworkOnce(error);
        return;
      }
      if (error.code !== "PGRST116") {
        // PGRST116 means no rows matched, which is fine
        console.error("Error deactivating live location:", error);
      }
    }
  },

  // Check if location is at a venue (exposed for LocationToggle to check before backend updates)
  checkIfAtVenue(latitude: number, longitude: number): boolean {
    const venueMatch = findNearestVenue(latitude, longitude);
    return venueMatch !== null;
  },

  /** Venue name within geofence radius, or null if not at any venue. */
  getVenueNameIfAtVenue(latitude: number, longitude: number): string | null {
    const venueMatch = findNearestVenue(latitude, longitude);
    return venueMatch?.venue.name ?? null;
  },

  // Get live user counts per venue
  async getVenueCounts(): Promise<VenueCounts> {
    const freshAfter = new Date(
      Date.now() - LIVE_LOCATION_MAX_AGE_MS
    ).toISOString();
    const { data, error } = await supabase
      .from("live_locations")
      .select("venue_name")
      .eq("is_active", true)
      .gte("last_updated", freshAfter);

    if (error) {
      if (isSupabaseNetworkError(error)) {
        logSupabaseNetworkOnce(error);
        return {};
      }
      console.error("Error fetching venue counts:", error);
      return {};
    }

    // Count users per venue
    const counts: VenueCounts = {};
    data?.forEach((location) => {
      if (!counts[location.venue_name]) {
        counts[location.venue_name] = 0;
      }
      counts[location.venue_name]++;
    });

    return counts;
  },

  // Subscribe to real-time venue count updates (requires `live_locations` enabled for Realtime in Supabase Dashboard).
  subscribeToVenueCounts(callback: (counts: VenueCounts) => void) {
    const channel = supabase
      .channel("live_locations")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "live_locations",
        },
        async () => {
          const counts = await locationService.getVenueCounts();
          callback(counts);
        }
      );

    const subRef: { current: { unsubscribe: () => void } | null } = {
      current: null,
    };

    // Fetch initial counts first; only subscribe to Realtime if backend is reachable
    locationService.getVenueCounts().then((counts) => {
      callback(counts);
      if (!wasSupabaseNetworkError()) {
        channel.subscribe();
        subRef.current = channel;
      }
    });

    return {
      unsubscribe: () => {
        subRef.current?.unsubscribe();
      },
    };
  },

  // Cleanup: deactivate rows with stale last_updated (matches live count window)
  async cleanupStaleLocations(): Promise<void> {
    const staleBefore = new Date(
      Date.now() - LIVE_LOCATION_STALE_MS
    ).toISOString();

    const { error } = await supabase
      .from("live_locations")
      .update({
        is_active: false,
        last_updated: new Date().toISOString(),
      })
      .lt("last_updated", staleBefore)
      .eq("is_active", true);

    if (error) {
      console.error("Error cleaning up stale locations:", error);
    }
  },

  // Get anonymous user ID
  getUserId,
};
