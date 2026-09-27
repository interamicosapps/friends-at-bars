import { useCallback, useEffect, useRef, useState } from "react";
import { CatalogGeography, CatalogVenue, supabase } from "./supabase";
import { loadMapKit } from "./mapkitLoader";
import {
  DEFAULT_FOOTPRINT_HALF_M,
  FOOTPRINT_CORNER_LABELS,
  defaultVenueFootprint,
  normalizeFootprint,
  type LatLng,
} from "./venueFootprint";

/** OSU North Campus default — matches main app MapKit region. */
const DEFAULT_CENTER = { lat: 39.9917, lon: -83.0067 };
const DEFAULT_SPAN = { lat: 0.06, lon: 0.06 };

const VENUE_COLOR = "#2563eb";
const TEST_VENUE_COLOR = "#16a34a";
const PLACE_PIN_COLOR = "#dc2626";
const GEO_PIN_COLOR = "#7c3aed";
const GEO_CIRCLE_COLOR = "#7c3aed";
const FOOTPRINT_COLOR = "#2563eb";
const CORNER_COLOR = "#ea580c";

const MILES_TO_METERS = 1609.344;

const LOG_PREFIX = "[CMS Map]";

function mapLog(...args: unknown[]) {
  console.log(LOG_PREFIX, ...args);
}

function mapWarn(...args: unknown[]) {
  console.warn(LOG_PREFIX, ...args);
}

export type MapCoords = { latitude: number; longitude: number };

type MapPanelProps = {
  onStartVenue?: (coords: MapCoords) => void;
  onStartGeography?: (coords: MapCoords) => void;
};

type PlaceKind = "venue" | "geography";

function formatCoord(n: number) {
  return n.toFixed(6);
}

