import { useEffect, useMemo, useState, useRef } from "react";
import Map, { Marker, Popup } from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { CheckIn, VenueCounts } from "@/types/checkin";
import { OHIO_STATE_VENUES } from "@/data/venues";
import { isCheckInActiveAt } from "@/lib/timeUtils";
import { locationService } from "@/lib/locationService";

export interface MapViewMapLibreProps {
  checkIns: CheckIn[];
  selectedDate: string;
  selectedTime: string;
  userLocation?: { latitude: number; longitude: number } | null;
  onFirstInteraction?: () => void;
  onMapReady?: () => void;
}

/** Android (and fallback): MapLibre + markers + popup. Heat mode removed. */
export default function MapViewMapLibre({
  checkIns,
  selectedDate,
  selectedTime,
  userLocation,
  onFirstInteraction,
  onMapReady,
}: MapViewMapLibreProps) {
  const [popupInfo, setPopupInfo] = useState<{
    venue: {
      name: string;
      area: string;
      coordinates: [number, number];
    };
    checkIns: CheckIn[];
  } | null>(null);
  const [liveCounts, setLiveCounts] = useState<VenueCounts>({});
  const hasFiredFirstInteraction = useRef(false);
  const [viewState, setViewState] = useState({
    longitude: -83.0067,
    latitude: 39.9917,
    zoom: 14,
  });
  const previousSelectedDate = useRef<string | null>(null);
  const previousSelectedTime = useRef<string | null>(null);

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
    const subscription = locationService.subscribeToVenueCounts((counts) => {
      setLiveCounts(counts);
    });
    return () => subscription.unsubscribe();
  }, []);

  const venueWithMostCheckIns = useMemo(() => {
    if (activeCheckIns.length === 0) return null;
    const venueCounts: Record<string, number> = {};
    activeCheckIns.forEach((checkIn) => {
      venueCounts[checkIn.venue] = (venueCounts[checkIn.venue] || 0) + 1;
    });
    const maxCount = Math.max(...Object.values(venueCounts));
    const topVenues = OHIO_STATE_VENUES.filter(
      (venue) => venueCounts[venue.name] === maxCount
    );
    if (topVenues.length > 0) {
      const randomIndex = Math.floor(Math.random() * topVenues.length);
      return topVenues[randomIndex];
    }
    return null;
  }, [activeCheckIns]);

  useEffect(() => {
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
    setPopupInfo((prev) =>
      prev
        ? { ...prev, checkIns: updatedActivity }
        : null
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCheckIns, liveCounts]);

  const markers = OHIO_STATE_VENUES;

  const createMarkerElement = () => {
    const size = 12;
    const backgroundColor = "#3B82F6"; // blue venue dots
    const borderWidth = 3;
    return (
      <div
        className="custom-marker"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          backgroundColor,
          borderRadius: "50%",
          border: `${borderWidth}px solid white`,
          boxShadow:
            "0 2px 6px rgba(37,99,235,0.35), 0 0 0 3px rgba(37,99,235,0.15)",
          cursor: "pointer",
          transition: "transform 0.2s ease, box-shadow 0.2s ease",
          zIndex: 1000,
          position: "relative",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "scale(1.25)";
          e.currentTarget.style.boxShadow =
            "0 4px 10px rgba(37,99,235,0.4), 0 0 0 4px rgba(37,99,235,0.25)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "scale(1)";
          e.currentTarget.style.boxShadow =
            "0 2px 6px rgba(37,99,235,0.35), 0 0 0 3px rgba(37,99,235,0.15)";
        }}
      />
    );
  };

  const handleMarkerClick = (venue: (typeof OHIO_STATE_VENUES)[0]) => {
    setPopupInfo({
      venue,
      checkIns: getVenueActivity(venue.name),
    });
  };

  const mapReadyFired = useRef(false);
  const fireMapReady = () => {
    if (mapReadyFired.current || !onMapReady) return;
    mapReadyFired.current = true;
    onMapReady();
  };

  return (
    <Map
      mapLib={maplibregl}
      {...viewState}
      onLoad={fireMapReady}
      onMove={(evt) => {
        if (!hasFiredFirstInteraction.current && onFirstInteraction) {
          hasFiredFirstInteraction.current = true;
          onFirstInteraction();
        }
        setViewState(evt.viewState);
      }}
      style={{ width: "100%", height: "100%" }}
      mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
      attributionControl={false}
    >
      <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
        © CartoDB, © OpenStreetMap
      </div>

      {markers.map((venue) => {
        const markerElement = createMarkerElement();
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
              boxShadow:
                "0 2px 8px rgba(16, 185, 129, 0.4), 0 0 0 4px rgba(16, 185, 129, 0.1)",
              cursor: "pointer",
              zIndex: 3000,
              position: "absolute",
            }}
          />
        </Marker>
      )}

      {popupInfo && (
        <Popup
          longitude={popupInfo.venue.coordinates[1]}
          latitude={popupInfo.venue.coordinates[0]}
          onClose={() => setPopupInfo(null)}
          closeButton
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
                    {totalCount}{" "}
                    {totalCount === 1 ? "person" : "people"} total
                  </p>
                  <div className="space-y-0.5 text-xs text-gray-600">
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
  );
}
