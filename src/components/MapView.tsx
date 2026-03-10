import { useEffect, useMemo, useState, useRef } from "react";
import Map, { Marker, Popup } from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { CheckIn, VenueCounts } from "@/types/checkin";
import { OHIO_STATE_VENUES } from "@/data/venues";
import {
  generateStartTimeOptions,
  isCheckInActiveAt,
} from "@/lib/timeUtils";
import { locationService } from "@/lib/locationService";
import ActiveCheckInsPanel from "@/components/ActiveCheckInsPanel";

interface MapViewProps {
  checkIns: CheckIn[];
  selectedDate: string;
  selectedTime: string;
  onSelectDate: (date: string) => void;
  onSelectTime: (time: string) => void;
  heatMapMode?: boolean;
  timeOptions?: string[]; // Custom time options (for nightlife hours)
  userLocation?: { latitude: number; longitude: number } | null;
  /** When false, only the map is rendered (no date/time list panel). Default true. */
  showListPanel?: boolean;
  /** When showListPanel is true, optional start time to reset to when date changes. */
  dynamicStartTime?: string;
  /** Optional class for the map container (e.g. h-full for full-height map). */
  className?: string;
  /** Called once when the user first interacts with the map (e.g. pan/zoom). */
  onFirstInteraction?: () => void;
}

interface PopupInfo {
  venue: {
    name: string;
    area: string;
    coordinates: [number, number];
  };
  checkIns: CheckIn[];
}

