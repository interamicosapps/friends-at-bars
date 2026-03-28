import { CheckIn, SupabaseCheckIn } from "@/types/checkin";
import { OHIO_STATE_VENUES } from "@/data/venues";
import {
  extractTimeFromTimestamp,
  DEFAULT_START_TIME,
  normalizeDateTime,
  calculateTimeDifference,
  calculateEndDateTime,
} from "@/lib/timeUtils";
import { checkInService } from "@/lib/supabaseClient";
import { testDataService } from "@/lib/testDataService";

/**
 * Loads check-ins from Supabase or from local test JSON (`testDataService`),
 * normalized to the `CheckIn` shape used by Activities and Map.
 */
export async function fetchCheckInsForDisplay(
  useTestData: boolean
): Promise<CheckIn[]> {
  const service = useTestData ? testDataService : checkInService;
  const supabaseData = await service.fetchCheckIns();
  return convertSupabaseRowsToCheckIns(supabaseData);
}

export function convertSupabaseRowsToCheckIns(
  supabaseData: SupabaseCheckIn[]
): CheckIn[] {
  const convertedCheckIns: CheckIn[] = supabaseData.map(
    (supabaseCheckIn: SupabaseCheckIn) => {
      const startFallbackTime =
        extractTimeFromTimestamp(
          supabaseCheckIn.start_time ?? supabaseCheckIn.created_at
        ) || DEFAULT_START_TIME;
      const normalizedStart = normalizeDateTime({
        raw: supabaseCheckIn.start_time,
        date: supabaseCheckIn.date,
        fallbackTime: startFallbackTime,
      });
      const normalizedEnd = normalizeDateTime({
        raw: supabaseCheckIn.end_time,
        date: normalizedStart.date,
        fallbackTime: normalizedStart.time,
      });
      let startDateTime = normalizedStart.iso;
      let startTime = normalizedStart.time;
      let eventDate = normalizedStart.date;
      let endDateTime = normalizedEnd.iso;
      let endTime = normalizedEnd.time;
      let durationMinutes = Math.round(
        (new Date(endDateTime).getTime() - new Date(startDateTime).getTime()) /
          60000
      );
      if (
        !supabaseCheckIn.end_time ||
        !Number.isFinite(durationMinutes) ||
        durationMinutes <= 0
      ) {
        const fallbackDuration = calculateTimeDifference(startTime, endTime);
        const duration = fallbackDuration > 0 ? fallbackDuration : 60;
        const computed = calculateEndDateTime(eventDate, startTime, duration);
        endTime = computed.endTime;
        endDateTime = computed.endDateTime;
        durationMinutes = duration;
      }
      const venue = OHIO_STATE_VENUES.find(
        (v) => v.name === supabaseCheckIn.venue
      );
      return {
        id: supabaseCheckIn.id,
        venue: supabaseCheckIn.venue,
        venueArea: venue?.area,
        date: eventDate,
        startTime,
        durationMinutes,
        endTime,
        startDateTime,
        endDateTime,
        timestamp: new Date(supabaseCheckIn.created_at),
      };
    }
  );
  return convertedCheckIns.sort(
    (a, b) =>
      new Date(a.startDateTime).getTime() - new Date(b.startDateTime).getTime()
  );
}
