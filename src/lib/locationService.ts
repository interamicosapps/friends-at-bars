import { Capacitor } from "@capacitor/core";
import { supabase } from "./supabaseClient";
import { OHIO_STATE_VENUES } from "@/data/venues";
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
        resolve(false);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        () => resolve(true),
        () => resolve(false),
        { timeout: 1000 }
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
        return result.state === "granted";
      } catch {
        // Permissions API not fully supported, try via getCurrentPosition
        return webGeolocation.requestPermissions();
      }
    }
    // Fallback: try to get position (will prompt if needed)
    return webGeolocation.requestPermissions();
  },

  async getCurrentPosition(options?: {
    enableHighAccuracy?: boolean;
    timeout?: number;
  }): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position: GeolocationPosition) => resolve(position),
        (error: GeolocationPositionError) => reject(error),
        {
          enableHighAccuracy: options?.enableHighAccuracy ?? true,
          timeout: options?.timeout ?? 10000,
        }
      );
    });
  },

  async watchPosition(
    options: { enableHighAccuracy?: boolean; timeout?: number },
    callback: (
      position: GeolocationPosition | null,
      error?: GeolocationPositionError
    ) => void
  ): Promise<number> {
    const watchId = navigator.geolocation.watchPosition(
      (position: GeolocationPosition) => callback(position),
      (error: GeolocationPositionError) => callback(null, error),
      {
        enableHighAccuracy: options.enableHighAccuracy ?? true,
        timeout: options.timeout ?? 10000,
      }
    );
    return watchId;
  },

  async clearWatch(watchId: number | string): Promise<void> {
    navigator.geolocation.clearWatch(Number(watchId));
  },
};

// Platform detection and geolocation adapter
const isNative = Capacitor.isNativePlatform();

// Lazy load Capacitor Geolocation for native platforms only
let CapacitorGeolocation:
  | typeof import("@capacitor/geolocation").Geolocation
  | null = null;

async function getGeolocation() {
  if (isNative && !CapacitorGeolocation) {
    try {
      const module = await import("@capacitor/geolocation");
      CapacitorGeolocation = module.Geolocation;
    } catch (error) {
      console.error("Failed to load Capacitor Geolocation:", error);
      // Fallback to web implementation if Capacitor fails
      return webGeolocation;
    }
  }
  return isNative && CapacitorGeolocation
    ? CapacitorGeolocation
    : webGeolocation;
}

export const locationService = {
  // Request location permissions
  async requestPermissions(): Promise<boolean> {
    try {
      if (isNative) {
        await getGeolocation();
        if (CapacitorGeolocation) {
          const status = await CapacitorGeolocation.requestPermissions();
          return status.location === "granted";
        }
      }
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
        await getGeolocation();
        if (CapacitorGeolocation) {
          const status = await CapacitorGeolocation.checkPermissions();
          return status.location === "granted";
        }
      }
      return await webGeolocation.checkPermissions();
    } catch (error) {
      return false;
    }
  },

  // Get current location (one-time)
  async getCurrentLocation(): Promise<LocationData | null> {
    try {
      if (isNative) {
        await getGeolocation();
      }
      let position: GeolocationPosition;

      if (isNative && CapacitorGeolocation) {
        const capPosition = await CapacitorGeolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 10000,
        });
        position = {
          coords: {
            latitude: capPosition.coords.latitude,
            longitude: capPosition.coords.longitude,
            accuracy: capPosition.coords.accuracy ?? null,
          },
        };
      } else {
        position = await webGeolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 10000,
        });
      }

      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy || 0,
      };
    } catch (error) {
      console.error("Error getting location:", error);
      return null;
    }
  },

  // Start watching location (for continuous updates)
  async watchPosition(
    callback: (location: LocationData) => void,
    options?: { enableHighAccuracy?: boolean; timeout?: number }
  ): Promise<string> {
    if (isNative) {
      await getGeolocation();
    }

    if (isNative && CapacitorGeolocation) {
      // Native implementation using Capacitor
      const watchId = await CapacitorGeolocation.watchPosition(
        {
          enableHighAccuracy: options?.enableHighAccuracy ?? true,
          timeout: options?.timeout ?? 10000,
        },
        (
          position: GeolocationPosition | null,
          err?: GeolocationPositionError
        ) => {
          if (err) {
            console.error("Location watch error:", err);
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
      // Web implementation using browser API
      const watchId = await webGeolocation.watchPosition(
        {
          enableHighAccuracy: options?.enableHighAccuracy ?? true,
          timeout: options?.timeout ?? 10000,
        },
        (
          position: GeolocationPosition | null,
          err?: GeolocationPositionError
        ) => {
          if (err) {
            console.error("Location watch error:", err);
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
      await getGeolocation();
    }

    if (isNative && CapacitorGeolocation) {
      await CapacitorGeolocation.clearWatch({ id: watchId });
    } else {
      await webGeolocation.clearWatch(watchId);
    }
  },

  // Update user's live location in database
  async updateLiveLocation(location: LocationData): Promise<void> {
    const userId = getUserId();
    const venueMatch = findNearestVenue(location.latitude, location.longitude);

    if (venueMatch) {
      // User is at a venue - upsert location
      const locationData: LiveLocationInsert = {
        user_id: userId,
        venue_name: venueMatch.venue.name,
        latitude: location.latitude,
        longitude: location.longitude,
        is_active: true,
      };

      const { error } = await supabase
        .from("live_locations")
        .upsert(locationData, {
          onConflict: "user_id",
        });

      if (error) {
        console.error("Error updating live location:", error);
      }
    } else {
      // User is not at any venue - mark as inactive
      const { error } = await supabase
        .from("live_locations")
        .update({
          is_active: false,
          last_updated: new Date().toISOString(),
        })
        .eq("user_id", userId);

      if (error && error.code !== "PGRST116") {
        // PGRST116 means no rows matched, which is fine
        console.error("Error deactivating live location:", error);
      }
    }
  },

  // Get live user counts per venue
  async getVenueCounts(): Promise<VenueCounts> {
    const { data, error } = await supabase
      .from("live_locations")
      .select("venue_name")
      .eq("is_active", true);

    if (error) {
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

  // Subscribe to real-time venue count updates
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
          // Refetch counts when changes occur
          const counts = await locationService.getVenueCounts();
          callback(counts);
        }
      )
      .subscribe();

    // Also fetch initial counts
    locationService.getVenueCounts().then(callback);

    return {
      unsubscribe: () => {
        channel.unsubscribe();
      },
    };
  },

  // Cleanup: Remove stale locations (older than 30 minutes)
  async cleanupStaleLocations(): Promise<void> {
    const thirtyMinutesAgo = new Date(
      Date.now() - 30 * 60 * 1000
    ).toISOString();

    const { error } = await supabase
      .from("live_locations")
      .update({ is_active: false })
      .lt("last_updated", thirtyMinutesAgo)
      .eq("is_active", true);

    if (error) {
      console.error("Error cleaning up stale locations:", error);
    }
  },

  // Get anonymous user ID
  getUserId,
};
