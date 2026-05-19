import { useState, useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { MapPin, MapPinOff } from "lucide-react";
import {
  locationService,
  getLocationTrackingEnabled,
  setLocationTrackingEnabled,
  getBackgroundLocationPreferred,
  isNativePlatform,
  usesIosNativeLiveLocation,
  isFatalLocationWatchError,
  subscribeNativeAppResume,
  subscribeLocationPermissionLost,
} from "@/lib/locationService";
import {
  configureNativeLiveTracking,
  getNativeTrackingState,
  startNativeLiveTracking,
  stopNativeLiveTracking,
} from "@/lib/iosNativeLiveLocation";
import { Button } from "@/components/ui/Button";
import {
  VENUE_LIVE_SUPABASE_HEARTBEAT_MS,
  VENUE_LOCATION_POLL_INTERVAL_MS,
} from "@/constants/liveLocation";
import { liveLocLog, liveLocLogThrottle } from "@/lib/liveLocationDebug";
import type { LocationToggleRef } from "@/contexts/locationTrackingContext";

export type { LocationToggleRef };

interface LocationToggleProps {
  onLocationUpdate?: (location: { latitude: number; longitude: number } | null) => void;
  skipSupabase?: boolean; // If true, skip Supabase updates (for local-only testing)
  /** When "compact", renders a small square (icon only, three dots when loading). */
  variant?: "default" | "compact";
  /** Called when enabled state changes (for parent to show/hide location dialog). */
  onEnabledChange?: (enabled: boolean) => void;
  /**
   * If true, immediately restart tracking when the toggle mounts if the user had left tracking on.
   * Default false: defer until Activities/Map call restorePersistedTrackingIfNeeded (clearer permission context).
   */
  autoRestoreTracking?: boolean;
}

const LocationToggle = forwardRef<LocationToggleRef, LocationToggleProps>(function LocationToggle(
  {
    onLocationUpdate,
    skipSupabase = false,
    variant = "default",
    onEnabledChange,
    autoRestoreTracking = false,
  },
  ref
) {
  const [isEnabled, setIsEnabled] = useState(() => getLocationTrackingEnabled());
  const [hasPermission, setHasPermission] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<string | null>(null);
  const updateIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const backgroundWatcherIdRef = useRef<string | null>(null);
  /** Last venue written to Supabase for heartbeat / venue-change logic. */
  const lastSupabaseVenueRef = useRef<string | null>(null);
  const lastSupabaseWriteAtRef = useRef<number>(0);
  /** Foreground poll: venue detection + conditional Supabase heartbeat. */
  const venuePresenceRef = useRef<"unknown" | "inside" | "outside">("outside");
  const isEnabledRef = useRef(isEnabled);
  const isLoadingRef = useRef(false);
  const hasAutoRestoredRef = useRef(false);
  /** True only while watch / poll / native engine is actually running. */
  const sessionActiveRef = useRef(false);
  const [backgroundPreferred] = useState(() => getBackgroundLocationPreferred());

  // Keep ref in sync with state and notify parent
  useEffect(() => {
    isEnabledRef.current = isEnabled;
    onEnabledChange?.(isEnabled);
  }, [isEnabled, onEnabledChange]);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  // Optional cold-start restore (e.g. Test page). Map/Activities use restorePersistedTrackingIfNeeded instead.
  useEffect(() => {
    if (!autoRestoreTracking || hasAutoRestoredRef.current) return;
    hasAutoRestoredRef.current = true;
    if (getLocationTrackingEnabled()) {
      void startTracking();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot restore; startTracking is stable enough for this path
  }, [autoRestoreTracking]);

  useEffect(() => {
    const unsubResume = subscribeNativeAppResume(() => {
      void checkPermissions();
    });
    const unsubLost = subscribeLocationPermissionLost(() => {
      setError(
        "Background location permission was revoked. Open Settings to allow Always, or turn tracking on again."
      );
      void stopTracking();
    });
    return () => {
      unsubResume();
      unsubLost();
    };
  }, []);

  useEffect(() => {
    // Check permissions on mount
    checkPermissions();

    // Re-check permissions when window regains focus (for web - handles browser permission changes)
    const handleFocus = () => {
      checkPermissions();
    };

    // Re-check permissions periodically (every 30 seconds) to catch external permission changes
    const permissionCheckInterval = setInterval(() => {
      if (!isEnabledRef.current) {
        checkPermissions();
      }
    }, 30000);

    window.addEventListener("focus", handleFocus);

    // Cleanup on unmount only (not when isEnabled changes)
    return () => {
      window.removeEventListener("focus", handleFocus);
      clearInterval(permissionCheckInterval);
      if (watchIdRef.current) {
        locationService.clearWatch(watchIdRef.current);
      }
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
      }
    };
  }, []);

  const isLiveSessionActive = async (): Promise<boolean> => {
    if (sessionActiveRef.current) return true;
    if (watchIdRef.current || updateIntervalRef.current) return true;
    if (backgroundWatcherIdRef.current) return true;
    if (usesIosNativeLiveLocation()) {
      const nativeState = await getNativeTrackingState();
      return nativeState?.isRunning ?? false;
    }
    return false;
  };

  const checkPermissions = async () => {
    const granted = await locationService.checkPermissions();
    console.log("Permission check result:", granted);
    setHasPermission(granted);
    if (isEnabledRef.current && !granted) {
      console.warn("Permission lost while tracking was enabled, stopping tracking");
      setError(
        "Location access was revoked in Settings. Live tracking has been turned off."
      );
      await stopTracking();
    }
    return granted;
  };

  const startTracking = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Always re-check permissions first to ensure state is current
      // This handles cases where user granted permission externally (Settings/browser)
      const currentPermissionStatus = await checkPermissions();
      
      // Request permissions if not already granted
      if (!currentPermissionStatus) {
        console.log("Requesting location permissions...");
        await locationService.requestPermissions();
        
        // Verify permission was actually granted by checking again
        // This handles edge cases where request returns success but permission isn't actually granted
        const verified = await checkPermissions();
        
        if (!verified) {
          setError("Location permission was denied. Please enable location access in your device settings or browser.");
          setIsLoading(false);
          return;
        }
        
        console.log("Permission granted and verified");
      }

      // iOS: native Core Location + Supabase REST (no WebView callbacks while locked).
      if (usesIosNativeLiveLocation()) {
        liveLocLog("LocationToggle iOS native path starting");
        const initialLocation = await locationService.getCurrentLocation();
        if (initialLocation) {
          const loc = {
            latitude: initialLocation.latitude,
            longitude: initialLocation.longitude,
          };
          onLocationUpdate?.(loc);
        } else {
          liveLocLog(
            "LocationToggle iOS initial fix failed",
            { hasPermission: currentPermissionStatus },
            "warn"
          );
          setError(
            "Unable to get your current location. Confirm Always location permission in Settings."
          );
          setIsLoading(false);
          return;
        }

        liveLocLog("LocationToggle iOS initial fix ok", {
          lat: initialLocation.latitude,
          lon: initialLocation.longitude,
          accuracy: initialLocation.accuracy,
          nearestVenue: locationService.getVenueNameIfAtVenue(
            initialLocation.latitude,
            initialLocation.longitude
          ),
        });

        await configureNativeLiveTracking(
          locationService.getUserId(),
          skipSupabase,
          () => {
            setError(
              "Always location access is required for live tracking in the background."
            );
            void stopTracking();
          },
          (message) => {
            liveLocLog("native Supabase write error", { message });
          }
        );

        await startNativeLiveTracking((loc) => {
          setError(null);
          onLocationUpdate?.(loc);
        });

        sessionActiveRef.current = true;
        setIsEnabled(true);
        setLocationTrackingEnabled(true);
        liveLocLog("LocationToggle startTracking complete (iOS native)", {
          skipSupabase,
        });
        setIsLoading(false);
        return;
      }

      const syncLiveRowFromSample = async (loc: {
        latitude: number;
        longitude: number;
        accuracy?: number;
      }) => {
        if (skipSupabase) return;
        const venueName = locationService.getVenueNameIfAtVenue(
          loc.latitude,
          loc.longitude
        );
        const now = Date.now();
        if (!venueName) {
          liveLocLogThrottle(
            "toggle-outside-venue",
            45_000,
            "GPS sample not within 100m of any venue — live_locations not updated (need to be near a venue, e.g. Test Location 1)",
            {
              lat: Math.round(loc.latitude * 1e4) / 1e4,
              lon: Math.round(loc.longitude * 1e4) / 1e4,
            }
          );
          if (lastSupabaseVenueRef.current !== null) {
            await locationService.deactivateUserLocation();
            lastSupabaseVenueRef.current = null;
            lastSupabaseWriteAtRef.current = 0;
          }
          return;
        }
        const venueChanged = venueName !== lastSupabaseVenueRef.current;
        const heartbeatDue =
          now - lastSupabaseWriteAtRef.current >=
          VENUE_LIVE_SUPABASE_HEARTBEAT_MS;
        if (venueChanged || heartbeatDue) {
          liveLocLog("live_locations upsert from poll", {
            venueName,
            venueChanged,
            heartbeatDue,
          });
          await locationService.updateLiveLocation({
            latitude: loc.latitude,
            longitude: loc.longitude,
            accuracy: loc.accuracy ?? 0,
          });
          lastSupabaseVenueRef.current = venueName;
          lastSupabaseWriteAtRef.current = now;
        }
      };

      lastSupabaseVenueRef.current = null;
      lastSupabaseWriteAtRef.current = 0;

      // Get initial location for local display (green dot)
      console.log("Getting initial location...");
      const initialLocation = await locationService.getCurrentLocation();
      if (initialLocation) {
        console.log("Initial location obtained:", initialLocation.latitude, initialLocation.longitude);
        // Update local state only (green dot); Supabase uses venue-change + heartbeat rules in syncLiveRowFromSample.
        const loc = { latitude: initialLocation.latitude, longitude: initialLocation.longitude };
        onLocationUpdate?.(loc);
        await syncLiveRowFromSample(initialLocation);
      } else {
        console.warn(
          "[BarFest location] Failed to get initial location after retries — search console for",
          '"[BarFest location]"',
          "for code (1=denied, 2=unavailable, 3=timeout) and hints."
        );
        setError(
          "Unable to get your current location. Check browser console for [BarFest location] logs (error code 3 = timeout — try again or allow cached position). Also confirm site location permission and HTTPS."
        );
        setIsLoading(false);
        return;
      }

      // Start watching position - real-time local updates only (for green dot)
      // Low accuracy + longer timeout reduces failures on desktop (Wi‑Fi only).
      const watchId = await locationService.watchPosition(
        async (location, watchErr) => {
          if (watchErr) {
            if (isFatalLocationWatchError(watchErr)) {
              setError(watchErr.message);
              setLocationTrackingEnabled(false);
              await stopTracking();
              return;
            }
            if (watchErr.kind !== "timeout") {
              setError(watchErr.message);
            }
            return;
          }
          if (!location) return;
          setError(null);
          const loc = { latitude: location.latitude, longitude: location.longitude };
          onLocationUpdate?.(loc);
        },
        { enableHighAccuracy: false, timeout: 20000, maximumAge: 15000 }
      );

      watchIdRef.current = watchId;
      venuePresenceRef.current = "unknown";

      // If user prefers background ("Always") location, start background watcher (native only)
      if (backgroundPreferred && isNativePlatform) {
        const bgId = await locationService.startBackgroundWatcher(skipSupabase);
        backgroundWatcherIdRef.current = bgId;
      }

      // Poll GPS for venue enter/leave; Supabase upsert only on venue change or heartbeat while at same bar.
      updateIntervalRef.current = setInterval(async () => {
        try {
          const location = await locationService.getCurrentLocation();
          if (location) {
            await syncLiveRowFromSample(location);
          }
        } catch (err) {
          // Suppress timeout errors (code 3) - they're expected when device is idle
          if (err && typeof err === 'object' && 'code' in err && err.code === 3) {
            return; // Timeout is expected, ignore silently
          }
          console.error("Error in backend location update:", err);
        }
      }, VENUE_LOCATION_POLL_INTERVAL_MS);

      sessionActiveRef.current = true;
      setIsEnabled(true);
      setLocationTrackingEnabled(true);
      console.log("Location tracking started successfully");
      liveLocLog("LocationToggle startTracking complete", {
        watchId: watchIdRef.current,
        skipSupabase,
      });
    } catch (err) {
      console.error("Error starting location tracking:", err);
      liveLocLog("LocationToggle startTracking failed", {
        message: err instanceof Error ? err.message : String(err),
      });
      const errorMessage = err instanceof Error 
        ? `Failed to start location tracking: ${err.message}`
        : "Failed to start location tracking. Please try again.";
      sessionActiveRef.current = false;
      setError(errorMessage);
      setIsEnabled(false);
      setLocationTrackingEnabled(false);
      await checkPermissions();
    } finally {
      setIsLoading(false);
    }
  };

  const stopTracking = async () => {
    try {
      if (usesIosNativeLiveLocation()) {
        await stopNativeLiveTracking();
      } else {
        if (watchIdRef.current) {
          await locationService.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }

        if (updateIntervalRef.current) {
          clearInterval(updateIntervalRef.current);
          updateIntervalRef.current = null;
        }

        if (backgroundWatcherIdRef.current) {
          await locationService.stopBackgroundWatcher(backgroundWatcherIdRef.current);
          backgroundWatcherIdRef.current = null;
        }

        if (!skipSupabase) {
          try {
            await locationService.deactivateUserLocation();
          } catch (err) {
            console.error("Error deactivating location:", err);
          }
        }
      }

      venuePresenceRef.current = "outside";
      lastSupabaseVenueRef.current = null;
      lastSupabaseWriteAtRef.current = 0;

      // Clear current location
      onLocationUpdate?.(null);
      setLocationTrackingEnabled(false);
    } catch (err) {
      console.error("Error stopping location tracking:", err);
    } finally {
      sessionActiveRef.current = false;
      setIsEnabled(false);
    }
  };

  const handleToggle = async () => {
    if (isEnabled) {
      stopTracking();
    } else {
      await checkPermissions();
      startTracking();
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      requestEnable: async () => {
        if (isLoadingRef.current) return;
        if (await isLiveSessionActive()) {
          liveLocLog("requestEnable skipped", { reason: "session already active" });
          return;
        }
        await checkPermissions();
        liveLocLog("LocationToggle requestEnable → startTracking");
        await startTracking();
      },
      restorePersistedTrackingIfNeeded: async () => {
        if (!getLocationTrackingEnabled()) {
          liveLocLog("restorePersistedTracking skipped", {
            reason: "localStorage location_tracking_enabled is not true",
          });
          return;
        }
        if (isLoadingRef.current) {
          liveLocLog("restorePersistedTracking skipped", { reason: "already loading" });
          return;
        }
        if (await isLiveSessionActive()) {
          const nativeState = usesIosNativeLiveLocation()
            ? await getNativeTrackingState()
            : null;
          const nativeRunningWithoutJsSession =
            usesIosNativeLiveLocation() &&
            nativeState?.isRunning === true &&
            !sessionActiveRef.current;
          const nativeRunningWithoutSuccessfulWrite =
            nativeState?.isRunning === true && nativeState.lastWriteAtMs === 0;
          if (nativeRunningWithoutJsSession || nativeRunningWithoutSuccessfulWrite) {
            liveLocLog("restorePersistedTracking: re-syncing native (Swift-only or no writes yet)", {
              nativeEngine: nativeState,
            });
          } else {
            liveLocLog("restorePersistedTracking skipped", {
              reason: "live session already running",
              nativeEngine: nativeState,
            });
            return;
          }
        }
        if (isEnabledRef.current && !sessionActiveRef.current) {
          setIsEnabled(false);
          liveLocLog("restorePersistedTracking: UI was enabled without active session, resuming", {});
        }
        liveLocLog("restorePersistedTracking → startTracking", {
          isEnabledUi: isEnabledRef.current,
        });
        await checkPermissions();
        await startTracking();
      },
    }),
    [isEnabled, isLoading]
  );

  if (variant === "compact") {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={handleToggle}
          disabled={isLoading}
          title={isEnabled ? "Live location on" : "Turn on location"}
          className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-white/80 shadow-md transition hover:opacity-90 ${
            isEnabled
              ? "bg-green-500 text-white"
              : "bg-gray-400 text-gray-100"
          }`}
        >
          {isLoading ? (
            <span className="flex items-center gap-0.5" aria-label="Loading location">
              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60 [animation:dotPulse_1.4s_ease-in-out_infinite]" style={{ animationDelay: "0ms" }} />
              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60 [animation:dotPulse_1.4s_ease-in-out_infinite]" style={{ animationDelay: "200ms" }} />
              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60 [animation:dotPulse_1.4s_ease-in-out_infinite]" style={{ animationDelay: "400ms" }} />
            </span>
          ) : isEnabled ? (
            <MapPin className="h-5 w-5" />
          ) : (
            <MapPinOff className="h-5 w-5" />
          )}
        </button>
        {error && variant === "compact" && (
          <p className="max-w-[140px] text-right text-[10px] text-red-600">{error}</p>
        )}
        <style>{`
          @keyframes dotPulse {
            0%, 60%, 100% { opacity: 0.4; transform: scale(0.9); }
            30% { opacity: 1; transform: scale(1.1); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        onClick={handleToggle}
        disabled={isLoading}
        className={`flex items-center gap-2 ${
          isEnabled
            ? "bg-green-500 hover:bg-green-600 text-white"
            : "bg-gray-200 hover:bg-gray-300 text-gray-700"
        }`}
      >
        {isEnabled ? (
          <>
            <MapPin className="h-4 w-4" />
            Live Tracking ON
          </>
        ) : (
          <>
            <MapPinOff className="h-4 w-4" />
            Live Tracking OFF
          </>
        )}
      </Button>
      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}
      {!hasPermission && !error && !isLoading && (
        <p className="text-xs text-gray-500">
          Click to enable location tracking. You'll be prompted to allow location access.
        </p>
      )}
      {isLoading && (
        <p className="text-xs text-gray-500">
          Requesting location permission...
        </p>
      )}
    </div>
  );
});

export default LocationToggle;
