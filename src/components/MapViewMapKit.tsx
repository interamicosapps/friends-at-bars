import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { CheckIn, VenueCounts } from "@/types/checkin";
import { OHIO_STATE_VENUES } from "@/data/venues";
import { isCheckInActiveAt } from "@/lib/timeUtils";
import { locationService } from "@/lib/locationService";
import { loadMapKit } from "@/lib/mapkitLoader";

const MAP_REGION_KEY = "activities_map_region";

export interface MapViewMapKitProps {
  checkIns: CheckIn[];
  selectedDate: string;
  selectedTime: string;
  userLocation?: { latitude: number; longitude: number } | null;
  onFirstInteraction?: () => void;
  onMapReady?: () => void;
}

/** iOS + web: MapKit JS — Apple Maps in WKWebView / browser. */
export default function MapViewMapKit({
  checkIns,
  selectedDate,
  selectedTime,
  userLocation,
  onFirstInteraction,
  onMapReady,
}: MapViewMapKitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapkit.Map | null>(null);
  const mapReadyFired = useRef(false);
  const hasFiredFirstInteraction = useRef(false);
  const userLocationAnnotationRef = useRef<mapkit.Annotation | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const onMapReadyRef = useRef(onMapReady);
  const onFirstInteractionRef = useRef(onFirstInteraction);
  const getVenueActivityRef = useRef<(name: string) => CheckIn[]>(() => []);
  onMapReadyRef.current = onMapReady;
  onFirstInteractionRef.current = onFirstInteraction;

  const [popupInfo, setPopupInfo] = useState<{
    venue: {
      name: string;
      area: string;
      coordinates: [number, number];
    };
    checkIns: CheckIn[];
  } | null>(null);
  const [liveCounts, setLiveCounts] = useState<VenueCounts>({});
  const [error, setError] = useState<string | null>(null);

  const activeCheckIns = useMemo(
    () =>
      checkIns.filter((checkIn) =>
        isCheckInActiveAt(checkIn, selectedDate, selectedTime)
      ),
    [checkIns, selectedDate, selectedTime]
  );

  const getVenueActivity = useCallback(
    (venueName: string) =>
      activeCheckIns.filter((checkIn) => checkIn.venue === venueName),
    [activeCheckIns]
  );
  getVenueActivityRef.current = getVenueActivity;

  useEffect(() => {
    const subscription = locationService.subscribeToVenueCounts((counts) => {
      setLiveCounts(counts);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!popupInfo) return;
    const updatedActivity = getVenueActivity(popupInfo.venue.name);
    setPopupInfo((prev) =>
      prev ? { ...prev, checkIns: updatedActivity } : null
    );
  }, [activeCheckIns, liveCounts, getVenueActivity]);

  useEffect(() => {
    if (!popupInfo) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopupInfo(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [popupInfo]);

  // Init map once (no dependency on callbacks so map never reloads on parent re-render)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let savedRegion: mapkit.CoordinateRegion | null = null;
    if (typeof sessionStorage !== "undefined") {
      try {
        const raw = sessionStorage.getItem(MAP_REGION_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as {
            centerLat: number;
            centerLon: number;
            spanLat: number;
            spanLon: number;
          };
          savedRegion = new mapkit.CoordinateRegion(
            new mapkit.Coordinate(parsed.centerLat, parsed.centerLon),
            new mapkit.CoordinateSpan(parsed.spanLat, parsed.spanLon)
          );
        }
      } catch {
        // ignore
      }
    }

    let destroyed = false;
    loadMapKit()
      .then(() => {
        if (destroyed || !el) return;
        const region =
          savedRegion ??
          new mapkit.CoordinateRegion(
            new mapkit.Coordinate(39.9917, -83.0067),
            new mapkit.CoordinateSpan(0.06, 0.06)
          );
        const map = new mapkit.Map(el, { region });
        mapRef.current = map;

        const openVenuePopup = (venueName: string) => {
          const venue = OHIO_STATE_VENUES.find((v) => v.name === venueName);
          if (!venue) return;
          if (
            !hasFiredFirstInteraction.current &&
            onFirstInteractionRef.current
          ) {
            hasFiredFirstInteraction.current = true;
            onFirstInteractionRef.current();
          }
          setPopupInfo({
            venue,
            checkIns: getVenueActivityRef.current(venue.name),
          });
        };

        // Add annotations — use select on each annotation (MapKit JS event API)
        for (const venue of OHIO_STATE_VENUES) {
          const c = new mapkit.Coordinate(
            venue.coordinates[0],
            venue.coordinates[1]
          );
          const m = new mapkit.MarkerAnnotation(c, {
            title: "",
            subtitle: "",
            color: "#3B82F6", // blue venue markers
            glyphText: "",
          } as any);
          (m as unknown as { data?: { venueName?: string } }).data = {
            venueName: venue.name,
          };
          const ann = m as mapkit.Annotation & {
            addEventListener?: (type: string, fn: () => void) => void;
          };
          if (typeof ann.addEventListener === "function") {
            ann.addEventListener("select", () => openVenuePopup(venue.name));
          }
          map.addAnnotation(m);
        }

        // Fallback: map-level selection if supported
        const mapAny = map as mapkit.Map & {
          addEventListener?: (
            type: string,
            fn: (e: { annotation: mapkit.Annotation }) => void
          ) => void;
        };
        if (typeof mapAny.addEventListener === "function") {
          mapAny.addEventListener(
            "select",
            (e: { annotation: mapkit.Annotation }) => {
              const ann = e.annotation as mapkit.Annotation & {
                data?: { venueName?: string };
              };
              const fromData = ann.data?.venueName;
              const venueName = fromData || ann.subtitle || ann.title;
              if (venueName) openVenuePopup(venueName);
            }
          );
        }
        // MapKit has no single onLoad; after annotations + next frame, treat as ready.
        if (onMapReadyRef.current && !mapReadyFired.current) {
          mapReadyFired.current = true;
          requestAnimationFrame(() => {
            requestAnimationFrame(() => onMapReadyRef.current?.());
          });
        }
        setMapReady(true);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "MapKit JS failed to load");
      });

    return () => {
      destroyed = true;
      setMapReady(false);
      const map = mapRef.current;
      if (map && typeof sessionStorage !== "undefined") {
        try {
          const r = map.region as any;
          if (r && r.center && r.span) {
            const center = r.center as { latitude: number; longitude: number };
            const span = r.span as {
              latitudeDelta: number;
              longitudeDelta: number;
            };
            sessionStorage.setItem(
              MAP_REGION_KEY,
              JSON.stringify({
                centerLat: center.latitude,
                centerLon: center.longitude,
                spanLat: span.latitudeDelta,
                spanLon: span.longitudeDelta,
              })
            );
          }
        } catch {
          // ignore
        }
        try {
          map.destroy();
        } catch {
          // ignore
        }
        mapRef.current = null;
      }
      userLocationAnnotationRef.current = null;
    };
  }, []);

  // User location marker (green dot) — add/remove when userLocation or map changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const prev = userLocationAnnotationRef.current;
    if (prev) {
      try {
        map.removeAnnotation(prev);
      } catch {
        // ignore
      }
      userLocationAnnotationRef.current = null;
    }

    if (userLocation) {
      const coord = new mapkit.Coordinate(
        userLocation.latitude,
        userLocation.longitude
      );
      const marker = new mapkit.MarkerAnnotation(coord, {
        title: "",
        subtitle: "",
        color: "#10B981",
        glyphColor: "#ffffff",
      } as any);
      map.addAnnotation(marker);
      userLocationAnnotationRef.current = marker;
    }
  }, [userLocation, mapReady]);

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gray-100 p-4 text-center text-sm text-gray-600">
        <div>
          <p className="font-semibold">Map unavailable</p>
          <p className="mt-1">{error}</p>
          <p className="mt-2 text-xs">
            Set VITE_MAPKIT_TOKEN and allowlist this origin in Apple Developer →
            Maps.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[300px] w-full">
      <div ref={containerRef} className="absolute inset-0 min-h-[300px]" />
      {/* HTML popup overlay — centered in map area; backdrop tap dismisses */}
      {popupInfo && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-4 pointer-events-none">
          <button
            type="button"
            className="absolute inset-0 cursor-pointer bg-black/35 pointer-events-auto"
            aria-label="Close venue details"
            onClick={() => setPopupInfo(null)}
          />
          <div
            className="relative z-10 w-full max-w-sm max-h-[min(85vh,520px)] overflow-y-auto rounded-xl border border-gray-200 bg-white p-5 shadow-xl pointer-events-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mapkit-venue-popup-title"
            onClick={(e) => e.stopPropagation()}
          >
          <button
            type="button"
            className="absolute right-2 top-2 z-10 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
            onClick={() => setPopupInfo(null)}
          >
            ×
          </button>
          <h3
            id="mapkit-venue-popup-title"
            className="mb-2 pr-8 text-xl font-bold text-gray-900"
          >
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
        </div>
      )}
    </div>
  );
}
