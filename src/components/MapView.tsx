import { useMemo, useState, useRef, useEffect, lazy, Suspense } from "react";
import { Capacitor } from "@capacitor/core";
import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { CheckIn } from "@/types/checkin";
import {
  generateStartTimeOptions,
  isCheckInActiveAt,
} from "@/lib/timeUtils";
import ActiveCheckInsPanel from "@/components/ActiveCheckInsPanel";

const MapViewMapLibre = lazy(() => import("@/components/MapViewMapLibre"));
const MapViewMapKit = lazy(() => import("@/components/MapViewMapKit"));

export interface MapViewProps {
  checkIns: CheckIn[];
  selectedDate: string;
  selectedTime: string;
  onSelectDate: (date: string) => void;
  onSelectTime: (time: string) => void;
  /** @deprecated Heat map is disabled; ignored for API compatibility. */
  heatMapMode?: boolean;
  timeOptions?: string[];
  userLocation?: { latitude: number; longitude: number } | null;
  showListPanel?: boolean;
  dynamicStartTime?: string;
  className?: string;
  onFirstInteraction?: () => void;
  /** Called once when the map instance has finished loading (tiles/sources ready). */
  onMapReady?: () => void;
  /** Fill parent (e.g. map page): edge-to-edge, no card chrome. */
  fillContainer?: boolean;
}

/**
 * Shell: panels + platform map — MapLibre on Android; MapKit JS everywhere else
 * (browser, Capacitor iOS with bundled or remote web assets per capacitor `server.url`).
 * Heat map mode is deprecated and has no effect.
 */
export default function MapView({
  checkIns,
  selectedDate,
  selectedTime,
  onSelectDate,
  onSelectTime,
  heatMapMode: _heatMapMode = false,
  timeOptions,
  userLocation,
  showListPanel = true,
  dynamicStartTime,
  className,
  onFirstInteraction,
  onMapReady,
  fillContainer = false,
}: MapViewProps) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const previousSelectedDate = useRef<string | null>(null);

  const sliderOptions = useMemo(
    () => timeOptions ?? generateStartTimeOptions(),
    [timeOptions]
  );

  const activeCheckIns = useMemo(
    () =>
      checkIns.filter((checkIn) =>
        isCheckInActiveAt(checkIn, selectedDate, selectedTime)
      ),
    [checkIns, selectedDate, selectedTime]
  );

  useEffect(() => {
    previousSelectedDate.current = selectedDate;
  }, [selectedDate]);

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

  const handlePanelDateChange = (date: string) => {
    onSelectDate(date);
    if (dynamicStartTime) onSelectTime(dynamicStartTime);
  };

  const platform = Capacitor.getPlatform();
  const useMapLibre = platform === "android";

  const mapProps = {
    checkIns,
    selectedDate,
    selectedTime,
    userLocation,
    onFirstInteraction,
    onMapReady,
  };

  return (
    <div
      className={cn(
        "w-full overflow-hidden",
        fillContainer
          ? "absolute inset-0 h-full min-h-0 rounded-none border-0 shadow-none"
          : "relative rounded-xl border border-gray-200 shadow-lg",
        !fillContainer && (className ?? "h-96"),
        fillContainer && className
      )}
    >
      {showListPanel &&
        (isCollapsed ? (
          <button
            type="button"
            onClick={() => setIsCollapsed(false)}
            className="absolute left-4 top-4 z-20 flex items-center gap-2 rounded-full bg-white/90 px-3 py-2 text-sm font-semibold text-gray-700 shadow-md backdrop-blur transition hover:bg-white"
          >
            <CalendarIcon className="h-4 w-4 text-gray-500" />
            {compactDateTime}
          </button>
        ) : (
          <div className="pointer-events-none absolute left-4 right-4 top-4 z-10">
            <div className="pointer-events-auto flex max-h-[360px] max-w-md flex-col gap-3 overflow-hidden rounded-xl border border-white/60 bg-white/90 px-3 py-3 shadow-lg backdrop-blur">
              <ActiveCheckInsPanel
                checkIns={checkIns}
                selectedDate={selectedDate}
                selectedTime={selectedTime}
                onSelectDate={handlePanelDateChange}
                onSelectTime={onSelectTime}
                timeOptions={sliderOptions}
                onClose={() => setIsCollapsed(true)}
                showCloseButton
                dynamicStartTime={dynamicStartTime}
              />
            </div>
          </div>
        ))}

      {showListPanel && activeCheckIns.length === 0 && isCollapsed && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 -translate-y-1/2 text-center">
          <span className="rounded-full bg-white/90 px-4 py-2 text-sm font-medium text-gray-600 shadow">
            No check-ins during this time
          </span>
        </div>
      )}

      <div className="h-full w-full" style={{ minHeight: 240 }}>
        <Suspense
          fallback={
            <div className="flex h-full w-full items-center justify-center bg-gray-100 text-sm text-gray-500">
              Loading map…
            </div>
          }
        >
          {useMapLibre ? (
            <MapViewMapLibre {...mapProps} />
          ) : (
            <MapViewMapKit {...mapProps} />
          )}
        </Suspense>
      </div>
    </div>
  );
}
