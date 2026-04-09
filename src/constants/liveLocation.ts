/**
 * Rows with last_updated older than this are excluded from live venue counts,
 * even if is_active is still true (defense in depth).
 */
export const LIVE_LOCATION_MAX_AGE_MS = 30 * 60 * 1000;

/**
 * cleanupStaleLocations deactivates rows whose last_updated is older than this.
 * Matches count window so ghosts are cleared server-side as well.
 */
export const LIVE_LOCATION_STALE_MS = LIVE_LOCATION_MAX_AGE_MS;
