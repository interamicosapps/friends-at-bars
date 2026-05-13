import type { VenueCounts } from "@/types/checkin";
import { liveLocationService, logSupabaseNetworkOnce } from "@/lib/supabaseClient";
import { testDataService } from "@/lib/testDataService";
import { liveLocLog } from "@/lib/liveLocationDebug";

export async function fetchLiveVenueCountsForDisplay(
  useTestData: boolean
): Promise<VenueCounts> {
  if (useTestData) {
    liveLocLog("fetchLiveVenueCountsForDisplay → mock data", {});
    return testDataService.fetchLiveVenueCounts();
  }
  try {
    const counts = await liveLocationService.fetchVenueCounts();
    liveLocLog("fetchLiveVenueCountsForDisplay → Supabase ok", { counts });
    return counts;
  } catch (err) {
    logSupabaseNetworkOnce(err);
    liveLocLog("fetchLiveVenueCountsForDisplay → Supabase error", {
      message: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
}
