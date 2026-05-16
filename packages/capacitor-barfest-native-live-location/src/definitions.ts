export interface NativeVenueConfig {
  name: string;
  area: string;
  coordinates: [number, number];
}

export interface ConfigureOptions {
  supabaseUrl: string;
  supabaseAnonKey: string;
  userId: string;
  venues: NativeVenueConfig[];
  /** Optional pre-serialized venues; preferred on iOS bridge for reliable parsing. */
  venuesJson?: string;
  heartbeatMs: number;
  pollIntervalMs: number;
  venueRadiusMeters: number;
  skipSupabase?: boolean;
}

export interface NativeTrackingState {
  isRunning: boolean;
  lastVenue: string | null;
  lastWriteAtMs: number;
}

export interface LocationUpdateEvent {
  latitude: number;
  longitude: number;
}

export interface WriteErrorEvent {
  message: string;
}

export interface BarFestNativeLiveLocationPlugin {
  configure(options: ConfigureOptions): Promise<void>;
  startTracking(): Promise<void>;
  stopTracking(): Promise<void>;
  getState(): Promise<NativeTrackingState>;
  addListener(
    eventName: "locationUpdate",
    listenerFunc: (event: LocationUpdateEvent) => void
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    eventName: "writeError",
    listenerFunc: (event: WriteErrorEvent) => void
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    eventName: "authorizationLost",
    listenerFunc: () => void
  ): Promise<{ remove: () => Promise<void> }>;
  removeAllListeners(): Promise<void>;
}
