import { useState, useEffect, useRef } from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import MapView from "@/components/MapView";
import MapFloatingLogo from "@/components/MapFloatingLogo";
import LocationToggle, { type LocationToggleRef } from "@/components/LocationToggle";
import ActiveCheckInsPanel from "@/components/ActiveCheckInsPanel";
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
import { locationService, getLocationTrackingEnabled } from "@/lib/locationService";
import { cn } from "@/lib/utils";

const MAP_LOCATION_PROMPT_DISMISSED = "map_location_prompt_dismissed";

function loadCheckInsFromSupabase(): Promise<CheckIn[]> {
  return checkInService.fetchCheckIns().then((supabaseData) => {
    return supabaseData
      .map((supabaseCheckIn: SupabaseCheckIn) => {
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
          const fallbackDuration = calculateTimeDifference(startTime, endTime);
          const duration = fallbackDuration > 0 ? fallbackDuration : 60;
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
      })
      .sort(
        (a, b) =>
          new Date(a.startDateTime).getTime() -
          new Date(b.startDateTime).getTime()
      );
  });
}

export default function MapPage() {
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    format(new Date(), "yyyy-MM-dd")
  );
  const dynamicStartTime = getDynamicStartTime();
  const [selectedTime, setSelectedTime] = useState<string>(dynamicStartTime);
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [overlayExpanded, setOverlayExpanded] = useState(false);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const locationToggleRef = useRef<LocationToggleRef>(null);

  const allNightlifeOptions = generateNightlifeTimeOptions();
  const nightlifeTimeOptions = allNightlifeOptions.filter((time) => {
    const [hours, minutes] = time.split(":").map(Number);
    const [startHours, startMinutes] = dynamicStartTime.split(":").map(Number);
    const timeMinutes = hours * 60 + minutes;
    const startMinutesTotal = startHours * 60 + startMinutes;
    if (hours >= 24) return true;
    return timeMinutes >= startMinutesTotal;
  });

  useEffect(() => {
    loadCheckInsFromSupabase().then(setCheckIns);
  }, []);

  // Map-only location prompt: show when on map and location not enabled and not dismissed this session
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const enabled = getLocationTrackingEnabled();
      if (enabled) {
        if (!cancelled) setShowLocationModal(false);
        return;
      }
      const granted = await locationService.checkPermissions();
      if (granted || cancelled) {
        if (!cancelled) setShowLocationModal(false);
        return;
      }
      const dismissed =
        typeof sessionStorage !== "undefined" &&
        sessionStorage.getItem(MAP_LOCATION_PROMPT_DISMISSED) === "1";
      if (!cancelled && !dismissed) setShowLocationModal(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleEnableLocation = async () => {
    try {
      await locationToggleRef.current?.requestEnable();
      setShowLocationModal(false);
    } catch {
      // Keep modal open on error
    }
  };

  const handleNotNow = () => {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(MAP_LOCATION_PROMPT_DISMISSED, "1");
    }
    setShowLocationModal(false);
  };

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

  const safeTop = "var(--safe-area-inset-top)";
  // Collapsed logo + date pill share one row; align with the location icon.
  const pillTop = `calc(${safeTop} + 8px)`;

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden">
      {/* Top chrome: logo + pill (collapsed) or expanded panel fills space between logo and location toggle */}
      <div
        className={cn(
          "pointer-events-none absolute left-3 right-3 z-[55] flex gap-2",
          overlayExpanded ? "items-start" : "items-center"
        )}
        style={{ top: pillTop }}
      >
        <div className="pointer-events-auto flex shrink-0 items-center gap-2">
          <MapFloatingLogo />
          {!overlayExpanded && (
            <button
              type="button"
              onClick={() => setOverlayExpanded(true)}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-black px-3 text-sm font-semibold text-white shadow-md transition hover:bg-neutral-900"
            >
              <CalendarIcon className="h-4 w-4 shrink-0 text-gray-200" />
              {compactDateTime}
            </button>
          )}
        </div>
        {overlayExpanded ? (
          <div className="pointer-events-auto flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-white/20 bg-black px-2 py-2 shadow-lg sm:px-3 sm:py-3">
            <ActiveCheckInsPanel
              checkIns={checkIns}
              selectedDate={selectedDate}
              selectedTime={selectedTime}
              onSelectDate={handleDateChange}
              onSelectTime={setSelectedTime}
              timeOptions={nightlifeTimeOptions}
              onClose={() => setOverlayExpanded(false)}
              showCloseButton
              dynamicStartTime={dynamicStartTime}
              hideCheckInsList
            />
          </div>
        ) : (
          <div className="min-w-0 flex-1" aria-hidden />
        )}
        <div className="pointer-events-auto shrink-0">
          <LocationToggle
            ref={locationToggleRef}
            variant="compact"
            onLocationUpdate={setUserLocation}
            onEnabledChange={(enabled) => {
              if (enabled) setShowLocationModal(false);
            }}
          />
        </div>
      </div>

      <MapView
        checkIns={checkIns}
        selectedDate={selectedDate}
        selectedTime={selectedTime}
        onSelectDate={handleDateChange}
        onSelectTime={setSelectedTime}
        timeOptions={nightlifeTimeOptions}
        userLocation={userLocation}
        showListPanel={false}
        dynamicStartTime={dynamicStartTime}
        fillContainer
      />

      {/* Map-only location prompt modal */}
      {showLocationModal && (
        <div
          className="fixed inset-x-0 top-0 z-50 flex items-center justify-center bg-black/40 p-4"
          style={{
            bottom: "calc(3.5rem + var(--safe-area-inset-bottom))",
          }}
        >
          <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-5 shadow-xl">
            <p className="mb-4 text-center text-sm text-gray-700">
              In order to use the map, enable location.
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={handleEnableLocation}
                className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
              >
                Enable
              </button>
              <button
                type="button"
                onClick={handleNotNow}
                className="w-full rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
