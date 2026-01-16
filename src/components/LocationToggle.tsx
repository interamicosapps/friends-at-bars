import { useState, useEffect, useRef } from "react";
import { MapPin, MapPinOff } from "lucide-react";
import { locationService } from "@/lib/locationService";
import { Button } from "@/components/ui/Button";

interface LocationToggleProps {
  onLocationUpdate?: (location: { latitude: number; longitude: number } | null) => void;
  skipSupabase?: boolean; // If true, skip Supabase updates (for local-only testing)
}

export default function LocationToggle({ onLocationUpdate, skipSupabase = false }: LocationToggleProps) {
  const [isEnabled, setIsEnabled] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<string | null>(null);
  const updateIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isEnabledRef = useRef(isEnabled);

  // Keep ref in sync with state
  useEffect(() => {
    isEnabledRef.current = isEnabled;
  }, [isEnabled]);

  useEffect(() => {
    // Check permissions on mount
    checkPermissions();
    
    // Re-check permissions when window regains focus (for web - handles browser permission changes)
    const handleFocus = () => {
      console.log("Window focused, re-checking permissions...");
      checkPermissions();
    };
    
    // Re-check permissions periodically (every 30 seconds) to catch external permission changes
    const permissionCheckInterval = setInterval(() => {
      if (!isEnabledRef.current) {
        // Only check if tracking is not enabled to avoid interrupting active tracking
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
  }, []); // Empty dependency array - only run on mount/unmount

  const checkPermissions = async () => {
    const granted = await locationService.checkPermissions();
    console.log("Permission check result:", granted);
    setHasPermission(granted);
    // If we had tracking enabled but lost permission, disable tracking
    if (isEnabled && !granted) {
      console.warn("Permission lost while tracking was enabled, stopping tracking");
      stopTracking();
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

      // Get initial location for local display (green dot)
      console.log("Getting initial location...");
      const initialLocation = await locationService.getCurrentLocation();
      if (initialLocation) {
        console.log("Initial location obtained:", initialLocation.latitude, initialLocation.longitude);
        // Update local state only (green dot) - backend update happens on 60-second interval
        const loc = { latitude: initialLocation.latitude, longitude: initialLocation.longitude };
        onLocationUpdate?.(loc);
      } else {
        console.warn("Failed to get initial location");
        setError("Unable to get your current location. Please check your device settings.");
        setIsLoading(false);
        return;
      }

      // Start watching position - real-time local updates only (for green dot)
      const watchId = await locationService.watchPosition(
        async (location) => {
          // Real-time local update (green dot moves immediately)
          const loc = { latitude: location.latitude, longitude: location.longitude };
          onLocationUpdate?.(loc);
          // NO backend update here - backend updates happen separately every 60 seconds
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );

      watchIdRef.current = watchId;

      // Backend update interval - check venue proximity every 60 seconds
      updateIntervalRef.current = setInterval(async () => {
        try {
          const location = await locationService.getCurrentLocation();
          if (location) {
            // Check if at venue before updating backend
            const isAtVenue = locationService.checkIfAtVenue(location.latitude, location.longitude);
            
            if (isAtVenue && !skipSupabase) {
              // Only update backend if at a venue
              await locationService.updateLiveLocation(location);
            }
            // If not at venue, do nothing (no backend update)
          }
        } catch (err) {
          // Suppress timeout errors (code 3) - they're expected when device is idle
          if (err && typeof err === 'object' && 'code' in err && err.code === 3) {
            return; // Timeout is expected, ignore silently
          }
          console.error("Error in backend location update:", err);
        }
      }, 60000);

      setIsEnabled(true);
      console.log("Location tracking started successfully");
    } catch (err) {
      console.error("Error starting location tracking:", err);
      const errorMessage = err instanceof Error 
        ? `Failed to start location tracking: ${err.message}`
        : "Failed to start location tracking. Please try again.";
      setError(errorMessage);
      // Re-check permissions in case they changed
      await checkPermissions();
    } finally {
      setIsLoading(false);
    }
  };

  const stopTracking = async () => {
    try {
      if (watchIdRef.current) {
        await locationService.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }

      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
        updateIntervalRef.current = null;
      }

      // Deactivate user's location in database (only if Supabase updates are enabled)
      if (!skipSupabase) {
        try {
          await locationService.deactivateUserLocation();
        } catch (err) {
          console.error("Error deactivating location:", err);
        }
      }

      // Clear current location
      onLocationUpdate?.(null);
    } catch (err) {
      console.error("Error stopping location tracking:", err);
    } finally {
      setIsEnabled(false);
    }
  };

  const handleToggle = async () => {
    if (isEnabled) {
      stopTracking();
    } else {
      // Re-check permissions before starting to ensure state is current
      // This is especially important if user granted permission externally
      await checkPermissions();
      startTracking();
    }
  };

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
}
