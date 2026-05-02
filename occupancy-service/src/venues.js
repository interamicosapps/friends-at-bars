/**
 * Mirror src/data/venues.ts — keep OHIO_STATE_VENUES pins in sync for server-side assignment.
 */
export const OCCUPANCY_VENUES = [
  { name: "Out-R-Inn", coordinates: [40.0051, -83.00845] },
  { name: "Horseshoe", coordinates: [40.0064, -83.0095] },
  { name: "Little Bar", coordinates: [40.0068, -83.0097] },
  { name: "Library", coordinates: [40.0066, -83.0095] },
  { name: "Three's", coordinates: [40.0072, -83.0097] },
  { name: "Five's", coordinates: [40.0106, -83.0105] },
  { name: "Ethyl & Tank", coordinates: [39.9975, -83.0069] },
  { name: "Midway", coordinates: [39.9975, -83.00735] },
  { name: "Big Bar / Sky Bar", coordinates: [39.9972, -83.0073] },
  { name: "Ugly Tuna 2", coordinates: [39.9953, -83.0018] },
  { name: "Euporia", coordinates: [39.99416, -83.0062] },
  { name: "Leo's", coordinates: [39.9956, -83.00654] },
  { name: "Standard", coordinates: [39.9848, -83.0048] },
  { name: "Brother's", coordinates: [39.9717, -83.0051] },
  { name: "TownHall", coordinates: [39.9788, -83.0035] },
  { name: "Good Night John Boy", coordinates: [39.98103, -83.00403] },
  { name: "Pint House", coordinates: [39.9782, -83.00347] },
  { name: "Draft Kings", coordinates: [39.9794, -83.00375] },
  { name: "The Go Go", coordinates: [39.98314, -82.9994] },
  { name: "Axis", coordinates: [39.97805, -83.00443] },
  { name: "Galla Park", coordinates: [39.98065, -83.00397] },
  { name: "Test Location 1", coordinates: [39.98385, -83.006739] },
];

export const MAX_ASSIGN_DISTANCE_M = 220;
const EARTH_RADIUS_M = 6371e3;

function haversineM(lat1, lon1, lat2, lon2) {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

export function nearestVenueForOccupancy(lat, lon) {
  let best = null;
  for (const v of OCCUPANCY_VENUES) {
    const d = haversineM(lat, lon, v.coordinates[0], v.coordinates[1]);
    if (
      !best ||
      d < best.d ||
      (d === best.d && v.name.localeCompare(best.name) < 0)
    ) {
      best = { name: v.name, d };
    }
  }
  if (!best || best.d > MAX_ASSIGN_DISTANCE_M) return null;
  return best.name;
}
