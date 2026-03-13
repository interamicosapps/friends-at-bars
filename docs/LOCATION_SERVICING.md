# How location servicing works

This doc summarizes [`src/lib/locationService.ts`](../src/lib/locationService.ts) and [`LocationToggle`](../src/components/LocationToggle.tsx).

## Platforms

- **Web:** Browser `navigator.geolocation` (getCurrentPosition / watchPosition). Requires HTTPS (or localhost).
- **Native (iOS/Android):** Capacitor `@capacitor/geolocation` for foreground; optional **BackgroundGeolocation** plugin for “Always” / when app is in background.

## Permission and local updates

1. **Request/check:** `requestPermissions()` / `checkPermissions()` — web uses a one-shot `getCurrentPosition` to trigger the prompt; native uses Capacitor’s API.
2. **Watch:** `watchPosition(callback)` — fires whenever the device position changes; used to move the **green dot** on the map (`onLocationUpdate`).
3. **Persisted on state:** `localStorage` key `location_tracking_enabled` — if true, `LocationToggle` **restores tracking on mount** (user had it on last time).

## Backend (Supabase `live_locations`) — only at venues

- **`updateLiveLocation`** upserts a row **only** when the user is within **100 m** of a venue in [`OHIO_STATE_VENUES`](../src/data/venues.ts) (`findNearestVenue`).
- If not near any bar, **no DB write** — live counts won’t change.
- **Interval:** `LocationToggle` calls `updateLiveLocation` every **60 s** when `checkIfAtVenue` is true (not on every GPS tick).
- **Stop:** `deactivateUserLocation` sets `is_active: false` when tracking is turned off.
- **Realtime:** Map subscribes via `subscribeToVenueCounts` (Supabase channel on `live_locations`) so marker counts update.

## Background (native only)

- If user enables **“Track when app is in background”**, `startBackgroundWatcher` uses the BackgroundGeolocation plugin with a distance filter; throttled backend updates when still near a venue.

## UX entry point (Activities)

- **First open:** After the list overlay swipes in, user is **prompted once** to enable location (`activities_location_prompted` in sessionStorage). **Enable** calls `LocationToggle.requestEnable()`; **Not now** dismisses; afterward the **location icon** toggles tracking on/off.
- **Returning users:** Toggle only — no repeated prompt unless sessionStorage is cleared.
