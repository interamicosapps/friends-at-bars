import { useRef, useState, type ReactNode } from "react";
import LocationToggle from "@/components/LocationToggle";
import { liveLocLog, liveLocLogThrottle } from "@/lib/liveLocationDebug";
import {
  LocationTrackingContext,
  type MapUserLocation,
  type LocationToggleRef,
} from "@/contexts/locationTrackingContext";

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
