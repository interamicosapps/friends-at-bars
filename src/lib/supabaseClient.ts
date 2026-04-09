import { createClient } from "@supabase/supabase-js";
import { LIVE_LOCATION_MAX_AGE_MS } from "@/constants/liveLocation";
import {
  SupabaseCheckIn,
  SupabaseCheckInInsert,
  LiveLocation,
  LiveLocationInsert,
  VenueCounts,
} from "@/types/checkin";

// You'll need to replace these with your actual Supabase project URL and anon key
// Get these from your Supabase project settings
const supabaseUrl =
  (import.meta as any).env?.VITE_SUPABASE_URL ||
  "https://your-project.supabase.co";
const supabaseAnonKey =
  (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || "your-anon-key";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

let supabaseNetworkErrorLogged = false;

function isNetworkError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const msg = String((err as { message?: string }).message ?? "");
  const details = String((err as { details?: string }).details ?? "");
  return (
    /Failed to fetch|network|ERR_NAME_NOT_RESOLVED|load failed/i.test(msg) ||
    /Failed to fetch|network|ERR_NAME_NOT_RESOLVED|load failed/i.test(details)
  );
}

export function logSupabaseNetworkOnce(err: unknown): void {
  if (supabaseNetworkErrorLogged) return;
  supabaseNetworkErrorLogged = true;
  console.warn(
    "[BarFest backend] Supabase unreachable (network/DNS). Check VITE_SUPABASE_URL and network. Details:",
    err
  );
}

export function isSupabaseNetworkError(err: unknown): boolean {
  return isNetworkError(err);
}

export function wasSupabaseNetworkError(): boolean {
  return supabaseNetworkErrorLogged;
}

// Database functions
export const checkInService = {
  // Insert a new check-in
  async insertCheckIn(data: SupabaseCheckInInsert) {
    const { data: result, error } = await supabase
      .from("checkins")
      .insert(data)
      .select()
      .single();

    if (error) throw error;
    return result;
  },

  // Fetch all check-ins
  async fetchCheckIns() {
    try {
      const { data, error } = await supabase
        .from("checkins")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as SupabaseCheckIn[];
    } catch (err) {
      if (isNetworkError(err)) {
        logSupabaseNetworkOnce(err);
        return [];
      }
      throw err;
    }
  },

  // Subscribe to real-time updates
  subscribeToCheckIns(callback: (payload: any) => void) {
    return supabase
      .channel("checkins")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "checkins" },
        callback
      )
      .subscribe();
  },

  // Update the start/end time for a single check-in
  async updateCheckInTimes(
    id: string,
    updates: { start_time?: string; end_time?: string; date?: string | null }
  ) {
    const { data, error } = await supabase
      .from("checkins")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return data as SupabaseCheckIn;
  },

  // Update multiple check-ins in parallel
  async updateMultipleCheckIns(
    updates: {
      id: string;
      start_time?: string;
      end_time?: string;
      date?: string | null;
    }[]
  ) {
    return Promise.all(
      updates.map(({ id, start_time, end_time, date }) =>
        checkInService.updateCheckInTimes(id, { start_time, end_time, date })
      )
    );
  },

  // Delete a check-in by ID
  async deleteCheckIn(id: string) {
    const { error } = await supabase.from("checkins").delete().eq("id", id);

    if (error) throw error;
  },
};

// Live location tracking service
export const liveLocationService = {
  // Upsert location record (one location per user)
  async upsertLocation(data: LiveLocationInsert) {
    const { data: result, error } = await supabase
      .from("live_locations")
      .upsert(
        {
          ...data,
          last_updated: new Date().toISOString(),
        },
        {
          onConflict: "user_id",
        }
      )
      .select()
      .single();

    if (error) throw error;
    return result as LiveLocation;
  },

  // Fetch aggregated venue counts
  async fetchVenueCounts(): Promise<VenueCounts> {
    const freshAfter = new Date(
      Date.now() - LIVE_LOCATION_MAX_AGE_MS
    ).toISOString();
    const { data, error } = await supabase
      .from("live_locations")
      .select("venue_name")
      .eq("is_active", true)
      .gte("last_updated", freshAfter);

    if (error) throw error;

    const counts: VenueCounts = {};
    data?.forEach((location) => {
      if (!counts[location.venue_name]) {
        counts[location.venue_name] = 0;
      }
      counts[location.venue_name]++;
    });

    return counts;
  },

  // Subscribe to live location changes
  subscribeToLocations(callback: (payload: any) => void) {
    return supabase
      .channel("live_locations_subscription")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "live_locations",
        },
        callback
      )
      .subscribe();
  },

  // Delete user's location (when stopping tracking)
  async deleteUserLocation(userId: string) {
    const { error } = await supabase
      .from("live_locations")
      .delete()
      .eq("user_id", userId);

    if (error) throw error;
  },

  // Mark user's location as inactive
  async deactivateUserLocation(userId: string) {
    const { error } = await supabase
      .from("live_locations")
      .update({
        is_active: false,
        last_updated: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (error) throw error;
  },
};
