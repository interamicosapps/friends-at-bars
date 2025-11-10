import { useEffect, useMemo, useState, useRef, type ChangeEvent } from "react";
import Map, { Marker, Popup } from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";

import { Calendar } from "@/components/ui/Calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
import { CheckIn } from "@/types/checkin";
import { OHIO_STATE_VENUES } from "@/data/venues";
import {
  formatDateDisplay,
  formatTimeDisplay,
  generateStartTimeOptions,
  isCheckInActiveAt,
} from "@/lib/timeUtils";

interface MapViewProps {
  checkIns: CheckIn[];
  selectedDate: string;
  selectedTime: string;
  onSelectDate: (date: string) => void;
  onSelectTime: (time: string) => void;
}

interface PopupInfo {
  venue: {
    name: string;
    area: string;
    coordinates: [number, number];
  };
  checkIns: CheckIn[];
}

const formatDateValue = (date: Date) => format(date, "yyyy-MM-dd");

export default function MapView({
  checkIns,
  selectedDate,
  selectedTime,
  onSelectDate,
  onSelectTime,
}: MapViewProps) {
  const [popupInfo, setPopupInfo] = useState<PopupInfo | null>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const previousSelectedDate = useRef<string>(selectedDate);

  const sliderOptions = useMemo(() => generateStartTimeOptions(), []);
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

  useEffect(() => {
    if (!popupInfo) return;
    const updatedActivity = getVenueActivity(popupInfo.venue.name);
    if (updatedActivity.length === 0) {
      setPopupInfo(null);
      return;
    }
    setPopupInfo((prev) =>
      prev
        ? {
            ...prev,
            checkIns: updatedActivity,
          }
        : null
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCheckIns]);

  useEffect(() => {
    if (isCalendarOpen && previousSelectedDate.current !== selectedDate) {
      setIsCalendarOpen(false);
    }
    previousSelectedDate.current = selectedDate;
  }, [selectedDate, isCalendarOpen]);

  const createMarkerElement = (activityCount: number) => {
    const size = activityCount > 0 ? 36 : 0;

    if (size === 0) return null;

    return (
      <div
        className="custom-marker"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          backgroundColor: "#FF6B35",
          borderRadius: "50%",
          border: "4px solid white",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15), 0 2px 6px rgba(0,0,0,0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontWeight: "700",
          fontSize: "14px",
          cursor: "pointer",
          transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          zIndex: 1000,
          position: "relative",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "scale(1.15)";
          e.currentTarget.style.boxShadow =
            "0 6px 16px rgba(0,0,0,0.2), 0 3px 8px rgba(0,0,0,0.15)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "scale(1)";
          e.currentTarget.style.boxShadow =
            "0 4px 12px rgba(0,0,0,0.15), 0 2px 6px rgba(0,0,0,0.1)";
        }}
      >
        {activityCount}
      </div>
    );
  };

  const handleMarkerClick = (venue: (typeof OHIO_STATE_VENUES)[0]) => {
    const venueActivity = getVenueActivity(venue.name);
    setPopupInfo({
      venue,
      checkIns: venueActivity,
    });
  };

  const handleCalendarSelect = (day?: Date) => {
    if (!day) return;
    const value = formatDateValue(day);
    onSelectDate(value);
    setIsCalendarOpen(false);
    setIsCollapsed(false);
  };

  const handleSliderChange = (event: ChangeEvent<HTMLInputElement>) => {
    const index = Number(event.target.value);
    const time = sliderOptions[index] ?? sliderOptions[0];
    onSelectTime(time);
  };

  const markers = OHIO_STATE_VENUES.filter(
    (venue) => getVenueActivity(venue.name).length > 0
  );

  const rawSliderPercentage =
    sliderOptions.length > 1
      ? (sliderIndex / (sliderOptions.length - 1)) * 100
      : 0;
  const sliderPercentage = Math.min(100, Math.max(0, rawSliderPercentage));

  const compactDateTime = format(
    new Date(`${selectedDate}T${selectedTime}:00`),
    "M/d h:mm a"
  );

  return (
    <div className="relative h-96 w-full overflow-hidden rounded-xl border border-gray-200 shadow-lg">
      {isCollapsed ? (
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
          <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-white/60 bg-white/90 px-3 py-3 shadow-lg backdrop-blur">
            <button
              type="button"
              onClick={() => setIsCollapsed(true)}
              className="flex h-10 w-8 flex-col items-center justify-center gap-[3px] rounded-md border border-transparent text-gray-500 transition hover:border-gray-200 hover:bg-white"
              aria-label="Collapse map filters"
            >
              <span className="block h-[1.5px] w-5 rounded bg-gray-400" />
              <span className="block h-[1.5px] w-5 rounded bg-gray-400" />
              <span className="block h-[1.5px] w-5 rounded bg-gray-400" />
            </button>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Date
              </span>
              <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setIsCalendarOpen((prev) => !prev)}
                    className="flex items-center gap-2 rounded-md border border-gray-200 bg-white/80 px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-white"
                  >
                    <CalendarIcon className="h-4 w-4 text-gray-500" />
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

            <div className="relative flex flex-1 flex-col gap-2">
              <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-gray-500">
                <span>Time</span>
              </div>
              <div className="relative flex items-center">
                <input
                  type="range"
                  min={0}
                  max={sliderOptions.length - 1}
                  step={1}
                  value={sliderIndex}
                  onChange={handleSliderChange}
                  className="flex-1 accent-[#007AFF]"
                />
                <span
                  className="pointer-events-none absolute -top-7 rounded-full bg-white px-2 py-1 text-xs font-semibold text-gray-700 shadow-sm"
                  style={{
                    left: `calc(${sliderPercentage}% - 28px)`,
                  }}
                >
                  {formatTimeDisplay(selectedTime)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeCheckIns.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 -translate-y-1/2 text-center">
          <span className="rounded-full bg-white/90 px-4 py-2 text-sm font-medium text-gray-600 shadow">
            No check-ins during this time
          </span>
        </div>
      )}

      <Map
        mapLib={maplibregl}
        initialViewState={{
          longitude: -83.0067,
          latitude: 39.9917,
          zoom: 14,
        }}
        style={{ width: "100%", height: "100%" }}
        mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
        attributionControl={false}
      >
        {/* Custom attribution */}
        <div className="absolute bottom-2 right-2 rounded bg-white/80 px-2 py-1 text-xs text-gray-600">
          ©{" "}
          <a
            href="https://carto.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            CartoDB
          </a>
          , ©{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener noreferrer"
          >
            OpenStreetMap
          </a>{" "}
          contributors
        </div>

        {/* Venue markers */}
        {markers.map((venue) => {
          const venueActivity = getVenueActivity(venue.name);
          const activityCount = venueActivity.length;
          const markerElement = createMarkerElement(activityCount);

          if (!markerElement) return null;

          return (
            <Marker
              key={`${venue.name}-${selectedDate}-${selectedTime}`}
              longitude={venue.coordinates[1]}
              latitude={venue.coordinates[0]}
              onClick={() => handleMarkerClick(venue)}
            >
              {markerElement}
            </Marker>
          );
        })}

        {/* Popup */}
        {popupInfo && (
          <Popup
            longitude={popupInfo.venue.coordinates[1]}
            latitude={popupInfo.venue.coordinates[0]}
            onClose={() => setPopupInfo(null)}
            closeButton={true}
            closeOnClick={false}
            className="custom-popup"
          >
            <div className="min-w-[240px] p-5">
              <h3 className="mb-2 text-xl font-bold text-gray-900">
                {popupInfo.venue.name}
              </h3>
              <p className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-500">
                {popupInfo.venue.area}
              </p>
              <p className="mb-4 text-xs text-gray-500">
                {formatDateDisplay(selectedDate)}
              </p>

              {popupInfo.checkIns.length > 0 ? (
                <div>
                  <p className="mb-4 text-sm font-bold text-gray-800">
                    {popupInfo.checkIns.length} check-in
                    {popupInfo.checkIns.length > 1 ? "s" : ""}
                  </p>
                  <div className="space-y-3">
                    {popupInfo.checkIns.map((checkIn) => (
                      <div
                        key={checkIn.id}
                        className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs shadow-sm"
                      >
                        <p className="mb-2 text-sm font-bold text-gray-800">
                          {formatTimeDisplay(checkIn.startTime)} -{" "}
                          {formatTimeDisplay(checkIn.endTime)}
                        </p>
                        <p className="font-medium text-gray-500">
                          Duration: {Math.floor(checkIn.durationMinutes / 60)}h{" "}
                          {checkIn.durationMinutes % 60}m
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm font-semibold text-gray-500">
                  No check-ins during this time
                </p>
              )}
            </div>
          </Popup>
        )}
      </Map>
    </div>
  );
}
