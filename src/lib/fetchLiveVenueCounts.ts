import type { VenueCounts } from "@/types/checkin";
import { liveLocationService, logSupabaseNetworkOnce } from "@/lib/supabaseClient";
import { testDataService } from "@/lib/testDataService";

export async function fetchLiveVenueCountsForDisplay(
  useTestData: boolean
): Promise<VenueCounts> {
  if (useTestData) {
    return testDataService.fetchLiveVenueCounts();
  }
  try {
    return await liveLocationService.fetchVenueCounts();
  } catch (err) {
    logSupabaseNetworkOnce(err);
    return {};
  }
}
