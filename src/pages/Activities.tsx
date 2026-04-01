import { useState, useEffect, useMemo, useRef } from "react";
import { format } from "date-fns";
import { useSearchParams } from "react-router-dom";
import { Menu } from "lucide-react";
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

  useEffect(() => {
    if (!isLiveNow) {
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
  }, [isLiveNow, useMockCheckIns]);

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
          <ActiveCheckInsPanel
            checkIns={checkIns}
            selectedDate={selectedDate}
            selectedTime={selectedTime}
            onSelectDate={handleDateChange}
            onSelectTime={handleSelectTime}
            timeOptions={nightlifeTimeOptions}
            dynamicStartTime={getDynamicStartTime()}
            showLiveViewerCounts={isLiveNow}
            liveVenueCounts={liveVenueCounts}
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
