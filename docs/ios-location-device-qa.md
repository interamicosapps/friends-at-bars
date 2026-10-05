# iOS location QA (website location code)

The installed app no longer loads this website. Native location behavior is documented in `native/ios/BarFest/LOCATION.md`. The notes below describe the website's location code.

## Permission matrix

| Step | Action | Expected |
|------|--------|----------|
| 1 | First launch → Activities or Map | Permission prompt in context; no tracking until user enables live location. |
| 2 | Deny location | Tracking off; no `live_locations` row updates. |
| 3 | Grant **Always** (required for native path) | Tracking starts; at-venue upserts reach Supabase. |
| 4 | Grant only **While Using** | `startTracking` fails with message to enable Always in Settings. |
| 5 | Settings → Bar Fest → Location → **Never** | `authorizationLost` event; tracking stops. |
| 6 | Lock screen 5+ min at a venue | `last_updated` advances on venue entry and ~every 5 min heartbeat at same bar. |
| 7 | Leave venue geofence | Row deactivated (`is_active=false`) within ~10s poll window. |
| 8 | Bar A → Bar B | Immediate upsert with new `venue_name` (no 5 min wait). |

## Timing (must match product)

| Constant | Value |
|----------|--------|
| GPS process interval | 10s (`VENUE_LOCATION_POLL_INTERVAL_MS`) |
| Supabase heartbeat at same venue | 5 min (`VENUE_LIVE_SUPABASE_HEARTBEAT_MS`) |
| Count freshness (2 missed heartbeats) | 10 min (`LIVE_LOCATION_MAX_AGE_MS`) |

## Supabase

- Apply RLS migration under `supabase/migrations/`.
- Enable **Realtime** on `live_locations` if using map live counts.
- Confirm Vercel `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` match the project.

## Regression (web)

- Web/Android still use JS poll + `@capacitor-community/background-geolocation` on Android.
- Desktop web: watch timeouts should not leave tracking stuck on without a dot.
