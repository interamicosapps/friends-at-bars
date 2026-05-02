/**
 * Occupancy venue resolution: nearest OHIO_STATE_VENUES coordinate (haversine)
 * with a maximum assignment distance guard. Mirrors server occupancy-service logic.
 */
import type { Venue } from "@/types/checkin";
import { OHIO_STATE_VENUES } from "@/data/venues";

export const OCCUPANCY_MAX_ASSIGN_DISTANCE_METERS = 220;

const EARTH_RADIUS_M = 6371e3;

export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

export interface VenueDistance {
  venue: Venue;
  distanceMeters: number;
}

/** Nearest venue by great-circle distance; tie-break lexicographically by venue name. */
export function nearestVenueAcrossAll(
  latitude: number,
  longitude: number,
  venues: readonly Venue[] = OHIO_STATE_VENUES
): VenueDistance | null {
  let best: VenueDistance | null = null;
  for (const venue of venues) {
    const d = haversineDistanceMeters(
      latitude,
      longitude,
      venue.coordinates[0],
      venue.coordinates[1]
    );
    if (
      best === null ||
      d < best.distanceMeters ||
      (d === best.distanceMeters && venue.name.localeCompare(best.venue.name) < 0)
    ) {
      best = { venue, distanceMeters: d };
    }
  }
  return best;
}

/**
 * Venue for occupancy/live presence: closest bar pin, or null if farther than maxMeters.
 */
export function nearestVenueForOccupancy(
  latitude: number,
  longitude: number,
  maxMeters: number = OCCUPANCY_MAX_ASSIGN_DISTANCE_METERS
): VenueDistance | null {
  const best = nearestVenueAcrossAll(latitude, longitude);
  if (!best || best.distanceMeters > maxMeters) return null;
  return best;
}
