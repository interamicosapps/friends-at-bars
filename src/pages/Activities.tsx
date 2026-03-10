import { useState, useEffect, Suspense, lazy, useRef } from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import LocationToggle, { type LocationToggleRef } from "@/components/LocationToggle";
import ActivitiesListOverlay from "@/components/ActivitiesListOverlay";
import { Button } from "@/components/ui/Button";
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

const MapView = lazy(() => import("@/components/MapView"));

export default function Activities() {
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [mapSelectedDate, setMapSelectedDate] = useState<string>(() =>
    format(new Date(), "yyyy-MM-dd")
  );
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const dynamicStartTime = getDynamicStartTime();
  const [mapSelectedTime, setMapSelectedTime] = useState<string>(
    dynamicStartTime
  );
  const [listOverlayOpen, setListOverlayOpen] = useState(true);
  const [showLocationDialog, setShowLocationDialog] = useState(false);
  const [isLocationEnabled, setIsLocationEnabled] = useState(false);
  const [hasPromptedForLocation, setHasPromptedForLocation] = useState(() => {
    if (typeof sessionStorage === "undefined") return false;
    return sessionStorage.getItem("activities_location_prompted") === "1";
  });
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

  const handleMapDateChange = (date: string) => {
    setMapSelectedDate(date);
    setMapSelectedTime(dynamicStartTime);
  };

  const handleFirstMapInteraction = () => {
    if (isLocationEnabled || hasPromptedForLocation) return;
    setHasPromptedForLocation(true);
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem("activities_location_prompted", "1");
    }
    setShowLocationDialog(true);
  };

  const handleEnableLocation = async () => {
    setShowLocationDialog(false);
    await locationToggleRef.current?.requestEnable();
  };

  const [hours, minutes] = mapSelectedTime.split(":").map(Number);
  let compactDate = mapSelectedDate;
  let displayHours = hours;
  if (hours >= 24) {
    const date = new Date(mapSelectedDate + "T00:00:00");
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
      className="relative w-full bg-background"
      style={{ height: "calc(100vh - var(--navbar-height, 4rem))" }}
    >
      <div className="relative h-full min-h-[400px] w-full">
        <Suspense
          fallback={
            <div className="flex h-full min-h-[400px] items-center justify-center rounded-xl border border-gray-200 bg-gray-50">
              <div className="text-center">
                <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]"></div>
                <p className="text-sm text-gray-600">Loading map...</p>
              </div>
            </div>
          }
        >
          <MapView
            checkIns={checkIns}
            selectedDate={mapSelectedDate}
            selectedTime={mapSelectedTime}
            onSelectDate={handleMapDateChange}
            onSelectTime={setMapSelectedTime}
            heatMapMode={true}
            timeOptions={nightlifeTimeOptions}
            userLocation={userLocation}
            showListPanel={false}
            className="h-full min-h-[400px]"
            onFirstInteraction={handleFirstMapInteraction}
          />
        </Suspense>
        {/* Floating pill to open list overlay */}
        <button
          type="button"
          onClick={() => setListOverlayOpen(true)}
          className="absolute left-4 top-4 z-20 flex items-center gap-2 rounded-full bg-white/90 px-3 py-2 text-sm font-semibold text-gray-700 shadow-md backdrop-blur transition hover:bg-white"
        >
          <CalendarIcon className="h-4 w-4 text-gray-500" />
          {compactDateTime}
        </button>
        {/* Compact location indicator - top right */}
        <div className="absolute right-4 top-4 z-20">
          <LocationToggle
            ref={locationToggleRef}
            variant="compact"
            onLocationUpdate={setUserLocation}
            onEnabledChange={setIsLocationEnabled}
          />
        </div>
      </div>
      {/* First-interaction location prompt */}
      {showLocationDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-5 shadow-xl">
            <p className="mb-4 text-center text-sm font-medium text-gray-800">
              See yourself on the map — turn on location?
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowLocationDialog(false)}
              >
                Not now
              </Button>
              <Button
                className="flex-1"
                onClick={handleEnableLocation}
              >
                Enable
              </Button>
            </div>
          </div>
        </div>
      )}
      <ActivitiesListOverlay
        isOpen={listOverlayOpen}
        onClose={() => setListOverlayOpen(false)}
        checkIns={checkIns}
        selectedDate={mapSelectedDate}
        selectedTime={mapSelectedTime}
        onSelectDate={handleMapDateChange}
        onSelectTime={setMapSelectedTime}
        timeOptions={nightlifeTimeOptions}
        dynamicStartTime={dynamicStartTime}
      />
    </div>
  );
}
