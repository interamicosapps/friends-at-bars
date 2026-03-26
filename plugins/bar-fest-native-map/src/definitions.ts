export interface RegionPayload {
  centerLat: number;
  centerLon: number;
  spanLat: number;
  spanLon: number;
}

export interface VenuePayload {
  name: string;
  lat: number;
  lon: number;
}

export interface FramePayload {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface BarFestNativeMapPlugin {
  initialize(options: RegionPayload): Promise<void>;
  setRegion(options: RegionPayload): Promise<void>;
  setVenues(options: { venues: VenuePayload[] }): Promise<void>;
  setUserCoordinate(options: { lat: number | null; lon: number | null }): Promise<void>;
  setFrame(options: FramePayload): Promise<void>;
  destroy(): Promise<void>;
  addListener(
    eventName: "venueTap" | "regionChanged",
    listenerFunc: (data: {
      venueName?: string;
      centerLat?: number;
      centerLon?: number;
      spanLat?: number;
      spanLon?: number;
    }) => void
  ): Promise<{ remove: () => Promise<void> }>;
}
