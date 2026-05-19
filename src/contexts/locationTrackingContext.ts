import {
  createContext,
  useContext,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

export type MapUserLocation = { latitude: number; longitude: number } | null;

/** Imperative API for the hidden LocationToggle (avoid importing the component here). */
export interface LocationToggleRef {
  requestEnable: () => Promise<void>;
  restorePersistedTrackingIfNeeded: () => Promise<void>;
}

export type LocationTrackingContextValue = {
  locationToggleRef: RefObject<LocationToggleRef | null>;
  mapUserLocation: MapUserLocation;
  setMapUserLocation: Dispatch<SetStateAction<MapUserLocation>>;
};

export const LocationTrackingContext =
  createContext<LocationTrackingContextValue | null>(null);

export function useLocationTrackingOutlet(): LocationTrackingContextValue {
  const ctx = useContext(LocationTrackingContext);
  if (!ctx) {
    throw new Error(
      "useLocationTrackingOutlet must be used within LocationTrackingProvider"
    );
  }
  return ctx;
}
