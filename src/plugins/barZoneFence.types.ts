import type { PluginListenerHandle } from "@capacitor/core";

export interface BarZoneFenceStartOptions {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export interface BarZoneFencePluginContract {
  startMonitoring(opts: BarZoneFenceStartOptions): Promise<void>;
  stopMonitoring(): Promise<void>;
  removeAllListeners(): Promise<void>;
  addListener(
    eventName: "barZoneEnter",
    listener: () => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "barZoneExit",
    listener: () => void
  ): Promise<PluginListenerHandle>;
}
