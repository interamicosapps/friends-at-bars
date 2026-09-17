import type { VenueCounts } from "@/types/checkin";
import {
  liveLocationService,
  logSupabaseNetworkOnce,
  supabase,
} from "@/lib/supabaseClient";
import { liveLocLog } from "@/lib/liveLocationDebug";
import { isVenueVisible } from "@/data/venues";

/** Drop counts for venues hidden in this build (e.g. Test Locations in production). */
function filterVisibleCounts(counts: VenueCounts): VenueCounts {
  const filtered: VenueCounts = {};
  for (const [venueName, count] of Object.entries(counts)) {
    if (isVenueVisible(venueName)) filtered[venueName] = count;
  }
  return filtered;
}

/** CMS-managed mock headcounts (`mock_venue_attendance`) for Test Mode. */
async function fetchMockVenueCounts(): Promise<VenueCounts> {
  const { data, error } = await supabase
    .from("mock_venue_attendance")
    .select("venue_name, attendance");
  if (error) throw error;
  const counts: VenueCounts = {};
  for (const row of data ?? []) {
    const name = row.venue_name as string;
    const n = Number(row.attendance);
    if (name && Number.isFinite(n) && n > 0) counts[name] = Math.floor(n);
  }
  return counts;
}

export async function fetchLiveVenueCountsForDisplay(
  useTestData: boolean
): Promise<VenueCounts> {
  if (useTestData) {
    try {
      const counts = await fetchMockVenueCounts();
      liveLocLog("fetchLiveVenueCountsForDisplay → CMS mock ok", { counts });
      return filterVisibleCounts(counts);
    } catch (err) {
      logSupabaseNetworkOnce(err);
      liveLocLog("fetchLiveVenueCountsForDisplay → CMS mock error", {
        message: err instanceof Error ? err.message : String(err),
      });
      return {};
    }
  }
  try {
    const counts = await liveLocationService.fetchVenueCounts();
    liveLocLog("fetchLiveVenueCountsForDisplay → Supabase ok", { counts });
    return filterVisibleCounts(counts);
  } catch (err) {
    logSupabaseNetworkOnce(err);
    liveLocLog("fetchLiveVenueCountsForDisplay → Supabase error", {
      message: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
}
