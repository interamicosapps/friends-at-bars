import { useState, useEffect, useMemo, useRef } from "react";
import { format } from "date-fns";
import { useSearchParams } from "react-router-dom";
import { Menu } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import ActiveCheckInsPanel from "@/components/ActiveCheckInsPanel";
import CheckInOverlayContent from "@/components/CheckInOverlayContent";
import { CheckIn } from "@/types/checkin";
import {
  buildNightlifeTimeOptionsForSlider,
  getDynamicStartTime,
  selectedDateTimeMatchesLocalNow,
} from "@/lib/timeUtils";
import { fetchCheckInsForDisplay } from "@/lib/fetchCheckInsForDisplay";
import { fetchLiveVenueCountsForDisplay } from "@/lib/fetchLiveVenueCounts";
import type { VenueCounts } from "@/types/checkin";
import { useTestMode } from "@/contexts/TestModeContext";
import { useLocationTrackingOutlet } from "@/contexts/LocationTrackingContext";
import {
  locationService,
  getLocationTrackingEnabled,
  isNativePlatform,
  openNativeAppLocationSettings,
} from "@/lib/locationService";

const CHECKIN_OVERLAY_KEY = "activities_checkin_overlay_collapsed";

function getCheckInOverlayCollapsed(): boolean {
  if (typeof sessionStorage === "undefined") return true;
  const v = sessionStorage.getItem(CHECKIN_OVERLAY_KEY);
  if (v === null) return true; // default: overlay closed on first visit
  return v === "1";
}

function setCheckInOverlayCollapsed(collapsed: boolean) {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(CHECKIN_OVERLAY_KEY, collapsed ? "1" : "0");
}

export default function Activities() {
  const { locationToggleRef } = useLocationTrackingOutlet();
  const { useMockCheckIns } = useTestMode();
  const [searchParams, setSearchParams] = useSearchParams();
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
  /** When true and date is today, selected time tracks the wall clock until the user moves the slider. */
  const [followWallClock, setFollowWallClock] = useState(true);
  const [timeOptionsEpoch, setTimeOptionsEpoch] = useState(0);
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

  const nightlifeTimeOptions = useMemo(
    () =>
      buildNightlifeTimeOptionsForSlider(timeSliderAnchorRef.current!),
    [selectedDate, timeOptionsEpoch]
  );

  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNowTick((t) => t + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);

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

  const isLiveNow = useMemo(
    () => selectedDateTimeMatchesLocalNow(selectedDate, selectedTime),
    [selectedDate, selectedTime, nowTick]
  );

  const [liveVenueCounts, setLiveVenueCounts] = useState<VenueCounts | null>(
    null
  );

  /** OS permission + in-app live toggle — required to show live bar attendance. */
  const [attendanceUnlocked, setAttendanceUnlocked] = useState(false);
  const [locationCtaBusy, setLocationCtaBusy] = useState(false);
  const [locationCtaMessage, setLocationCtaMessage] = useState<string | null>(
    null
  );

  const nativeSettingsShortcut =
    isNativePlatform &&
    (Capacitor.getPlatform() === "ios" ||
      Capacitor.getPlatform() === "android");

  const handleLocationCtaClick = async () => {
    setLocationCtaMessage(null);
    setLocationCtaBusy(true);
    try {
      if (nativeSettingsShortcut) {
        const result = await openNativeAppLocationSettings();
        if (!result.ok) {
          setLocationCtaMessage(result.displayText);
        }
        return;
      }
      await locationToggleRef.current?.requestEnable();
      const granted = await locationService.checkPermissions();
      const trackingOn = getLocationTrackingEnabled();
      if (!granted || !trackingOn) {
        setLocationCtaMessage(
          "If the browser did not ask for location: use the site icon in the address bar, set Location to Allow, then try again."
        );
      }
    } catch {
      if (!nativeSettingsShortcut) {
        setLocationCtaMessage("Something went wrong. Please try again.");
      }
    } finally {
      setLocationCtaBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const permission = await locationService.checkPermissions();
      if (cancelled) return;
      setAttendanceUnlocked(permission && getLocationTrackingEnabled());
    };
    void refresh();
    const onFocus = () => void refresh();
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    const poll = window.setInterval(refresh, 2000);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(poll);
    };
  }, []);

  useEffect(() => {
    if (!isLiveNow || !attendanceUnlocked) {
      setLiveVenueCounts(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const v = await fetchLiveVenueCountsForDisplay(useMockCheckIns);
        if (!cancelled) setLiveVenueCounts(v);
      } catch {
        if (!cancelled) setLiveVenueCounts({});
      }
    };
    load();
    const id = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isLiveNow, attendanceUnlocked, useMockCheckIns]);

  const loadCheckIns = async () => {
    try {
      const convertedCheckIns = await fetchCheckInsForDisplay(useMockCheckIns);
      setCheckIns(convertedCheckIns);
    } catch (error) {
      console.error("Error loading check-ins:", error);
    }
  };

  useEffect(() => {
    loadCheckIns();
  }, [useMockCheckIns]);

  // Open Check-In overlay when navigating with ?open=checkin
  useEffect(() => {
    if (searchParams.get("open") === "checkin") {
      setCheckInOverlayOpenState(true);
      setCheckInOverlayCollapsed(false);
    }
  }, [searchParams]);

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

  return (
    <div
      className="relative flex h-full w-full flex-col bg-background"
      style={{ height: "calc(100vh - var(--navbar-height, 4rem) - 3.5rem)" }}
    >
      {/* Main content: list view (date header + ActiveCheckInsPanel) */}
      <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
          {!attendanceUnlocked && (
            <div className="mb-1.5">
              <button
                type="button"
                disabled={locationCtaBusy}
                onClick={() => void handleLocationCtaClick()}
                className="activities-location-strip flex h-[22px] w-full shrink-0 items-center justify-center rounded border border-amber-800/40 bg-amber-900 px-1.5 text-amber-50 shadow-sm transition enabled:hover:bg-amber-800 enabled:active:scale-[0.99] disabled:opacity-60"
              >
                <span className="min-h-0 min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-center text-[10px] font-semibold leading-none tracking-tight [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                  {locationCtaBusy
                    ? "Opening…"
                    : "Click Here to Enable Location and see how busy each bar is right now!"}
                </span>
              </button>
              {locationCtaMessage ? (
                <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border border-amber-900/20 bg-amber-950/10 p-1.5 font-mono text-[10px] leading-snug text-amber-950/90">
                  {locationCtaMessage}
                </pre>
              ) : null}
            </div>
          )}
          <ActiveCheckInsPanel
            checkIns={checkIns}
            selectedDate={selectedDate}
            selectedTime={selectedTime}
            onSelectDate={handleDateChange}
            onSelectTime={handleSelectTime}
            timeOptions={nightlifeTimeOptions}
            dynamicStartTime={getDynamicStartTime()}
            showLiveViewerCounts={attendanceUnlocked && isLiveNow}
            liveVenueCounts={liveVenueCounts}
            hideAttendanceBadges={!attendanceUnlocked}
            endSlot={
              checkInOverlayOpen ? undefined : (
                <button
                  type="button"
                  onClick={() => setCheckInOverlayOpen(true)}
                  className="flex items-center gap-2 rounded-full bg-white/90 px-3 py-2 text-sm font-semibold text-gray-700 shadow-md backdrop-blur transition hover:bg-white"
                >
                  <Menu className="h-4 w-4 text-gray-500" />
                  Check-In
                </button>
              )
            }
          />
        </div>
      </div>

      {/* Collapsible Check-In overlay */}
      {checkInOverlayOpen && (
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
      )}
    </div>
  );
}
