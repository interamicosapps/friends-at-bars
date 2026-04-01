import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import MapView from "@/components/MapView";
import MapFloatingLogo from "@/components/MapFloatingLogo";
import ActiveCheckInsPanel from "@/components/ActiveCheckInsPanel";
import { useLocationTrackingOutlet } from "@/contexts/LocationTrackingContext";
import { CheckIn } from "@/types/checkin";
import {
  buildNightlifeTimeOptionsForSlider,
  getDynamicStartTime,
} from "@/lib/timeUtils";
import { fetchCheckInsForDisplay } from "@/lib/fetchCheckInsForDisplay";
import { useTestMode } from "@/contexts/TestModeContext";
import {
  locationService,
  getLocationTrackingEnabled,
} from "@/lib/locationService";
import { cn } from "@/lib/utils";
import MapLocationPermissionPrompt from "@/components/MapLocationPermissionPrompt";

export default function MapPage() {
  const navigate = useNavigate();
  const { locationToggleRef, mapUserLocation } = useLocationTrackingOutlet();
  const { useMockCheckIns } = useTestMode();
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    format(new Date(), "yyyy-MM-dd")
  );
  const timeSliderAnchorRef = useRef<string | undefined>(undefined);
  if (timeSliderAnchorRef.current === undefined) {
    timeSliderAnchorRef.current = getDynamicStartTime();
  }
  const [selectedTime, setSelectedTime] = useState(
    () => timeSliderAnchorRef.current!
  );
  const [followWallClock, setFollowWallClock] = useState(true);
  const [timeOptionsEpoch, setTimeOptionsEpoch] = useState(0);
  const [overlayExpanded, setOverlayExpanded] = useState(false);
  /** null = permission not checked yet (do not show map). */
  const [mapAllowed, setMapAllowed] = useState<boolean | null>(null);
  const [locationPromptBusy, setLocationPromptBusy] = useState(false);

  const nightlifeTimeOptions = useMemo(
    () =>
      buildNightlifeTimeOptionsForSlider(timeSliderAnchorRef.current!),
    [selectedDate, timeOptionsEpoch]
  );

  useEffect(() => {
    if (!followWallClock) return;
    const todayStr = format(new Date(), "yyyy-MM-dd");
    if (selectedDate !== todayStr) return;

    const syncToClock = () => {
      const t = format(new Date(), "yyyy-MM-dd");
      if (t !== selectedDate) return;
      const now = getDynamicStartTime();
      if (now === timeSliderAnchorRef.current) return;
      timeSliderAnchorRef.current = now;
      setSelectedTime(now);
      setTimeOptionsEpoch((e) => e + 1);
    };

    syncToClock();
    const id = window.setInterval(syncToClock, 10_000);
    return () => window.clearInterval(id);
  }, [followWallClock, selectedDate]);

  useEffect(() => {
    fetchCheckInsForDisplay(useMockCheckIns).then(setCheckIns);
  }, [useMockCheckIns]);

  // Map is only usable with OS/browser location permission; prompt blocks the route otherwise.
  useEffect(() => {
    let cancelled = false;

    const evaluate = async () => {
      const granted = await locationService.checkPermissions();
      if (cancelled) return;
      setMapAllowed(granted);
    };

    void evaluate();
    const onFocus = () => {
      void evaluate();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // When allowed, start tracking (shared hidden toggle in Layout).
  useEffect(() => {
    if (mapAllowed !== true) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await locationToggleRef.current?.requestEnable();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ref stable
  }, [mapAllowed]);

  const handleAllowLocation = async () => {
    setLocationPromptBusy(true);
    try {
      await locationToggleRef.current?.requestEnable();
      const granted = await locationService.checkPermissions();
      const trackingOn = getLocationTrackingEnabled();
      if (granted && trackingOn) {
        setMapAllowed(true);
      }
    } catch {
      // Keep prompt open
    } finally {
      setLocationPromptBusy(false);
    }
  };

  const handleBackFromMapPrompt = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/", { replace: true });
    }
  };

  const handleDateChange = (date: string) => {
    setSelectedDate(date);
    const now = getDynamicStartTime();
    timeSliderAnchorRef.current = now;
    setSelectedTime(now);
    const todayStr = format(new Date(), "yyyy-MM-dd");
    setFollowWallClock(date === todayStr);
    setTimeOptionsEpoch((e) => e + 1);
  };

  const handleSelectTime = (time: string) => {
    const todayStr = format(new Date(), "yyyy-MM-dd");
    const nowStr = getDynamicStartTime();
    setFollowWallClock(
      selectedDate === todayStr && time === nowStr
    );
    setSelectedTime(time);
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
  const pillTop = `calc(${safeTop} + 8px)`;

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden">
      {/* Top chrome: logo + date pill; expanded panel fills the row. Location is handled by the map permission flow. */}
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
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-white/50 px-3 text-sm font-semibold text-gray-700 shadow-md backdrop-blur transition hover:bg-white/60"
            >
              <CalendarIcon className="h-4 w-4 shrink-0 text-gray-500" />
              {compactDateTime}
            </button>
          )}
        </div>
        {overlayExpanded ? (
          <div className="pointer-events-auto flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-white/60 bg-white/90 px-2 py-2 shadow-lg backdrop-blur sm:px-3 sm:py-3">
            <ActiveCheckInsPanel
              checkIns={checkIns}
              selectedDate={selectedDate}
              selectedTime={selectedTime}
              onSelectDate={handleDateChange}
              onSelectTime={handleSelectTime}
              timeOptions={nightlifeTimeOptions}
              onClose={() => setOverlayExpanded(false)}
              showCloseButton
              dynamicStartTime={getDynamicStartTime()}
              hideCheckInsList
            />
          </div>
        ) : (
          <div className="min-w-0 flex-1" aria-hidden />
        )}
      </div>

      {mapAllowed === true && (
        <MapView
          checkIns={checkIns}
          selectedDate={selectedDate}
          selectedTime={selectedTime}
          onSelectDate={handleDateChange}
          onSelectTime={handleSelectTime}
          timeOptions={nightlifeTimeOptions}
          userLocation={mapUserLocation}
          showListPanel={false}
          dynamicStartTime={getDynamicStartTime()}
          fillContainer
        />
      )}

      <MapLocationPermissionPrompt
        open={mapAllowed === false}
        variant="map"
        onAllow={handleAllowLocation}
        onSecondary={handleBackFromMapPrompt}
        secondaryLabel="Back"
        busy={locationPromptBusy}
        coverNav
      />
    </div>
  );
}
