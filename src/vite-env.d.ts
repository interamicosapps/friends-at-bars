/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAPKIT_TOKEN?: string;
  /** Base URL of BarFest occupancy HTTPS API (omit trailing slash). Example: https://occupancy.example.com */
  readonly VITE_OCCUPANCY_API_URL?: string;
  /** When `"1"` or `"true"` and occupancy URL is set, show green Redis counts beside red Supabase counts. */
  readonly VITE_OCCUPANCY_COMPARISON?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
