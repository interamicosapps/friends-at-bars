# Catalog content (Supabase) + Vercel Admin CMS

Hybrid content pipeline for Bar Fest: **the native iOS app reads catalog JSON from Supabase**. Editors change venues, deals, events, and game packs via an admin UI (intended to deploy on Vercel). App UI still ships via TestFlight / App Store.

## Setup

### 1. Supabase SQL (run in order)

1. [`supabase/catalog_setup.sql`](../supabase/catalog_setup.sql) — tables, RLS, version bump triggers  
2. [`supabase/catalog_seed.sql`](../supabase/catalog_seed.sql) — seed **venues + all web weekly deals/events (~47)** + Switch Search words  

Regenerate seed anytime (pulls from `scripts/weeklyListings.seed.mjs`, kept in sync with `src/data/dealsAndEvents.ts`):

```bash
node scripts/generate-catalog-seed.mjs
```

Then re-run `catalog_seed.sql` in the Supabase SQL editor (or use Admin CMS → Deals / Events → **Import web listings**).

**Switch Search words** live in `catalog_game_content` (`switch-search` / `default`) as bucketed JSON (`fourLetter` / `fiveLetter` / `sixLetter` / `sevenLetter`). Sync from the web library and upsert SQL:

```bash
node scripts/sync-switch-search-words.cjs
```

Then run [`supabase/switch_search_word_pack.sql`](../supabase/switch_search_word_pack.sql) in the Supabase SQL editor (or paste/edit the same payload in Admin CMS → Games). Native Switch Search loads this CMS pack on catalog refresh, with bundled `wordLibrary.json` as offline fallback.

**Native Deals tab** only shows rows in `catalog_listings`. If you only see ~5 deals, the DB still has the old sample seed — re-import the full set.
### 2. Admin auth

Create a Supabase Auth user for editors (Dashboard → Authentication).  
CMS signs in with email/password; RLS allows `authenticated` to write catalog tables.  
Anon clients (mobile apps) can only **SELECT** active rows.

Optional: tighten further with an `admin` claim / allowlist table later.

### 3. Admin CMS app

```bash
cd admin-cms
cp .env.example .env.local   # set VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY
npm install
npm run dev
```

Deploy `admin-cms/` to a separate Vercel project (e.g. `barfest-cms`). Protect with Supabase Auth (built-in login). Do **not** expose the service role key in the browser.

### 4. Consumer apps

- React Cap app: [`src/lib/catalogService.ts`](../src/lib/catalogService.ts)  
- Swift app: `native/ios/BarFest` CatalogService  

Fetch on launch + pull-to-refresh; venues are cached in localStorage / disk.

## Release policy

| Change | Channel |
|--------|---------|
| Bar name, pin, deal text, word pack | CMS → Supabase (no store) |
| New tab, map UX, keyboard, native bugs | App Store / TestFlight |
| Live check-ins / chat / ranked | Existing Supabase live tables (unchanged) |

## Tables

| Table | Purpose |
|-------|---------|
| `catalog_venues` | Names, areas, lat/lng, radius, test flag |
| `catalog_listings` | Deals / events / food specials |
| `catalog_game_content` | JSON packs (`switch-search` / `default`) |
| `catalog_app_config` | `content_version` for clients |
