/**
 * While the user stays at the same venue, upsert `live_locations` at most this often
 * (foreground poll + background path). Venue changes bypass this and write immediately.
 */
export const VENUE_LIVE_SUPABASE_HEARTBEAT_MS = 5 * 60 * 1000;

/**
 * Rows with last_updated older than this are excluded from live venue counts.
 * Set to two missed heartbeats so ghosts drop off if the device dies or writes stop.
 */
export const LIVE_LOCATION_MAX_AGE_MS =
  2 * VENUE_LIVE_SUPABASE_HEARTBEAT_MS;

/**
 * Foreground tick: how often we sample GPS for venue enter/leave and heartbeat decisions.
 */
export const VENUE_LOCATION_POLL_INTERVAL_MS = 10 * 1000;

/**
 * cleanupStaleLocations deactivates rows whose last_updated is older than this.
 * Matches count window so ghosts are cleared server-side as well.
 */
export const LIVE_LOCATION_STALE_MS = LIVE_LOCATION_MAX_AGE_MS;
