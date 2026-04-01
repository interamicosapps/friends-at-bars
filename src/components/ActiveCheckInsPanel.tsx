import {
  useMemo,
  useState,
  useRef,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon, ChevronDown, ChevronRight } from "lucide-react";
import { Calendar } from "@/components/ui/Calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
import { CheckIn } from "@/types/checkin";
import { CAMPUS_AREAS, OHIO_STATE_VENUES } from "@/data/venues";
import {
  formatDateDisplay,
  formatTimeDisplay,
  generateStartTimeOptions,
  isCheckInActiveAt,
} from "@/lib/timeUtils";
import { cn } from "@/lib/utils";

interface ActiveCheckInsPanelProps {
  checkIns: CheckIn[];
  selectedDate: string;
  selectedTime: string;
  onSelectDate: (date: string) => void;
  onSelectTime: (time: string) => void;
  timeOptions?: string[];
  onClose?: () => void;
  /** If true, show a close button (e.g. for overlay). Default false. */
  showCloseButton?: boolean;
  /** Optional dynamic start time to reset to when date changes */
  dynamicStartTime?: string;
  /** If true, hide the active check-ins list (date + time only). Used on Map page overlay. */
  hideCheckInsList?: boolean;
  /** Renders to the right of the date/time row (e.g. Activities Check-In button). */
  endSlot?: ReactNode;
  /** When true and `liveVenueCounts` is set, show live viewer counts (red styling). */
  showLiveViewerCounts?: boolean;
  /** Per-venue live viewer counts from `live_locations` or test data; null while loading. */
  liveVenueCounts?: Record<string, number> | null;
}

const formatDateValue = (date: Date) => format(date, "yyyy-MM-dd");

