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
      {children}
      <div className="hidden" aria-hidden>
        <LocationToggle
          ref={locationToggleRef}
          variant="compact"
          onLocationUpdate={(loc) => setMapUserLocation(loc)}
        />
      </div>
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
