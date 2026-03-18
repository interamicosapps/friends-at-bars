import { useState, useEffect } from "react";
import { format } from "date-fns";
import { useSearchParams } from "react-router-dom";
import { Calendar as CalendarIcon, Menu } from "lucide-react";
import ActiveCheckInsPanel from "@/components/ActiveCheckInsPanel";
import CheckInOverlayContent from "@/components/CheckInOverlayContent";
import { CheckIn, SupabaseCheckIn } from "@/types/checkin";
import {
  extractTimeFromTimestamp,
  DEFAULT_START_TIME,
  normalizeDateTime,
  generateNightlifeTimeOptions,
  getDynamicStartTime,
  calculateTimeDifference,
  calculateEndDateTime,
} from "@/lib/timeUtils";
import { checkInService } from "@/lib/supabaseClient";
import { OHIO_STATE_VENUES } from "@/data/venues";

const CHECKIN_OVERLAY_KEY = "activities_checkin_overlay_collapsed";

function getCheckInOverlayCollapsed(): boolean {
  if (typeof sessionStorage === "undefined") return true;
  return sessionStorage.getItem(CHECKIN_OVERLAY_KEY) === "1";
}

function setCheckInOverlayCollapsed(collapsed: boolean) {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(CHECKIN_OVERLAY_KEY, collapsed ? "1" : "0");
}

export default function Activities() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    format(new Date(), "yyyy-MM-dd")
  );
  const dynamicStartTime = getDynamicStartTime();
  const [selectedTime, setSelectedTime] = useState<string>(dynamicStartTime);
  const [checkInOverlayOpen, setCheckInOverlayOpenState] = useState(() => {
    const fromQuery = searchParams.get("open") === "checkin";
    if (fromQuery) return true;
    return !getCheckInOverlayCollapsed();
  });
  const setCheckInOverlayOpen = (open: boolean) => {
    setCheckInOverlayOpenState(open);
    setCheckInOverlayCollapsed(!open);
    if (!open && searchParams.get("open") === "checkin") {
      setSearchParams({}, { replace: true });
    }
  };

  const allNightlifeOptions = generateNightlifeTimeOptions();
  const nightlifeTimeOptions = allNightlifeOptions.filter((time) => {
    const [hours, minutes] = time.split(":").map(Number);
    const [startHours, startMinutes] = dynamicStartTime.split(":").map(Number);
    const timeMinutes = hours * 60 + minutes;
    const startMinutesTotal = startHours * 60 + startMinutes;
    if (hours >= 24) return true;
    return timeMinutes >= startMinutesTotal;
  });

  const loadCheckIns = async () => {
    try {
      const supabaseData = await checkInService.fetchCheckIns();
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
            (new Date(endDateTime).getTime() -
              new Date(startDateTime).getTime()) /
              60000
          );
          if (
            !supabaseCheckIn.end_time ||
            !Number.isFinite(durationMinutes) ||
            durationMinutes <= 0
          ) {
            const fallbackDuration = calculateTimeDifference(
              startTime,
              endTime
            );
            const duration =
              fallbackDuration > 0 ? fallbackDuration : 60;
            const computed = calculateEndDateTime(
              eventDate,
              startTime,
              duration
            );
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
      setCheckIns(
        convertedCheckIns.sort(
          (a, b) =>
            new Date(a.startDateTime).getTime() -
            new Date(b.startDateTime).getTime()
        )
      );
    } catch (error) {
      console.error("Error loading check-ins from Supabase:", error);
    }
  };

  useEffect(() => {
    loadCheckIns();
  }, []);

  // Open Check-In overlay when navigating with ?open=checkin
  useEffect(() => {
    if (searchParams.get("open") === "checkin") {
      setCheckInOverlayOpenState(true);
      setCheckInOverlayCollapsed(false);
    }
  }, [searchParams]);

  const handleDateChange = (date: string) => {
    setSelectedDate(date);
    setSelectedTime(dynamicStartTime);
  };

  const [hours, minutes] = selectedTime.split(":").map(Number);
  let compactDate = selectedDate;
  let displayHours = hours;
  if (hours >= 24) {
    const date = new Date(selectedDate + "T00:00:00");
    date.setDate(date.getDate() + 1);
    compactDate = format(date, "yyyy-MM-dd");
    displayHours = hours % 24;
  }
  const compactDateTime = format(
    new Date(
      `${compactDate}T${displayHours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:00`
    ),
    "M/d h:mm a"
  );

  return (
    <div
      className="relative flex h-full w-full flex-col bg-background"
      style={{ height: "calc(100vh - var(--navbar-height, 4rem) - 3.5rem)" }}
    >
      {/* Main content: list view (date header + ActiveCheckInsPanel) */}
      <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-gray-200 px-3 py-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
            <CalendarIcon className="h-4 w-4 text-gray-500" />
            {compactDateTime}
          </div>
          <div />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
          <ActiveCheckInsPanel
            checkIns={checkIns}
            selectedDate={selectedDate}
            selectedTime={selectedTime}
            onSelectDate={handleDateChange}
            onSelectTime={setSelectedTime}
            timeOptions={nightlifeTimeOptions}
            dynamicStartTime={dynamicStartTime}
          />
        </div>
      </div>

      {/* Collapsible Check-In overlay */}
      {checkInOverlayOpen ? (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/20"
            style={{
              top: "calc(4rem + var(--safe-area-inset-top))",
              bottom: "calc(3.5rem + var(--safe-area-inset-bottom))",
            }}
            aria-hidden
            onClick={() => setCheckInOverlayOpen(false)}
          />
          <div
            className="fixed left-3 right-3 z-40 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
            style={{
              top: "calc(4rem + var(--safe-area-inset-top) + 12px)",
              bottom: "calc(3.5rem + var(--safe-area-inset-bottom) + 12px)",
            }}
          >
            <CheckInOverlayContent
              checkIns={checkIns}
              onCheckInsUpdated={loadCheckIns}
              onClose={() => setCheckInOverlayOpen(false)}
            />
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setCheckInOverlayOpen(true)}
          className="absolute right-4 top-4 z-20 flex items-center gap-2 rounded-full bg-white/90 px-3 py-2 text-sm font-semibold text-gray-700 shadow-md backdrop-blur transition hover:bg-white"
        >
          <Menu className="h-4 w-4 text-gray-500" />
          Check-In
        </button>
      )}
    </div>
  );
}
