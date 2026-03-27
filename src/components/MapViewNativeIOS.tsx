import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { CheckIn, VenueCounts } from "@/types/checkin";
import { OHIO_STATE_VENUES } from "@/data/venues";
import { isCheckInActiveAt } from "@/lib/timeUtils";
import { locationService } from "@/lib/locationService";
import { BarFestNativeMap } from "bar-fest-native-map";
import type { MapViewMapKitProps } from "@/components/MapViewMapKit";

const MAP_REGION_KEY = "activities_map_region";

/** Native iOS: MKMapView via Capacitor plugin; same props as MapKit JS map. */
export default function MapViewNativeIOS({
  checkIns,
  selectedDate,
  selectedTime,
  userLocation,
  onFirstInteraction,
  onMapReady,
}: MapViewMapKitProps) {
  const mapDebugEnabled =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("mapDebug") === "1";
  const containerRef = useRef<HTMLDivElement>(null);
  const mapReadyFired = useRef(false);
  const hasFiredFirstInteraction = useRef(false);
  const restoredRegionRef = useRef(false);
  const listenersRef = useRef<{ remove: () => Promise<void> }[]>([]);
  const isNativeInitializedRef = useRef(false);
  const syncCountRef = useRef(0);
  const [mapReady, setMapReady] = useState(false);
  const [debugInfo, setDebugInfo] = useState<{
    syncCount: number;
    scrollY: number;
    containerRect: { left: number; top: number; width: number; height: number } | null;
    sentFrame: { left: number; top: number; width: number; height: number } | null;
    nativeState: Awaited<ReturnType<typeof BarFestNativeMap.getDebugState>> | null;
    lastSyncMs: number | null;
    lastError: string | null;
  }>({
    syncCount: 0,
    scrollY: 0,
    containerRect: null,
    sentFrame: null,
    nativeState: null,
    lastSyncMs: null,
    lastError: null,
  });

  const onMapReadyRef = useRef(onMapReady);
  const onFirstInteractionRef = useRef(onFirstInteraction);
  const getVenueActivityRef = useRef<((name: string) => CheckIn[])>(() => []);
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
    let savedRegion: {
      centerLat: number;
      centerLon: number;
      spanLat: number;
      spanLon: number;
    } | null = null;
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
          savedRegion = parsed;
          restoredRegionRef.current = true;
        }
      } catch {
        // ignore
      }
    }

    const region =
      savedRegion ?? {
        centerLat: 39.9917,
        centerLon: -83.0067,
        spanLat: 0.06,
        spanLon: 0.06,
      };

    const venuePayload = OHIO_STATE_VENUES.map((v) => ({
      name: v.name,
      lat: v.coordinates[0],
      lon: v.coordinates[1],
    }));

    listenersRef.current = [];

    let cancelled = false;

    void (async () => {
      await BarFestNativeMap.initialize(region);
      if (cancelled) return;

      // Match the native map's frame to the React map container so it moves with scrolling/layout.
      const el = containerRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const frame = {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        };
        await BarFestNativeMap.setFrame(frame);
        if (mapDebugEnabled) {
          syncCountRef.current += 1;
          setDebugInfo((prev) => ({
            ...prev,
            syncCount: syncCountRef.current,
            scrollY: window.scrollY,
            containerRect: frame,
            sentFrame: frame,
            lastSyncMs: Date.now(),
          }));
        }
      }
      isNativeInitializedRef.current = true;

      await BarFestNativeMap.setVenues({ venues: venuePayload });
      if (cancelled) return;

      const venueTapListener = await BarFestNativeMap.addListener(
        "venueTap",
        (d) => {
        const venueName = d.venueName;
        if (!venueName) return;
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
        }
      );
      listenersRef.current.push(venueTapListener);

      const regionListener = await BarFestNativeMap.addListener(
        "regionChanged",
        (d) => {
          if (
            typeof sessionStorage === "undefined" ||
            d.centerLat == null ||
            d.centerLon == null ||
            d.spanLat == null ||
            d.spanLon == null
          ) {
            return;
          }
          try {
            sessionStorage.setItem(
              MAP_REGION_KEY,
              JSON.stringify({
                centerLat: d.centerLat,
                centerLon: d.centerLon,
                spanLat: d.spanLat,
                spanLon: d.spanLon,
              })
            );
          } catch {
            // ignore
          }
        }
      );
      listenersRef.current.push(regionListener);

      if (onMapReadyRef.current && !mapReadyFired.current) {
        mapReadyFired.current = true;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => onMapReadyRef.current?.());
        });
      }
      setMapReady(true);
    })();

    return () => {
      cancelled = true;
      isNativeInitializedRef.current = false;
      void Promise.all(
        listenersRef.current.map((l) => l.remove())
      ).catch(() => {});
      listenersRef.current = [];
      void BarFestNativeMap.destroy();
      setMapReady(false);
      mapReadyFired.current = false;
    };
  }, []);

  // Keep the native map sized/positioned to the map container (document scroll + resize).
  useEffect(() => {
    let rafId: number | null = null;

    const syncFrame = () => {
      if (!isNativeInitializedRef.current) return;
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const frame = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
      void BarFestNativeMap.setFrame(frame)
        .then(() => {
          if (!mapDebugEnabled) return;
          syncCountRef.current += 1;
          setDebugInfo((prev) => ({
            ...prev,
            syncCount: syncCountRef.current,
            scrollY: window.scrollY,
            containerRect: frame,
            sentFrame: frame,
            lastSyncMs: Date.now(),
            lastError: null,
          }));
        })
        .catch((e) => {
          if (!mapDebugEnabled) return;
          setDebugInfo((prev) => ({
            ...prev,
            lastError: e instanceof Error ? e.message : "setFrame failed",
          }));
        });
    };

    const onScrollOrResize = () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        syncFrame();
      });
    };

    window.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, []);

  useEffect(() => {
    if (!mapDebugEnabled) return;
    if (!isNativeInitializedRef.current) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const state = await BarFestNativeMap.getDebugState();
        if (cancelled) return;
        setDebugInfo((prev) => ({
          ...prev,
          nativeState: state,
          lastError: null,
        }));
      } catch (e) {
        if (cancelled) return;
        setDebugInfo((prev) => ({
          ...prev,
          lastError: e instanceof Error ? e.message : "getDebugState failed",
        }));
      }
    };

    void poll();
    const id = window.setInterval(() => {
      void poll();
    }, 700);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [mapDebugEnabled, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    if (activeCheckIns.length === 0) return;
    if (restoredRegionRef.current) {
      restoredRegionRef.current = false;
      return;
    }
    const venueCounts: Record<string, number> = {};
    activeCheckIns.forEach((checkIn) => {
      venueCounts[checkIn.venue] = (venueCounts[checkIn.venue] || 0) + 1;
    });
    const maxCount = Math.max(...Object.values(venueCounts));
    const topVenues = OHIO_STATE_VENUES.filter(
      (v) => venueCounts[v.name] === maxCount
    );
    if (topVenues.length === 0) return;
    const venue = topVenues[Math.floor(Math.random() * topVenues.length)];
    void BarFestNativeMap.setRegion({
      centerLat: venue.coordinates[0],
      centerLon: venue.coordinates[1],
      spanLat: 0.04,
      spanLon: 0.04,
    });
  }, [selectedDate, selectedTime, activeCheckIns, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    void BarFestNativeMap.setUserCoordinate(
      userLocation
        ? { lat: userLocation.latitude, lon: userLocation.longitude }
        : { lat: null, lon: null }
    );
  }, [userLocation, mapReady]);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none relative h-full w-full min-h-[300px]"
    >
      {popupInfo && (
        <div className="pointer-events-auto absolute left-1/2 top-4 z-20 w-[90%] max-w-sm -translate-x-1/2 rounded-lg border border-gray-200 bg-white p-5 shadow-lg">
          <button
            type="button"
            className="absolute right-2 top-2 text-gray-400 hover:text-gray-600"
            aria-label="Close"
            onClick={() => setPopupInfo(null)}
          >
            ×
          </button>
          <h3 className="mb-2 pr-6 text-xl font-bold text-gray-900">
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
      )}

      {mapDebugEnabled && (
        <div className="pointer-events-auto absolute bottom-4 left-2 right-2 z-30 rounded-md bg-black/75 p-2 text-[10px] leading-tight text-white">
          <pre className="whitespace-pre-wrap">
            {JSON.stringify(debugInfo, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
