import { useState, useEffect } from "react";
import { format } from "date-fns";
import { useSearchParams } from "react-router-dom";
import { Menu } from "lucide-react";
import ActiveCheckInsPanel from "@/components/ActiveCheckInsPanel";
import CheckInOverlayContent from "@/components/CheckInOverlayContent";
import { CheckIn } from "@/types/checkin";
import {
  generateNightlifeTimeOptions,
  getDynamicStartTime,
} from "@/lib/timeUtils";
import { fetchCheckInsForDisplay } from "@/lib/fetchCheckInsForDisplay";
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
    setSelectedTime(dynamicStartTime);
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
            onSelectTime={setSelectedTime}
            timeOptions={nightlifeTimeOptions}
            dynamicStartTime={dynamicStartTime}
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
