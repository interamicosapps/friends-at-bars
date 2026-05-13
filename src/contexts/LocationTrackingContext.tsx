import {
  createContext,
  useContext,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from "react";
import LocationToggle, {
  type LocationToggleRef,
} from "@/components/LocationToggle";
import { liveLocLog, liveLocLogThrottle } from "@/lib/liveLocationDebug";

export type MapUserLocation = { latitude: number; longitude: number } | null;

type LocationTrackingContextValue = {
  locationToggleRef: RefObject<LocationToggleRef | null>;
  mapUserLocation: MapUserLocation;
  setMapUserLocation: (loc: MapUserLocation) => void;
};

const LocationTrackingContext =
  createContext<LocationTrackingContextValue | null>(null);

export function LocationTrackingProvider({ children }: { children: ReactNode }) {
  const locationToggleRef = useRef<LocationToggleRef | null>(null);
  const [mapUserLocation, setMapUserLocation] = useState<MapUserLocation>(null);

  return (
    <LocationTrackingContext.Provider
      value={{
        locationToggleRef,
        mapUserLocation,
        setMapUserLocation,
      }}
    >
      <div className="hidden" aria-hidden>
        <LocationToggle
          ref={locationToggleRef}
          variant="compact"
          onLocationUpdate={(loc) => {
            if (loc) {
              liveLocLogThrottle(
                "hidden-toggle-map-user",
                15_000,
                "hidden LocationToggle → mapUserLocation",
                {
                  lat: Math.round(loc.latitude * 1e4) / 1e4,
                  lon: Math.round(loc.longitude * 1e4) / 1e4,
                }
              );
            } else {
              liveLocLog("hidden LocationToggle → mapUserLocation cleared", {});
            }
            setMapUserLocation(loc);
          }}
        />
      </div>
      {children}
    </LocationTrackingContext.Provider>
  );
}

export function useLocationTrackingOutlet(): LocationTrackingContextValue {
  const ctx = useContext(LocationTrackingContext);
  if (!ctx) {
    throw new Error("useLocationTrackingOutlet must be used within LocationTrackingProvider");
  }
  return ctx;
}