export default function ActiveCheckInsPanel({
  checkIns,
  selectedDate,
  selectedTime,
  onSelectDate,
  onSelectTime,
  timeOptions: timeOptionsProp,
  onClose,
  showCloseButton = false,
  dynamicStartTime,
  hideCheckInsList = false,
  endSlot,
  showLiveViewerCounts = false,
  liveVenueCounts = null,
}: ActiveCheckInsPanelProps) {
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [expandedAreas, setExpandedAreas] = useState<Set<string>>(new Set());
  const topSliderRef = useRef<HTMLDivElement>(null);

  const sliderOptions = useMemo(
    () => timeOptionsProp ?? generateStartTimeOptions(),
    [timeOptionsProp]
  );
  const sliderIndex = Math.max(
    0,
    sliderOptions.findIndex((time) => time === selectedTime)
  );

  const activeCheckIns = useMemo(
    () =>
      checkIns.filter((checkIn) =>
        isCheckInActiveAt(checkIn, selectedDate, selectedTime)
      ),
    [checkIns, selectedDate, selectedTime]
  );

  const getVenueActivity = (venueName: string) =>
    activeCheckIns.filter((checkIn) => checkIn.venue === venueName);

  const handleCalendarSelect = (day?: Date) => {
    if (!day) return;
    const value = formatDateValue(day);
    onSelectDate(value);
    if (dynamicStartTime) {
      onSelectTime(dynamicStartTime);
    }
    setIsCalendarOpen(false);
  };

  const handleSliderChange = (event: ChangeEvent<HTMLInputElement>) => {
    const index = Number(event.target.value);
    const time = sliderOptions[index] ?? sliderOptions[0];
    onSelectTime(time);
  };

  const rawSliderPercentage =
    sliderOptions.length > 1
      ? (sliderIndex / (sliderOptions.length - 1)) * 100
      : 0;
  const sliderPercentage = Math.min(100, Math.max(0, rawSliderPercentage));

  const calculateClampedTooltipPosition = (
    percentage: number,
    containerRef: React.RefObject<HTMLDivElement>,
    estimatedTooltipWidth: number = 70,
    minLeftOffset: number = 0
  ): number => {
    if (!containerRef.current) return percentage;
    const containerWidth = containerRef.current.offsetWidth;
    const tooltipHalfWidth = estimatedTooltipWidth / 2;
    const minPercentage =
      ((minLeftOffset + tooltipHalfWidth) / containerWidth) * 100;
    const maxPercentage =
      ((containerWidth - tooltipHalfWidth) / containerWidth) * 100;
    return Math.min(Math.max(percentage, minPercentage), maxPercentage);
  };

  const liveMode = Boolean(
    showLiveViewerCounts && liveVenueCounts !== null
  );

  type AreaData = { venues: Record<string, number>; total: number };
  const areaMap: Record<string, AreaData> = {};
  for (const area of CAMPUS_AREAS) {
    areaMap[area] = { venues: {}, total: 0 };
  }
  OHIO_STATE_VENUES.forEach((venue) => {
    if (!venue.area || !areaMap[venue.area]) return;
    const count = liveMode
      ? (liveVenueCounts![venue.name] ?? 0)
      : getVenueActivity(venue.name).length;
    const areaData = areaMap[venue.area];
    areaData.venues[venue.name] = count;
    areaData.total += count;
  });
  const areaEntries = CAMPUS_AREAS.map((area) => [area, areaMap[area]] as const);

  const toggleArea = (area: string) => {
    setExpandedAreas((prev) => {
      const next = new Set<string>(prev);
      if (next.has(area)) next.delete(area);
      else next.add(area);
      return next;
    });
  };

  const dateTimeRow = (
    <div className="flex min-w-0 items-center gap-2 flex-shrink-0">
      {showCloseButton && onClose && (
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 min-h-[36px] min-w-[36px] flex-col items-center justify-center gap-[2px] rounded-md border border-transparent text-gray-500 transition hover:border-gray-200 hover:bg-gray-100"
          aria-label="Close list"
        >
          <span className="block h-[1.5px] w-4 rounded bg-gray-400" />
          <span className="block h-[1.5px] w-4 rounded bg-gray-400" />
          <span className="block h-[1.5px] w-4 rounded bg-gray-400" />
        </button>
      )}
      <div className="shrink-0">
        <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              onClick={() => setIsCalendarOpen((prev) => !prev)}
              aria-label="Select date"
              className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white/80 px-2.5 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-white"
            >
              <CalendarIcon className="h-3.5 w-3.5 text-gray-500" />
              {formatDateDisplay(selectedDate)}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={
                selectedDate
                  ? new Date(`${selectedDate}T00:00:00`)
                  : undefined
              }
              onSelect={handleCalendarSelect}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>

      <div className="relative flex min-w-0 flex-1 flex-col justify-center">
        <div ref={topSliderRef} className="relative flex items-center">
          <input
            type="range"
            min={0}
            max={sliderOptions.length - 1}
            step={1}
            value={sliderIndex}
            onChange={handleSliderChange}
            aria-label="Time"
            className="flex-1 accent-[#007AFF]"
          />
          <span
            className="pointer-events-none absolute -top-5 whitespace-nowrap rounded-full bg-white px-1.5 py-0.5 text-[11px] font-semibold text-gray-700 shadow-sm"
            style={{
              left: `${calculateClampedTooltipPosition(
                sliderPercentage,
                topSliderRef,
                70,
                0
              )}%`,
              transform: "translateX(-50%)",
            }}
          >
            {formatTimeDisplay(selectedTime)}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-2 overflow-hidden">
      {endSlot ? (
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0 flex-1">{dateTimeRow}</div>
          <div className="shrink-0">{endSlot}</div>
        </div>
      ) : (
        dateTimeRow
      )}

      {!hideCheckInsList && (
        <div className="border-t border-gray-200 pt-2 flex-1 min-h-0 flex flex-col overflow-hidden">
          <h2 className="mb-2 text-xs font-bold text-gray-900 flex-shrink-0">
            {liveMode ? "Live now" : "Active Check-ins"}
          </h2>
          <div className="overflow-y-auto flex-1 min-h-0">
            <div className="space-y-2">
              {areaEntries.map(([area, areaData]) => {
                const isExpanded = expandedAreas.has(area);
                const venueEntries = Object.entries(areaData.venues).sort(
                  (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
                );
                return (
                  <div
                    key={area}
                    className="rounded-lg border border-gray-200 bg-gray-50"
                  >
                    <button
                      type="button"
                      onClick={() => toggleArea(area)}
                      className="flex w-full items-center justify-between gap-2 p-3 text-left transition hover:bg-gray-100"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-gray-500" />
                        )}
                        <span className="font-semibold text-gray-900">
                          {area}
                        </span>
                      </div>
                      {areaData.total >= 1 ? (
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold",
                            liveMode
                              ? "bg-red-100 text-red-800"
                              : "bg-blue-100 text-blue-800"
                          )}
                        >
                          {areaData.total}
                        </span>
                      ) : null}
                    </button>
                    {isExpanded && (
                      <div className="border-t border-gray-200 bg-white">
                        {areaData.total === 0 ? (
                          <p className="px-3 py-4 text-center text-sm font-medium text-gray-500">
                            No Attendance Recorded
                          </p>
                        ) : (
                          <div className="space-y-1 p-2">
                            {venueEntries.map(([venueName, count]) => (
                              <div
                                key={venueName}
                                className="flex items-center justify-between gap-2 rounded px-3 py-2 hover:bg-gray-50"
                              >
                                <span className="text-sm font-medium text-gray-700">
                                  {venueName}
                                </span>
                                {count >= 1 ? (
                                  <span
                                    className={cn(
                                      "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold",
                                      liveMode
                                        ? "bg-red-50 text-red-600"
                                        : "bg-gray-100 text-gray-700"
                                    )}
                                  >
                                    {count}
                                  </span>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