export default function MapView({
  checkIns,
  selectedDate,
  selectedTime,
  onSelectDate,
  onSelectTime,
  heatMapMode = false,
  timeOptions,
  userLocation,
  showListPanel = true,
  dynamicStartTime,
  className,
  onFirstInteraction,
}: MapViewProps) {
  const [popupInfo, setPopupInfo] = useState<PopupInfo | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [zoom, setZoom] = useState<number>(14);
  const [liveCounts, setLiveCounts] = useState<VenueCounts>({});
  const hasFiredFirstInteraction = useRef(false);
  const [viewState, setViewState] = useState({
    longitude: -83.0067,
    latitude: 39.9917,
    zoom: 14,
  });
  const previousSelectedDate = useRef<string | null>(null);
  const previousSelectedTime = useRef<string | null>(null);

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

  const getVenueActivity = (venueName: string) =>
    activeCheckIns.filter((checkIn) => checkIn.venue === venueName);

  // Subscribe to live location updates
  useEffect(() => {
    const subscription = locationService.subscribeToVenueCounts((counts) => {
      setLiveCounts(counts);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Calculate the venue with the most check-ins for the current time
  const venueWithMostCheckIns = useMemo(() => {
    if (activeCheckIns.length === 0) {
      return null; // No check-ins, use default coordinates
    }

    // Count check-ins per venue
    const venueCounts: Record<string, number> = {};
    activeCheckIns.forEach((checkIn) => {
      venueCounts[checkIn.venue] = (venueCounts[checkIn.venue] || 0) + 1;
    });

    // Find the maximum count
    const maxCount = Math.max(...Object.values(venueCounts));

    // Find all venues with the max count (handle ties)
    const topVenues = OHIO_STATE_VENUES.filter(
      (venue) => venueCounts[venue.name] === maxCount
    );

    // Randomly select one if there's a tie
    if (topVenues.length > 0) {
      const randomIndex = Math.floor(Math.random() * topVenues.length);
      return topVenues[randomIndex];
    }

    return null;
  }, [activeCheckIns]);

  // Update map view to center on venue with most check-ins when date/time changes
  useEffect(() => {
    // Only update when date or time changes, not on every check-in update
    const dateChanged = previousSelectedDate.current !== selectedDate;
    const timeChanged = previousSelectedTime.current !== selectedTime;
    
    if (dateChanged || timeChanged) {
      if (venueWithMostCheckIns) {
        setViewState({
          longitude: venueWithMostCheckIns.coordinates[1],
          latitude: venueWithMostCheckIns.coordinates[0],
          zoom: 14,
        });
      } else {
        // No check-ins, use default coordinates
        setViewState({
          longitude: -83.0067,
          latitude: 39.9917,
          zoom: 14,
        });
      }
      previousSelectedDate.current = selectedDate;
      previousSelectedTime.current = selectedTime;
    }
  }, [venueWithMostCheckIns, selectedDate, selectedTime]);

  useEffect(() => {
    if (!popupInfo) return;
    const updatedActivity = getVenueActivity(popupInfo.venue.name);
    // Keep popup open even if check-ins become 0 (user can still see venue info)
    setPopupInfo((prev) =>
      prev
        ? {
            ...prev,
            checkIns: updatedActivity,
          }
        : null
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCheckIns, liveCounts]);

  useEffect(() => {
    previousSelectedDate.current = selectedDate;
  }, [selectedDate]);

  const createMarkerElement = (activityCount: number, liveCount: number = 0) => {
    const totalCount = activityCount + liveCount;
    // Show marker even if no check-ins or live users (for visibility)
    const size = totalCount > 0 ? 36 : 24;
    const backgroundColor = totalCount > 0 ? "#C72608" : "#9CA3AF"; // Gray for no activity
    const borderWidth = totalCount > 0 ? 4 : 3;
    const fontSize = totalCount > 0 ? "14px" : "0px"; // Hide text for empty markers

    return (
      <div
        className="custom-marker"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          backgroundColor: backgroundColor,
          borderRadius: "50%",
          border: `${borderWidth}px solid white`,
          boxShadow: "0 4px 12px rgba(0,0,0,0.15), 0 2px 6px rgba(0,0,0,0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontWeight: "700",
          fontSize: fontSize,
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
        {totalCount > 0 ? totalCount : ""}
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

  // Show all venues, not just those with check-ins
  const markers = OHIO_STATE_VENUES;

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

  const handlePanelDateChange = (date: string) => {
    onSelectDate(date);
    if (dynamicStartTime) onSelectTime(dynamicStartTime);
  };

  return (
    <div
      className={`relative w-full overflow-hidden rounded-xl border border-gray-200 shadow-lg ${className ?? "h-96"}`}
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
            <div className="pointer-events-auto flex flex-col gap-3 rounded-xl border border-white/60 bg-white/90 px-3 py-3 shadow-lg backdrop-blur max-w-md max-h-[360px] overflow-hidden">
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

      <Map
        mapLib={maplibregl}
        {...viewState}
        onMove={(evt) => {
          if (!hasFiredFirstInteraction.current && onFirstInteraction) {
            hasFiredFirstInteraction.current = true;
            onFirstInteraction();
          }
          setZoom(evt.viewState.zoom);
          setViewState(evt.viewState);
        }}
        style={{ width: "100%", height: "100%" }}
        mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
        attributionControl={false}
      >
        {/* Custom attribution */}
        <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
          © CartoDB, © OpenStreetMap
        </div>

        {/* Venue markers or heat map */}
        {heatMapMode ? (
          // Heat map mode - show both heat circles and small markers
          <>
            {/* Heat circles - only show for venues with check-ins */}
            {OHIO_STATE_VENUES.map((venue) => {
              const venueActivity = getVenueActivity(venue.name);
              const activityCount = venueActivity.length;
              const liveCount = liveCounts[venue.name] || 0;
              const totalCount = activityCount + liveCount;

              // Only show heat circles for venues with check-ins or live users
              if (totalCount === 0) return null;

              const opacity = calculateOpacity(totalCount);
              const centerColor = getHeatMapColor(totalCount, opacity);
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
            {/* Small location markers - show all venues */}
            {markers.map((venue) => {
              const venueActivity = getVenueActivity(venue.name);
              const activityCount = venueActivity.length;
              const liveCount = liveCounts[venue.name] || 0;
              const totalCount = activityCount + liveCount;

              // Small marker - 1/3 the original size (36px -> 12px)
              // Use gray for venues with no check-ins or live users
              const smallMarkerSize = 12;
              const backgroundColor = totalCount > 0 ? "#C72608" : "#9CA3AF";

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
                      backgroundColor: backgroundColor,
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
          // Regular marker mode - show all venues
          markers.map((venue) => {
            const venueActivity = getVenueActivity(venue.name);
            const activityCount = venueActivity.length;
            const liveCount = liveCounts[venue.name] || 0;
            const markerElement = createMarkerElement(activityCount, liveCount);

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

        {/* User location marker (green dot) */}
        {userLocation && (
          <Marker
            longitude={userLocation.longitude}
            latitude={userLocation.latitude}
            anchor="center"
          >
            <div
              className="user-location-marker"
              style={{
                width: "16px",
                height: "16px",
                backgroundColor: "#10B981",
                borderRadius: "50%",
                border: "3px solid white",
                boxShadow: "0 2px 8px rgba(16, 185, 129, 0.4), 0 0 0 4px rgba(16, 185, 129, 0.1)",
                cursor: "pointer",
                zIndex: 3000,
                position: "absolute",
              }}
            />
          </Marker>
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

              {(() => {
                const checkInCount = popupInfo.checkIns.length;
                const liveCount = liveCounts[popupInfo.venue.name] || 0;
                const totalCount = checkInCount + liveCount;

                if (totalCount === 0) {
                  return (
                    <p className="text-sm font-semibold text-gray-500">
                      No check-ins during this time
                    </p>
                  );
                }

                return (
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-gray-800">
                      {totalCount} {totalCount === 1 ? "person" : "people"} total
                    </p>
                    <div className="text-xs text-gray-600 space-y-0.5">
                      {checkInCount > 0 && (
                        <p>
                          {checkInCount} scheduled check-in
                          {checkInCount > 1 ? "s" : ""}
                        </p>
                      )}
                      {liveCount > 0 && (
                        <p>
                          {liveCount} live user{liveCount > 1 ? "s" : ""} at venue
                        </p>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          </Popup>
        )}
      </Map>
    </div>
  );
}
