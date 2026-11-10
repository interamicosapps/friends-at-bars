import {
  supabase,
  isSupabaseNetworkError,
  logSupabaseNetworkOnce,
} from "@/lib/supabaseClient";

export type CatalogVenue = {
  id: string;
  name: string;
  area: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  is_test: boolean;
  is_active: boolean;
  sort_order: number;
  updated_at: string;
};

export type CatalogListing = {
  id: string;
  venue_name: string;
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

export type CatalogGameContent = {
  id: string;
  game_key: string;
  pack_key: string;
  payload: unknown;
  is_active: boolean;
};

export type CatalogGame = {
  game_key: string;
  title: string;
  sort_order: number;
  enabled_in_test: boolean;
  enabled_in_production: boolean;
  has_details: boolean;
};

const CACHE_KEY = "barfest_catalog_venues_v1";
const VERSION_KEY = "barfest_catalog_version_v1";

export const catalogService = {
  async fetchContentVersion(): Promise<number | null> {
    try {
      const { data, error } = await supabase
        .from("catalog_app_config")
        .select("value")
        .eq("key", "content_version")
        .maybeSingle();
      if (error) throw error;
      const v = (data?.value as { version?: number } | null)?.version;
      return typeof v === "number" ? v : null;
    } catch (err) {
      if (isSupabaseNetworkError(err)) {
        logSupabaseNetworkOnce(err);
        return null;
      }
      console.warn("fetchContentVersion", err);
      return null;
    }
  },

  async fetchVenues(opts?: {
    includeTest?: boolean;
  }): Promise<CatalogVenue[]> {
    try {
      let q = supabase
        .from("catalog_venues")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (!opts?.includeTest) {
        q = q.eq("is_test", false);
      }
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as CatalogVenue[];
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(rows));
        const ver = await this.fetchContentVersion();
        if (ver != null) localStorage.setItem(VERSION_KEY, String(ver));
      } catch {
        /* ignore */
      }
      return rows;
    } catch (err) {
      if (isSupabaseNetworkError(err)) {
        logSupabaseNetworkOnce(err);
      } else {
        console.warn("fetchVenues", err);
      }
      return this.readCachedVenues();
    }
  },

  readCachedVenues(): CatalogVenue[] {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return [];
      return JSON.parse(raw) as CatalogVenue[];
    } catch {
      return [];
    }
  },

  async fetchListings(): Promise<CatalogListing[]> {
    try {
      const { data, error } = await supabase
        .from("catalog_listings")
        .select("*")
        .eq("is_active", true)
        .order("priority", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CatalogListing[];
    } catch (err) {
      if (isSupabaseNetworkError(err)) {
        logSupabaseNetworkOnce(err);
        return [];
      }
      console.warn("fetchListings", err);
      return [];
    }
  },

  async fetchGameContent(
    gameKey: string,
    packKey = "default"
  ): Promise<CatalogGameContent | null> {
    try {
      const { data, error } = await supabase
        .from("catalog_game_content")
        .select("*")
        .eq("game_key", gameKey)
        .eq("pack_key", packKey)
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw error;
      return data as CatalogGameContent | null;
    } catch (err) {
      if (isSupabaseNetworkError(err)) {
        logSupabaseNetworkOnce(err);
        return null;
      }
      console.warn("fetchGameContent", err);
      return null;
    }
  },

  async fetchGames(): Promise<CatalogGame[]> {
    try {
      const { data, error } = await supabase
        .from("catalog_games")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CatalogGame[];
    } catch (err) {
      if (isSupabaseNetworkError(err)) {
        logSupabaseNetworkOnce(err);
        return [];
      }
      console.warn("fetchGames", err);
      return [];
    }
  },

  /** Map catalog venue → legacy Venue shape used across the React app. */
  toLegacyVenue(v: CatalogVenue): {
    name: string;
    area: string;
    coordinates: [number, number];
  } {
    return {
      name: v.name,
      area: v.area,
      coordinates: [v.latitude, v.longitude],
    };
  },
};
