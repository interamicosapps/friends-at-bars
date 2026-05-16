import { WebPlugin } from "@capacitor/core";
import type {
  BarFestNativeLiveLocationPlugin,
  ConfigureOptions,
  NativeTrackingState,
} from "./definitions";

export class BarFestNativeLiveLocationWeb
  extends WebPlugin
  implements BarFestNativeLiveLocationPlugin
{
  async configure(_options: ConfigureOptions): Promise<void> {
    return;
  }

  async startTracking(): Promise<void> {
    return;
  }

  async stopTracking(): Promise<void> {
    return;
  }

  async getState(): Promise<NativeTrackingState> {
    return { isRunning: false, lastVenue: null, lastWriteAtMs: 0 };
  }
}
