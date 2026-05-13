/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAPKIT_TOKEN?: string;
  readonly VITE_SUPABASE_URL?: string;
  /** Public client key (sb_publishable_…). Preferred; see Supabase dashboard → Connect → React + Vite. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Legacy JWT anon key (eyJ…). Used if VITE_SUPABASE_PUBLISHABLE_KEY is unset. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** When "true", logs `[BarFest liveLoc]` for map pin + live venue pipeline (also on in `npm run dev`). */
  readonly VITE_DEBUG_LIVE_LOCATION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
