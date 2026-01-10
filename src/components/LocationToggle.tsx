import { useState, useEffect, useRef } from "react";
import { MapPin, MapPinOff } from "lucide-react";
import { locationService } from "@/lib/locationService";
import { Button } from "@/components/ui/Button";

export default function LocationToggle() {
  const [isEnabled, setIsEnabled] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<string | null>(null);
  const updateIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Check permissions on mount
    checkPermissions();
    // Cleanup on unmount
    return () => {
      if (watchIdRef.current) {
        locationService.clearWatch(watchIdRef.current);
      }
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
      }
    };
  }, []);

  const checkPermissions = async () => {
    const granted = await locationService.checkPermissions();
    setHasPermission(granted);
    // If we had tracking enabled but lost permission, disable tracking
    if (isEnabled && !granted) {
      stopTracking();
    }
  };

  const startTracking = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Request permissions if not already granted
      if (!hasPermission) {
        const granted = await locationService.requestPermissions();
        if (!granted) {
          setError("Location permission is required for live tracking");
          setIsLoading(false);
          return;
        }
        setHasPermission(true);
      }

      // Get initial location
      const initialLocation = await locationService.getCurrentLocation();
      if (initialLocation) {
        await locationService.updateLiveLocation(initialLocation);
      }

      // Start watching position (updates every 60 seconds)
      const watchId = await locationService.watchPosition(
        async (location) => {
          await locationService.updateLiveLocation(location);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );

      watchIdRef.current = watchId;

      // Also set up a periodic update (every 60 seconds) as backup
      updateIntervalRef.current = setInterval(async () => {
        const location = await locationService.getCurrentLocation();
        if (location) {
          await locationService.updateLiveLocation(location);
        }
      }, 60000);

      setIsEnabled(true);
    } catch (err) {
      console.error("Error starting location tracking:", err);
      setError("Failed to start location tracking");
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

      // Deactivate user's location in database
      // Use coordinates that are guaranteed to be far from any venue
      // This will mark the location as inactive in the database
      try {
        await locationService.updateLiveLocation({
          latitude: 0,
          longitude: 0,
          accuracy: 0,
        }); // Coordinates (0,0) are far from all venues, so location will be marked inactive
      } catch (err) {
        console.error("Error deactivating location:", err);
      }
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
      {!hasPermission && !error && (
        <p className="text-xs text-gray-500">
          Enable to share your location at bars
        </p>
      )}
    </div>
  );
}
