# MapKit JS setup

**Web** (browser / Vercel) and **Capacitor iOS** (WKWebView loading the same web app, e.g. via `server.url`) use **MapKit JS** in the page (`MapViewMapKit`). **Android** uses MapLibre only (`MapViewMapLibre`).

Safari or Chrome on iPhone (not the installed app) loads the web bundle and uses MapKit JS like desktop.

## Token

1. Apple Developer → Certificates, Identifiers & Profiles → **Maps** → create a **MapKit JS** token.
2. **Domain allowlist** must match where the app runs (production hostname, or test token for localhost).
3. The app reads **`VITE_MAPKIT_TOKEN`** at **build time** (`mapkitLoader`).

## Where to set the token

| Environment | Where to put `VITE_MAPKIT_TOKEN` |
|-------------|----------------------------------|
| **Local (`npm run dev`)** | **`.env.local`** in the repo root (gitignored). Restart dev server after changes. |
| **Vercel** | Project → **Settings → Environment Variables**. Set for Production (and Preview if needed). Redeploy after changing. |
| **Codemagic** | App → **Environment variables** → add `VITE_MAPKIT_TOKEN` (mark **sensitive**) so builds that bundle the web app include MapKit JS for web preview or iOS WebView loads. |

## Without a token

The map area shows an error state until `VITE_MAPKIT_TOKEN` is set and the token is valid for the current origin.

## Security

- Do **not** commit real tokens to git. `.env.local` is listed in `.gitignore`.
- If a token is ever committed or leaked, revoke it in Apple Developer and create a new one.
- To remove the **"Authorization token without origin restriction"** warning in production: in Apple Developer → Maps → your MapKit JS token → set **allowed origins** to your app’s domain(s).

## Console messages (dev)

- **"Authorization token without origin restriction"** — Set allowed origins on the token (see Security) to silence in production; safe to ignore for localhost.
- **`POST .../reportAnalytics net::ERR_BLOCKED_BY_CLIENT`** — MapKit’s analytics request blocked by an ad blocker or privacy extension. Harmless; map still works.
