# BarFest occupancy API (Hybrid MVP)

HTTPS service: `POST /heartbeat`, `POST /leave`, `GET /counts`. Uses Upstash Redis for per-venue counts and JWT (or anon device id) identity.

See `.env.example`. Run locally:

```bash
npm install
cp .env.example .env
# edit `.env` (Upstash Redis URL/token, optional SUPABASE_JWT_SECRET, OCCUPANCY_ALLOW_ANON_DEVICE_ID)
npm run dev
```

Local `.env` is loaded automatically (`import "dotenv/config"` in `src/server.js`), so Redis variables defined there are visible to Node.

From the **repo root**, you can start Vite **and** this service together (avoids proxy `ECONNREFUSED` to `:8787` when only Vite is running):

```bash
npm run dev:with-occupancy
```

Expose the API to the Vite app:

- Same machine browser: `VITE_OCCUPANCY_API_URL=http://127.0.0.1:8787`
- Phone / emulator hitting your PC’s Vite URL: **`VITE_OCCUPANCY_API_URL=/api/occupancy`** (dev proxy to this service on 8787; see repo root `vite.config.ts`)

Production builds need a full `https://…` URL to a deployed occupancy service (`/api/occupancy` is dev-only).

**Auth:** Prefer `Authorization: Bearer <Supabase access token>`. With `OCCUPANCY_ALLOW_ANON_DEVICE_ID=true`, requests may omit JWT if the JSON body includes `deviceUserId` matching `anon_*` so it matches anonymous users from `locationService`.
