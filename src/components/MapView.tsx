import { useEffect, useMemo, useState, useRef, type ChangeEvent } from "react";
import Map, { Marker, Popup } from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { format } from "date-fns";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

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
  heatMapMode?: boolean;
  showRightPanel?: boolean; // Enable right-side list panel
  timeOptions?: string[]; // Custom time options (for nightlife hours)
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
  heatMapMode = false,
  showRightPanel = false,
  timeOptions,
}: MapViewProps) {
  const [popupInfo, setPopupInfo] = useState<PopupInfo | null>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);
  const [expandedAreas, setExpandedAreas] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState<number>(14);
  const previousSelectedDate = useRef<string>(selectedDate);
  const topSliderRef = useRef<HTMLDivElement>(null);
  const rightSliderRef = useRef<HTMLDivElement>(null);
  const dateFieldRef = useRef<HTMLButtonElement>(null);

  const sliderOptions = useMemo(
    () => timeOptions ?? generateStartTimeOptions(),
    [timeOptions]
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

  // Heat map helper functions
  // Color interpolation: bright blue (high) to light cyan (low)
  const getHeatMapColor = (checkInCount: number, opacity: number): string => {
    const maxCheckIns = 10;
    const normalizedCount = Math.min(checkInCount / maxCheckIns, 1);

    // Hot color: #0165FC (RGB: 1, 101, 252)
    // Cold color: #c2f3ff (RGB: 194, 243, 255)
    const hotColor = { r: 1, g: 101, b: 252 };
    const coldColor = { r: 194, g: 243, b: 255 };

    // Interpolate between hot and cold colors
    const r = Math.round(
      hotColor.r + (coldColor.r - hotColor.r) * (1 - normalizedCount)
    );
    const g = Math.round(
      hotColor.g + (coldColor.g - hotColor.g) * (1 - normalizedCount)
    );
    const b = Math.round(
      hotColor.b + (coldColor.b - hotColor.b) * (1 - normalizedCount)
    );

    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  };

  const calculateOpacity = (checkInCount: number): number => {
    // 5+ check-ins: 100% opacity, 0 check-ins: 0% opacity
    // Linear scale between 0 and 5 check-ins
    const maxCheckIns = 5;
    if (checkInCount >= maxCheckIns) return 1.0;
    return checkInCount / maxCheckIns;
  };

  // Calculate radius in pixels based on zoom level to maintain constant geographic footprint
  const calculateHeatRadius = (latitude: number, zoomLevel: number): number => {
    // Constant geographic radius in meters (500 meters - 2x larger)
    const radiusMeters = 500;

    // Calculate meters per pixel at current zoom level and latitude
    // Formula: metersPerPixel = (earthCircumference * cos(latitude)) / (256 * 2^zoom)
    const earthCircumference = 40075017; // meters
    const metersPerPixel =
      (earthCircumference * Math.cos((latitude * Math.PI) / 180)) /
      (256 * Math.pow(2, zoomLevel));

    // Convert meters to pixels
    const radiusPixels = radiusMeters / metersPerPixel;

    return radiusPixels;
  };

  // Calculate blur amount based on zoom level - less blur when zoomed in for better differentiation
  const calculateBlurAmount = (zoomLevel: number): number => {
    // At zoom 12 (zoomed out): max blur (20px)
    // At zoom 16 (zoomed in): min blur (5px)
    // Linear interpolation between these points
    const minZoom = 12;
    const maxZoom = 16;
    const minBlur = 5;
    const maxBlur = 20;

    if (zoomLevel <= minZoom) return maxBlur;
    if (zoomLevel >= maxZoom) return minBlur;

    const normalizedZoom = (zoomLevel - minZoom) / (maxZoom - minZoom);
    return maxBlur - (maxBlur - minBlur) * normalizedZoom;
  };

  // Calculate gradient falloff percentage based on zoom level - steeper falloff when zoomed in
  const calculateGradientFalloff = (zoomLevel: number): number => {
    // At zoom 12 (zoomed out): gradual falloff (70% - more blending)
    // At zoom 16 (zoomed in): steep falloff (40% - more distinct)
    const minZoom = 12;
    const maxZoom = 16;
    const minFalloff = 40; // Steeper (more distinct)
    const maxFalloff = 70; // Gradual (more blending)

    if (zoomLevel <= minZoom) return maxFalloff;
    if (zoomLevel >= maxZoom) return minFalloff;

    const normalizedZoom = (zoomLevel - minZoom) / (maxZoom - minZoom);
    return maxFalloff - (maxFalloff - minFalloff) * normalizedZoom;
  };

  const rawSliderPercentage =
    sliderOptions.length > 1
      ? (sliderIndex / (sliderOptions.length - 1)) * 100
      : 0;
  const sliderPercentage = Math.min(100, Math.max(0, rawSliderPercentage));

  // Calculate clamped tooltip position to prevent overflow on both left and right edges
  // Tooltip is centered with translateX(-50%), so we need to account for half its width
  const calculateClampedTooltipPosition = (
    percentage: number,
    containerRef: React.RefObject<HTMLDivElement>,
    estimatedTooltipWidth: number = 70, // Estimated width in pixels for "11:00 PM"
    minLeftOffset: number = 0 // Minimum left offset in pixels (for date field overlap)
  ): number => {
    if (!containerRef.current) return percentage;

    const containerWidth = containerRef.current.offsetWidth;
    const tooltipHalfWidth = estimatedTooltipWidth / 2;

    // Calculate min percentage where tooltip won't overflow left edge
    // Formula: (minLeftOffset + tooltipHalfWidth) / containerWidth * 100
    const minPercentage =
      ((minLeftOffset + tooltipHalfWidth) / containerWidth) * 100;

    // Calculate max percentage where tooltip won't overflow right edge
    // Formula: (containerWidth - tooltipHalfWidth) / containerWidth * 100
    const maxPercentage =
      ((containerWidth - tooltipHalfWidth) / containerWidth) * 100;

    // Clamp to prevent overflow on both edges
    return Math.min(Math.max(percentage, minPercentage), maxPercentage);
  };

  // Format compact date/time, handling times >= 24:00 (next day)
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
    <div className="relative h-96 w-full overflow-hidden rounded-xl border border-gray-200 shadow-lg">
      {isCollapsed ? (
        <button
          type="button"
          onClick={() => {
            setIsCollapsed(false);
            if (showRightPanel) {
              setIsRightPanelCollapsed(true);
            }
          }}
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
                    ref={dateFieldRef}
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
              <div ref={topSliderRef} className="relative flex items-center">
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
                  className="pointer-events-none absolute -top-7 whitespace-nowrap rounded-full bg-white px-2 py-1 text-xs font-semibold text-gray-700 shadow-sm"
                  style={{
                    left: `${calculateClampedTooltipPosition(
                      sliderPercentage,
                      topSliderRef,
                      70,
                      0 // Allow tooltip to extend to left edge of slider container
                    )}%`,
                    transform: "translateX(-50%)",
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
        onMove={(evt) => {
          setZoom(evt.viewState.zoom);
        }}
      >
        {/* Custom attribution */}
        <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
          © CartoDB, © OpenStreetMap
        </div>

        {/* Venue markers or heat map */}
        {heatMapMode ? (
          // Heat map mode - show both heat circles and small markers
          <>
            {/* Heat circles */}
            {OHIO_STATE_VENUES.map((venue) => {
              const venueActivity = getVenueActivity(venue.name);
              const activityCount = venueActivity.length;

              if (activityCount === 0) return null;

              const opacity = calculateOpacity(activityCount);
              const centerColor = getHeatMapColor(activityCount, opacity);
              const transparentColor = centerColor.replace(/[\d.]+\)$/, "0)");

              // Calculate radius based on zoom level to maintain constant geographic footprint
              const radius = calculateHeatRadius(venue.coordinates[0], zoom);

              // Calculate zoom-based visual properties for better differentiation when zoomed in
              const blurAmount = calculateBlurAmount(zoom);
              const gradientFalloff = calculateGradientFalloff(zoom);

              return (
                <Marker
                  key={`heat-${venue.name}-${selectedDate}-${selectedTime}-${zoom}`}
                  longitude={venue.coordinates[1]}
                  latitude={venue.coordinates[0]}
                  anchor="center"
                >
                  <div
                    onClick={() => handleMarkerClick(venue)}
                    style={{
                      width: `${radius * 2}px`,
                      height: `${radius * 2}px`,
                      borderRadius: "50%",
                      background: `radial-gradient(circle, ${centerColor} 0%, ${transparentColor} ${gradientFalloff}%)`,
                      filter: `blur(${blurAmount}px)`,
                      cursor: "pointer",
                      position: "absolute",
                      top: `-${radius}px`,
                      left: `-${radius}px`,
                      pointerEvents: "auto",
                      mixBlendMode: "screen",
                      zIndex: 1000,
                      isolation: "isolate", // Create stacking context
                      transition:
                        "width 0.3s ease, height 0.3s ease, top 0.3s ease, left 0.3s ease, filter 0.3s ease",
                    }}
                    onMouseEnter={(e) => {
                      const hoverBlur = Math.max(blurAmount - 3, 2);
                      e.currentTarget.style.filter = `blur(${hoverBlur}px) brightness(1.2)`;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.filter = `blur(${blurAmount}px)`;
                    }}
                  />
                </Marker>
              );
            })}
            {/* Small location markers */}
            {markers.map((venue) => {
              const venueActivity = getVenueActivity(venue.name);
              const activityCount = venueActivity.length;

              if (activityCount === 0) return null;

              // Small marker - 1/3 the original size (36px -> 12px)
              const smallMarkerSize = 12;

              return (
                <Marker
                  key={`marker-${venue.name}-${selectedDate}-${selectedTime}-${zoom}`}
                  longitude={venue.coordinates[1]}
                  latitude={venue.coordinates[0]}
                  anchor="center"
                  onClick={() => handleMarkerClick(venue)}
                >
                  <div
                    className="custom-marker"
                    style={{
                      width: `${smallMarkerSize}px`,
                      height: `${smallMarkerSize}px`,
                      backgroundColor: "#FF6B35",
                      borderRadius: "50%",
                      border: "2px solid white",
                      boxShadow:
                        "0 2px 6px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.1)",
                      cursor: "pointer",
                      transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                      zIndex: 2000, // Always above heat circles
                      position: "absolute",
                      isolation: "isolate", // Create new stacking context to ensure z-index works
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = "scale(1.3)";
                      e.currentTarget.style.boxShadow =
                        "0 3px 8px rgba(0,0,0,0.2), 0 2px 4px rgba(0,0,0,0.15)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = "scale(1)";
                      e.currentTarget.style.boxShadow =
                        "0 2px 6px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.1)";
                    }}
                  />
                </Marker>
              );
            })}
          </>
        ) : (
          // Regular marker mode
          markers.map((venue) => {
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
          })
        )}

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
              <p className="mb-4 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                {popupInfo.venue.area}
              </p>

              {popupInfo.checkIns.length > 0 ? (
                <p className="text-sm font-bold text-gray-800">
                  {popupInfo.checkIns.length} check-in
                  {popupInfo.checkIns.length > 1 ? "s" : ""}
                </p>
              ) : (
                <p className="text-sm font-semibold text-gray-500">
                  No check-ins during this time
                </p>
              )}
            </div>
          </Popup>
        )}
      </Map>

      {/* Right-side list panel */}
      {showRightPanel && (
        <>
          {isRightPanelCollapsed ? (
            <button
              type="button"
              onClick={() => {
                setIsRightPanelCollapsed(false);
                setIsCollapsed(true);
                setIsCalendarOpen(false);
              }}
              className="absolute right-0 top-1/2 z-20 -translate-y-1/2 rounded-l-lg bg-white/90 px-2 py-4 text-gray-700 shadow-md backdrop-blur transition hover:bg-white"
              aria-label="Expand check-ins list"
            >
              <ChevronLeft className="h-5 w-5 text-gray-500" />
            </button>
          ) : (
            <div className="pointer-events-none absolute bottom-0 right-0 top-0 z-20 w-80">
              <div className="pointer-events-auto h-full overflow-y-auto rounded-l-xl border-b border-l border-t border-white/60 bg-white/95 shadow-2xl backdrop-blur">
                <div className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 backdrop-blur">
                  <div className="flex items-center justify-between px-4 py-3">
                    <h2 className="text-lg font-bold text-gray-900">
                      Active Check-ins
                    </h2>
                    <button
                      type="button"
                      onClick={() => setIsRightPanelCollapsed(true)}
                      className="flex h-8 w-8 flex-col items-center justify-center gap-[3px] rounded-md border border-transparent text-gray-500 transition hover:border-gray-200 hover:bg-gray-100"
                      aria-label="Collapse check-ins list"
                    >
                      <span className="block h-[1.5px] w-4 rounded bg-gray-400" />
                      <span className="block h-[1.5px] w-4 rounded bg-gray-400" />
                      <span className="block h-[1.5px] w-4 rounded bg-gray-400" />
                    </button>
                  </div>
                  {/* Time slider */}
                  <div className="border-t border-gray-200 px-4 py-3">
                    <div className="relative flex flex-col gap-2">
                      <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-gray-500">
                        <span>Time</span>
                      </div>
                      <div
                        ref={rightSliderRef}
                        className="relative flex items-center"
                      >
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
                          className="pointer-events-none absolute -top-7 whitespace-nowrap rounded-full bg-white px-2 py-1 text-xs font-semibold text-gray-700 shadow-sm"
                          style={{
                            left: `${calculateClampedTooltipPosition(
                              sliderPercentage,
                              rightSliderRef,
                              70,
                              0 // No left offset needed for right panel
                            )}%`,
                            transform: "translateX(-50%)",
                          }}
                        >
                          {formatTimeDisplay(selectedTime)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="p-4">
                  {activeCheckIns.length === 0 ? (
                    <p className="py-8 text-center text-sm text-gray-500">
                      No check-ins during this time
                    </p>
                  ) : (
                    (() => {
                      // Group venues by area and count check-ins
                      type AreaData = {
                        venues: Record<string, number>;
                        total: number;
                      };
                      const areaMap: Record<string, AreaData> = {};

                      OHIO_STATE_VENUES.forEach((venue) => {
                        const venueCheckIns = getVenueActivity(venue.name);
                        if (venueCheckIns.length > 0 && venue.area) {
                          if (!areaMap[venue.area]) {
                            areaMap[venue.area] = {
                              venues: {},
                              total: 0,
                            };
                          }
                          const areaData = areaMap[venue.area];
                          areaData.venues[venue.name] = venueCheckIns.length;
                          areaData.total += venueCheckIns.length;
                        }
                      });

                      const toggleArea = (area: string) => {
                        setExpandedAreas((prev) => {
                          const next = new Set<string>(prev);
                          if (next.has(area)) {
                            next.delete(area);
                          } else {
                            next.add(area);
                          }
                          return next;
                        });
                      };

                      const areaEntries = Object.entries(areaMap);
                      areaEntries.sort((a, b) => b[1].total - a[1].total);

                      return (
                        <div className="space-y-2">
                          {areaEntries.map(([area, areaData]) => {
                            const isExpanded = expandedAreas.has(area);
                            const venueEntries = Object.entries(
                              areaData.venues
                            );
                            venueEntries.sort((a, b) => b[1] - a[1]);

                            return (
                              <div
                                key={area}
                                className="rounded-lg border border-gray-200 bg-gray-50"
                              >
                                <button
                                  type="button"
                                  onClick={() => toggleArea(area)}
                                  className="flex w-full items-center justify-between p-3 text-left transition hover:bg-gray-100"
                                >
                                  <div className="flex items-center gap-2">
                                    {isExpanded ? (
                                      <ChevronDown className="h-4 w-4 text-gray-500" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4 text-gray-500" />
                                    )}
                                    <span className="font-semibold text-gray-900">
                                      {area}
                                    </span>
                                  </div>
                                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                                    {areaData.total}
                                  </span>
                                </button>
                                {isExpanded && (
                                  <div className="border-t border-gray-200 bg-white">
                                    <div className="space-y-1 p-2">
                                      {venueEntries.map(
                                        ([venueName, count]) => (
                                          <div
                                            key={venueName}
                                            className="flex items-center justify-between rounded px-3 py-2 hover:bg-gray-50"
                                          >
                                            <span className="text-sm font-medium text-gray-700">
                                              {venueName}
                                            </span>
                                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">
                                              {count}
                                            </span>
                                          </div>
                                        )
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