export function MapPanel({ onStartVenue, onStartGeography }: MapPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapkit.Map | null>(null);
  const placePinRef = useRef<mapkit.MarkerAnnotation | null>(null);
  const placingModeRef = useRef(false);
  const placeKindRef = useRef<PlaceKind>("venue");
  const geoOverlaysRef = useRef<mapkit.CircleOverlay[]>([]);
  const footprintOverlaysRef = useRef<mapkit.PolygonOverlay[]>([]);
  const venueAnnotationsRef = useRef<mapkit.MarkerAnnotation[]>([]);
  const cornerAnnotationsRef = useRef<mapkit.MarkerAnnotation[]>([]);
  const centerEditRef = useRef<mapkit.MarkerAnnotation | null>(null);
  const venuesRef = useRef<CatalogVenue[]>([]);
  const editingIdRef = useRef<string | null>(null);
  const pageGestureLockedRef = useRef(false);
  /** Custom pointer-drag target (MapKit built-in drag loses to map pan). */
  const activeDragRef = useRef<{
    marker: mapkit.MarkerAnnotation;
    kind: "edit-corner" | "edit-center";
    index?: number;
  } | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading map…");
  const [placingMode, setPlacingMode] = useState(false);
  const [placeKind, setPlaceKind] = useState<PlaceKind>("venue");
  const [pinCoords, setPinCoords] = useState<MapCoords | null>(null);
  const [copied, setCopied] = useState(false);
  const [showGeoBounds, setShowGeoBounds] = useState(false);
  const [showFootprints, setShowFootprints] = useState(true);
  const [geographies, setGeographies] = useState<CatalogGeography[]>([]);
  const [venues, setVenues] = useState<CatalogVenue[]>([]);
  const [editingVenueId, setEditingVenueId] = useState<string | null>(null);
  const [editCorners, setEditCorners] = useState<LatLng[] | null>(null);
  const [editCenter, setEditCenter] = useState<LatLng | null>(null);
  const [savingFootprint, setSavingFootprint] = useState(false);

  placingModeRef.current = placingMode;
  placeKindRef.current = placeKind;
  venuesRef.current = venues;
  editingIdRef.current = editingVenueId;

  const loadVenues = useCallback(async (): Promise<CatalogVenue[]> => {
    const { data, error: err } = await supabase
      .from("catalog_venues")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (err) throw err;
    return (data ?? []) as CatalogVenue[];
  }, []);

  const loadGeographies = useCallback(async (): Promise<CatalogGeography[]> => {
    const { data, error: err } = await supabase
      .from("catalog_geographies")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (err) {
      mapWarn("geographies load failed (run catalog_geographies.sql?)", err);
      return [];
    }
    return (data ?? []) as CatalogGeography[];
  }, []);

  const clearFootprintOverlays = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const overlay of footprintOverlaysRef.current) {
      try {
        map.removeOverlay(overlay);
      } catch {
        // ignore
      }
    }
    footprintOverlaysRef.current = [];
  }, []);

  const syncFootprintOverlays = useCallback(
    (list: CatalogVenue[], visible: boolean, skipId?: string | null) => {
      const map = mapRef.current;
      if (!map) return;
      clearFootprintOverlays();
      if (!visible) return;
      for (const venue of list) {
        if (skipId && venue.id === skipId) continue;
        const corners = normalizeFootprint(
          venue.footprint,
          venue.latitude,
          venue.longitude
        );
        const points = corners.map(
          (c) => new mapkit.Coordinate(c.lat, c.lng)
        );
        const overlay = new mapkit.PolygonOverlay(points, {
          enabled: false,
          style: new mapkit.Style({
            strokeColor: venue.is_test ? TEST_VENUE_COLOR : FOOTPRINT_COLOR,
            strokeOpacity: 0.85,
            lineWidth: 2,
            fillColor: venue.is_test ? TEST_VENUE_COLOR : FOOTPRINT_COLOR,
            fillOpacity: 0.12,
          }),
        });
        map.addOverlay(overlay);
        footprintOverlaysRef.current.push(overlay);
      }
    },
    [clearFootprintOverlays]
  );

  const clearCornerEditors = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const ann of cornerAnnotationsRef.current) {
      try {
        map.removeAnnotation(ann);
      } catch {
        // ignore
      }
    }
    cornerAnnotationsRef.current = [];
    if (centerEditRef.current) {
      try {
        map.removeAnnotation(centerEditRef.current);
      } catch {
        // ignore
      }
      centerEditRef.current = null;
    }
  }, []);

  const syncGeoOverlays = useCallback(
    (geos: CatalogGeography[], visible: boolean) => {
      const map = mapRef.current;
      if (!map) return;
      for (const overlay of geoOverlaysRef.current) {
        try {
          map.removeOverlay(overlay);
        } catch {
          // ignore
        }
      }
      geoOverlaysRef.current = [];
      if (!visible) return;
      for (const geo of geos) {
        const overlay = new mapkit.CircleOverlay(
          new mapkit.Coordinate(geo.latitude, geo.longitude),
          geo.radius_miles * MILES_TO_METERS,
          {
            style: new mapkit.Style({
              strokeColor: GEO_CIRCLE_COLOR,
              strokeOpacity: 0.9,
              lineWidth: 2,
              fillColor: GEO_CIRCLE_COLOR,
              fillOpacity: 0.12,
            }),
          }
        );
        map.addOverlay(overlay);
        geoOverlaysRef.current.push(overlay);
      }
    },
    []
  );

  const syncPinFromAnnotation = useCallback((ann: mapkit.MarkerAnnotation) => {
    const c = ann.coordinate;
    const next = { latitude: c.latitude, longitude: c.longitude };
    mapLog("syncPinFromAnnotation", next);
    setPinCoords(next);
  }, []);

  const placeOrMovePinRef = useRef<(lat: number, lon: number) => void>(
    () => undefined
  );

  placeOrMovePinRef.current = (latitude: number, longitude: number) => {
    mapLog("placeOrMovePin called", { latitude, longitude });
    const map = mapRef.current;
    if (!map) {
      mapWarn("placeOrMovePin aborted: mapRef is null");
      return;
    }

    const existing = placePinRef.current;
    if (existing) {
      mapLog("moving existing place pin");
      existing.coordinate = new mapkit.Coordinate(latitude, longitude);
      syncPinFromAnnotation(existing);
      setPlacingMode(false);
      return;
    }

    try {
      const marker = new mapkit.MarkerAnnotation(
        new mapkit.Coordinate(latitude, longitude),
        {
          title:
            placeKindRef.current === "geography"
              ? "Geography center"
              : "Drop pin",
          color:
            placeKindRef.current === "geography"
              ? GEO_PIN_COLOR
              : PLACE_PIN_COLOR,
          draggable: true,
        }
      );
      marker.data = { kind: "place-pin" };
      marker.addEventListener("drag-end", () => {
        syncPinFromAnnotation(marker);
      });
      map.addAnnotation(marker);
      placePinRef.current = marker;
      syncPinFromAnnotation(marker);
      setPlacingMode(false);
    } catch (e) {
      mapWarn("failed to create/add place pin", e);
    }
  };

  const removePlacePin = useCallback(() => {
    const map = mapRef.current;
    const pin = placePinRef.current;
    if (map && pin) {
      try {
        map.removeAnnotation(pin);
      } catch (e) {
        mapWarn("removeAnnotation failed", e);
      }
    }
    placePinRef.current = null;
    setPinCoords(null);
    setCopied(false);
  }, []);

  const setVenuePinsInteractive = useCallback((interactive: boolean) => {
    for (const ann of venueAnnotationsRef.current) {
      ann.enabled = interactive;
    }
  }, []);

  const setMapPanEnabled = useCallback((enabled: boolean) => {
    const map = mapRef.current;
    if (!map) return;
    map.isScrollEnabled = enabled;
  }, []);

  const lockPageGesture = useCallback(() => {
    if (pageGestureLockedRef.current) return;
    pageGestureLockedRef.current = true;
    const html = document.documentElement;
    const body = document.body;
    html.dataset.bfOverflow = html.style.overflow;
    body.dataset.bfOverflow = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    body.style.overscrollBehavior = "none";
    const mapEl = mapRef.current?.element;
    if (mapEl) {
      mapEl.style.touchAction = "none";
      mapEl.style.overscrollBehavior = "none";
    }
  }, []);

  const unlockPageGesture = useCallback(() => {
    if (!pageGestureLockedRef.current) return;
    pageGestureLockedRef.current = false;
    const html = document.documentElement;
    const body = document.body;
    html.style.overflow = html.dataset.bfOverflow ?? "";
    body.style.overflow = body.dataset.bfOverflow ?? "";
    delete html.dataset.bfOverflow;
    delete body.dataset.bfOverflow;
    html.style.overscrollBehavior = "";
    body.style.overscrollBehavior = "";
    const mapEl = mapRef.current?.element;
    if (mapEl) {
      mapEl.style.touchAction = "";
      mapEl.style.overscrollBehavior = "";
    }
  }, []);

  const stopFootprintEdit = useCallback(() => {
    activeDragRef.current = null;
    clearCornerEditors();
    setEditingVenueId(null);
    setEditCorners(null);
    setEditCenter(null);
    setVenuePinsInteractive(true);
    setMapPanEnabled(true);
    unlockPageGesture();
    syncFootprintOverlays(venuesRef.current, showFootprints, null);
  }, [
    clearCornerEditors,
    showFootprints,
    syncFootprintOverlays,
    setVenuePinsInteractive,
    setMapPanEnabled,
    unlockPageGesture,
  ]);

  const beginFootprintEdit = useCallback(
    (venue: CatalogVenue) => {
      const map = mapRef.current;
      if (!map) return;
      activeDragRef.current = null;
      clearCornerEditors();
      setPlacingMode(false);
      removePlacePin();
      setVenuePinsInteractive(false);
      // Lock map pan for the edit session; vertices are moved via pointer handlers.
      map.isScrollEnabled = false;
      lockPageGesture();

      const corners = normalizeFootprint(
        venue.footprint,
        venue.latitude,
        venue.longitude
      );
      const center = { lat: venue.latitude, lng: venue.longitude };
      setEditingVenueId(venue.id);
      setEditCorners(corners);
      setEditCenter(center);
      syncFootprintOverlays(venuesRef.current, showFootprints, venue.id);

      // draggable:false — we drive coordinates ourselves so map pan cannot win.
      const handleOpts = {
        draggable: false,
        enabled: true,
        displayPriority: 1000,
        calloutEnabled: false,
        animates: false,
      } as const;

      const centerMarker = new mapkit.MarkerAnnotation(
        new mapkit.Coordinate(center.lat, center.lng),
        {
          ...handleOpts,
          title: `${venue.name} center`,
          color: PLACE_PIN_COLOR,
        }
      );
      centerMarker.data = { kind: "edit-center", venueId: venue.id };
      map.addAnnotation(centerMarker);
      centerEditRef.current = centerMarker;

      corners.forEach((corner, index) => {
        const marker = new mapkit.MarkerAnnotation(
          new mapkit.Coordinate(corner.lat, corner.lng),
          {
            ...handleOpts,
            title: FOOTPRINT_CORNER_LABELS[index] ?? `C${index + 1}`,
            color: CORNER_COLOR,
            glyphText: FOOTPRINT_CORNER_LABELS[index] ?? `${index + 1}`,
          }
        );
        marker.data = { kind: "edit-corner", index, venueId: venue.id };
        map.addAnnotation(marker);
        cornerAnnotationsRef.current.push(marker);
      });

      setStatus(`Editing footprint — ${venue.name} (map pan locked)`);
    },
    [
      clearCornerEditors,
      removePlacePin,
      showFootprints,
      syncFootprintOverlays,
      setVenuePinsInteractive,
      lockPageGesture,
    ]
  );

  async function saveFootprintEdit() {
    if (!editingVenueId || !editCorners || !editCenter) return;
    setSavingFootprint(true);
    setError(null);
    const { error: err } = await supabase
      .from("catalog_venues")
      .update({
        latitude: editCenter.lat,
        longitude: editCenter.lng,
        footprint: editCorners,
      })
      .eq("id", editingVenueId);
    setSavingFootprint(false);
    if (err) {
      setError(err.message);
      return;
    }
    const refreshed = await loadVenues();
    setVenues(refreshed);
    venuesRef.current = refreshed;
    stopFootprintEdit();
    const map = mapRef.current;
    if (map) {
      for (const ann of venueAnnotationsRef.current) {
        try {
          map.removeAnnotation(ann);
        } catch {
          // ignore
        }
      }
      venueAnnotationsRef.current = [];
      for (const venue of refreshed) {
        const marker = new mapkit.MarkerAnnotation(
          new mapkit.Coordinate(venue.latitude, venue.longitude),
          {
            title: venue.name,
            subtitle: "Tap to edit footprint",
            color: venue.is_test ? TEST_VENUE_COLOR : VENUE_COLOR,
          }
        );
        marker.data = { kind: "venue", id: venue.id };
        marker.addEventListener("select", () => {
          const match = venuesRef.current.find((v) => v.id === venue.id);
          if (match) beginFootprintEdit(match);
        });
        map.addAnnotation(marker);
        venueAnnotationsRef.current.push(marker);
      }
      syncFootprintOverlays(refreshed, showFootprints, null);
    }
    setStatus(
      `${refreshed.length} active venue${refreshed.length === 1 ? "" : "s"}`
    );
  }

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let destroyed = false;
    let onSingleTap: ((event: mapkit.MapEvent) => void) | null = null;

    (async () => {
      try {
        await loadMapKit();
        if (destroyed || !el) return;

        const map = new mapkit.Map(el, {
          region: new mapkit.CoordinateRegion(
            new mapkit.Coordinate(DEFAULT_CENTER.lat, DEFAULT_CENTER.lon),
            new mapkit.CoordinateSpan(DEFAULT_SPAN.lat, DEFAULT_SPAN.lon)
          ),
        });
        mapRef.current = map;

        const pagePoint = (e: PointerEvent) => new DOMPoint(e.clientX, e.clientY);

        const findEditHandleAtPoint = (e: PointerEvent) => {
          if (!editingIdRef.current) return null;
          const point = pagePoint(e);
          let hits: mapkit.Annotation[] = [];
          try {
            if (typeof map.annotationsAtPoint === "function") {
              hits = map.annotationsAtPoint(point) ?? [];
            }
          } catch {
            hits = [];
          }

          const fromHits = hits.find((ann) => {
            const kind = (ann.data as { kind?: string } | undefined)?.kind;
            return kind === "edit-corner" || kind === "edit-center";
          }) as mapkit.MarkerAnnotation | undefined;
          if (fromHits) return fromHits;

          // Fallback: nearest handle within ~36px of the pointer.
          if (typeof map.convertCoordinateToPointOnPage !== "function") {
            return null;
          }
          const candidates: mapkit.MarkerAnnotation[] = [
            ...cornerAnnotationsRef.current,
            ...(centerEditRef.current ? [centerEditRef.current] : []),
          ];
          let best: mapkit.MarkerAnnotation | null = null;
          let bestDist = 36;
          for (const ann of candidates) {
            try {
              const p = map.convertCoordinateToPointOnPage(ann.coordinate);
              const dx = p.x - e.clientX;
              const dy = p.y - e.clientY;
              const d = Math.hypot(dx, dy);
              if (d < bestDist) {
                bestDist = d;
                best = ann;
              }
            } catch {
              // ignore
            }
          }
          return best;
        };

        const onPointerDown = (e: PointerEvent) => {
          if (!editingIdRef.current) return;
          if (e.button !== 0) return;
          const handle = findEditHandleAtPoint(e);
          if (!handle) return;
          const data = handle.data as {
            kind?: string;
            index?: number;
          };
          if (data.kind !== "edit-corner" && data.kind !== "edit-center") return;

          e.preventDefault();
          e.stopPropagation();
          map.isScrollEnabled = false;
          try {
            (e.target as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
          } catch {
            // ignore
          }
          activeDragRef.current = {
            marker: handle,
            kind: data.kind,
            index: data.index,
          };
          try {
            map.selectedAnnotation = handle;
          } catch {
            // ignore
          }
        };

        const onPointerMove = (e: PointerEvent) => {
          const active = activeDragRef.current;
          if (!active) return;
          e.preventDefault();
          try {
            const coord = map.convertPointOnPageToCoordinate(pagePoint(e));
            active.marker.coordinate = coord;
            // Live-update polygon preview without waiting for pointerup.
            if (active.kind === "edit-center") {
              setEditCenter({ lat: coord.latitude, lng: coord.longitude });
            } else if (typeof active.index === "number") {
              const idx = active.index;
              setEditCorners((prev) => {
                if (!prev) return prev;
                return prev.map((p, i) =>
                  i === idx
                    ? { lat: coord.latitude, lng: coord.longitude }
                    : p
                );
              });
            }
          } catch (err) {
            mapWarn("pointermove coordinate convert failed", err);
          }
        };

        const onPointerUp = (e: PointerEvent) => {
          const active = activeDragRef.current;
          if (!active) return;
          activeDragRef.current = null;
          map.isScrollEnabled = false;
          try {
            (e.target as HTMLElement | null)?.releasePointerCapture?.(
              e.pointerId
            );
          } catch {
            // ignore
          }
          const c = active.marker.coordinate;
          if (active.kind === "edit-center") {
            setEditCenter({ lat: c.latitude, lng: c.longitude });
          } else if (typeof active.index === "number") {
            const idx = active.index;
            setEditCorners((prev) => {
              if (!prev) return prev;
              return prev.map((p, i) =>
                i === idx ? { lat: c.latitude, lng: c.longitude } : p
              );
            });
          }
        };

        const mapEl = map.element ?? el;
        const onTouchMove = (e: TouchEvent) => {
          if (!editingIdRef.current) return;
          e.preventDefault();
        };
        mapEl.addEventListener("pointerdown", onPointerDown, {
          capture: true,
        });
        mapEl.addEventListener("touchmove", onTouchMove, { passive: false });
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", onPointerUp);

        onSingleTap = (event) => {
          if (editingIdRef.current) return;
          const placing = placingModeRef.current;
          if (!placing) return;

          let latitude: number | null = null;
          let longitude: number | null = null;
          const point = event.pointOnPage;

          if (
            point &&
            typeof map.convertPointOnPageToCoordinate === "function"
          ) {
            try {
              const converted = map.convertPointOnPageToCoordinate(point);
              latitude = converted.latitude;
              longitude = converted.longitude;
            } catch (err) {
              mapWarn("convertPointOnPageToCoordinate failed", err);
            }
          } else if (event.coordinate) {
            latitude = event.coordinate.latitude;
            longitude = event.coordinate.longitude;
          }

          if (latitude == null || longitude == null) return;
          placeOrMovePinRef.current(latitude, longitude);
        };
        map.addEventListener("single-tap", onSingleTap);

        const loadedVenues = await loadVenues();
        const geos = await loadGeographies();
        if (destroyed) return;

        setGeographies(geos);
        setVenues(loadedVenues);
        venuesRef.current = loadedVenues;

        for (const venue of loadedVenues) {
          const marker = new mapkit.MarkerAnnotation(
            new mapkit.Coordinate(venue.latitude, venue.longitude),
            {
              title: venue.name,
              subtitle: "Tap to edit footprint",
              color: venue.is_test ? TEST_VENUE_COLOR : VENUE_COLOR,
            }
          );
          marker.data = { kind: "venue", id: venue.id };
          marker.addEventListener("select", () => {
            const match = venuesRef.current.find((v) => v.id === venue.id);
            if (match) beginFootprintEdit(match);
          });
          map.addAnnotation(marker);
          venueAnnotationsRef.current.push(marker);
        }

        setStatus(
          loadedVenues.length
            ? `${loadedVenues.length} active venue${loadedVenues.length === 1 ? "" : "s"}`
            : "No active venues"
        );
        setError(null);
        if (showGeoBounds) syncGeoOverlays(geos, true);
        if (showFootprints) syncFootprintOverlays(loadedVenues, true, null);

        // Stash cleanup for pointer listeners on the map element.
        (
          map as mapkit.Map & {
            __bfPointerCleanup?: () => void;
          }
        ).__bfPointerCleanup = () => {
          mapEl.removeEventListener("pointerdown", onPointerDown, true);
          mapEl.removeEventListener("touchmove", onTouchMove);
          window.removeEventListener("pointermove", onPointerMove);
          window.removeEventListener("pointerup", onPointerUp);
          window.removeEventListener("pointercancel", onPointerUp);
          unlockPageGesture();
        };
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "MapKit JS failed to load";
        mapWarn("map init failed", e);
        setError(message);
        setStatus("");
      }
    })();

    return () => {
      destroyed = true;
      const map = mapRef.current as
        | (mapkit.Map & { __bfPointerCleanup?: () => void })
        | null;
      if (map?.__bfPointerCleanup) {
        try {
          map.__bfPointerCleanup();
        } catch {
          // ignore
        }
      }
      if (map && onSingleTap) {
        try {
          map.removeEventListener("single-tap", onSingleTap);
        } catch {
          // ignore
        }
      }
      placePinRef.current = null;
      mapRef.current = null;
      if (map) {
        try {
          map.destroy();
        } catch {
          // ignore
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once
  }, []);

  useEffect(() => {
    syncGeoOverlays(geographies, showGeoBounds);
  }, [geographies, showGeoBounds, syncGeoOverlays]);

  useEffect(() => {
    if (editingVenueId) return;
    syncFootprintOverlays(venues, showFootprints, null);
  }, [venues, showFootprints, editingVenueId, syncFootprintOverlays]);

  // Live preview polygon while editing corners.
  useEffect(() => {
    if (!editingVenueId || !editCorners) return;
    const map = mapRef.current;
    if (!map) return;
    clearFootprintOverlays();
    syncFootprintOverlays(venues, showFootprints, editingVenueId);
    const points = editCorners.map((c) => new mapkit.Coordinate(c.lat, c.lng));
    const overlay = new mapkit.PolygonOverlay(points, {
      enabled: false,
      style: new mapkit.Style({
        strokeColor: CORNER_COLOR,
        strokeOpacity: 1,
        lineWidth: 2,
        fillColor: CORNER_COLOR,
        fillOpacity: 0.18,
      }),
    });
    map.addOverlay(overlay);
    footprintOverlaysRef.current.push(overlay);
  }, [
    editingVenueId,
    editCorners,
    venues,
    showFootprints,
    clearFootprintOverlays,
    syncFootprintOverlays,
  ]);

  const coordsText = pinCoords
    ? `${formatCoord(pinCoords.latitude)}, ${formatCoord(pinCoords.longitude)}`
    : "";

  async function copyCoords() {
    if (!coordsText) return;
    try {
      await navigator.clipboard.writeText(coordsText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      const input = document.getElementById(
        "map-pin-coords"
      ) as HTMLInputElement | null;
      input?.select();
    }
  }

  const editingVenue = venues.find((v) => v.id === editingVenueId) ?? null;

  return (
    <div
      className={`map-panel-root${editingVenue ? " is-editing-footprint" : ""}`}
    >
      <div className="map-toolbar">
        {(error || status) && (
          <div className={`map-banner-inline ${error ? "error" : "muted"}`}>
            {error ? (
              <>
                {error}
                {error.includes("VITE_MAPKIT_TOKEN") && (
                  <>
                    {" "}
                    Set <code>VITE_MAPKIT_TOKEN</code> in{" "}
                    <code>admin-cms/.env.local</code> (and Vercel).
                  </>
                )}
              </>
            ) : (
              status
            )}
          </div>
        )}

        {editingVenue ? (
          <div className="map-toolbar-actions">
            <button
              type="button"
              className="btn-primary"
              disabled={savingFootprint}
              onClick={() => void saveFootprintEdit()}
            >
              {savingFootprint ? "Saving…" : "Save footprint"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!editCenter) return;
                const next = defaultVenueFootprint(
                  editCenter.lat,
                  editCenter.lng,
                  DEFAULT_FOOTPRINT_HALF_M
                );
                setEditCorners(next);
                cornerAnnotationsRef.current.forEach((ann, index) => {
                  const p = next[index];
                  if (p) {
                    ann.coordinate = new mapkit.Coordinate(p.lat, p.lng);
                  }
                });
              }}
            >
              Reset {DEFAULT_FOOTPRINT_HALF_M}m
            </button>
            <button type="button" className="danger" onClick={stopFootprintEdit}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="map-toolbar-actions">
            <button
              type="button"
              className={placingMode && placeKind === "venue" ? "active" : ""}
              onClick={() => {
                setPlaceKind("venue");
                setPlacingMode((v) => !(v && placeKind === "venue"));
              }}
              disabled={!!error}
              title="Place a bar pin"
            >
              {pinCoords && placeKind === "venue" ? "Move bar" : "Place bar"}
            </button>
            <button
              type="button"
              className={
                placingMode && placeKind === "geography" ? "active" : ""
              }
              onClick={() => {
                setPlaceKind("geography");
                setPlacingMode((v) => !(v && placeKind === "geography"));
              }}
              disabled={!!error}
              title="Place a geography center"
            >
              {pinCoords && placeKind === "geography"
                ? "Move geography"
                : "Place geography"}
            </button>
            <button
              type="button"
              className={showFootprints ? "active" : ""}
              onClick={() => setShowFootprints((v) => !v)}
              disabled={!!error}
              title="Show venue footprint polygons"
            >
              Footprints
            </button>
            <button
              type="button"
              className={showGeoBounds ? "active" : ""}
              onClick={() => setShowGeoBounds((v) => !v)}
              disabled={!!error}
              title="Show geography radius circles"
            >
              Geographies
            </button>
            {pinCoords && (
              <>
                <button
                  type="button"
                  className="danger"
                  onClick={removePlacePin}
                  title="Remove pin"
                >
                  Remove
                </button>
                {placeKind === "geography" ? (
                  <button
                    type="button"
                    onClick={() => onStartGeography?.(pinCoords)}
                    disabled={!onStartGeography}
                    title="Start geography from pin"
                  >
                    Start geography
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onStartVenue?.(pinCoords)}
                    disabled={!onStartVenue}
                    title="Start venue from pin"
                  >
                    Start venue
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {pinCoords && !editingVenue && (
          <label className="map-coords-field">
            Lat, lng
            <div className="map-coords-row">
              <input
                id="map-pin-coords"
                type="text"
                readOnly
                value={coordsText}
                onFocus={(e) => e.target.select()}
              />
              <button type="button" onClick={() => void copyCoords()}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </label>
        )}

        {editingVenue && (
          <div className="map-banner-inline muted">
            Map pan is locked. Drag orange corners or the red center, then Save.
            Cancel restores panning.
          </div>
        )}
      </div>

      <div ref={containerRef} className="map-fill" />
    </div>
  );
}
