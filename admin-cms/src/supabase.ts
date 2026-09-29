import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

if (!url || !key) {
  console.warn(
    "Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local"
  );
}

export const supabase = createClient(
  url || "https://your-project.supabase.co",
  key || "your-key"
);

export type CatalogGeography = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_miles: number;
  is_default: boolean;
  is_active: boolean;
  is_test: boolean;
  sort_order: number;
};

export type CatalogArea = {
  id: string;
  geography_id: string;
  long_name: string;
  short_name: string;
  accent_hex: string;
  sort_order: number;
  is_active: boolean;
};

export type CatalogVenue = {
  id: string;
  name: string;
  area: string;
  geography_id: string | null;
  latitude: number;
  longitude: number;
  radius_m: number;
  /** NW → NE → SE → SW corners as { lat, lng }. */
  footprint: { lat: number; lng: number }[] | null;
  is_test: boolean;
  is_active: boolean;
  sort_order: number;
  /** Shared building key. Same value in one geography combines the Activities card and map pin. */
  location_group: string | null;
};

export type CatalogListing = {
  id: string;
  venue_name: string;
  geography_id: string | null;
  title: string;
  time_label: string;
  details: string;
  area: string;
  listing_kind: "deal" | "event" | "food";
  type_labels: string[];
  days_of_week: number[];
  priority: number;
  is_active: boolean;
};
