import { WebPlugin } from "@capacitor/core";
import type { BarZoneFenceStartOptions } from "@/plugins/barZoneFence.types";

export class BarZoneFenceWeb extends WebPlugin {
  async startMonitoring(_opts: BarZoneFenceStartOptions): Promise<void> {
    /* no-op on web */
  }

  async stopMonitoring(): Promise<void> {}

  async removeAllListeners(): Promise<void> {
    await super.removeAllListeners();
  }
}
