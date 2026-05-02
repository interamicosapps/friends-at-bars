/**
 * Unified circular geofence around all OHIO_STATE_VENUES (outer “bar zone”).
 * Used for maps (test overlay), occupancy wake logic, optional native monitoring.
 *
 * Radius = maximum haversine distance from centroid to any venue + BAR_ZONE_PADDING_METERS.
 */
import { OHIO_STATE_VENUES } from "@/data/venues";
import { haversineDistanceMeters } from "@/lib/venueResolution";

export const BAR_ZONE_PADDING_METERS = 350;

/** Centroid of all venue coordinates in WGS84. */
export const BAR_ZONE_CENTER = (() => {
  let latSum = 0;
  let lonSum = 0;
  const n = OHIO_STATE_VENUES.length || 1;
  for (const v of OHIO_STATE_VENUES) {
    latSum += v.coordinates[0];
    lonSum += v.coordinates[1];
  }
  return {
    latitude: latSum / n,
    longitude: lonSum / n,
  };
})();

/** Circle radius enclosing every venue coordinate from BAR_ZONE_CENTER, plus padding. */
export const BAR_ZONE_RADIUS_METERS = (() => {
  let maxR = 0;
  const { latitude: lat0, longitude: lon0 } = BAR_ZONE_CENTER;
  for (const v of OHIO_STATE_VENUES) {
    const d = haversineDistanceMeters(
      lat0,
      lon0,
      v.coordinates[0],
      v.coordinates[1]
    );
    maxR = Math.max(maxR, d);
  }
  return Math.ceil(maxR + BAR_ZONE_PADDING_METERS);
})();

export function isInsideBarZone(
  latitude: number,
  longitude: number
): boolean {
  const d = haversineDistanceMeters(
    latitude,
    longitude,
    BAR_ZONE_CENTER.latitude,
    BAR_ZONE_CENTER.longitude
  );
  return d <= BAR_ZONE_RADIUS_METERS;
}
