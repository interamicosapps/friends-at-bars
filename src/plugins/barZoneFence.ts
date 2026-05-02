import { registerPlugin } from "@capacitor/core";
import type { BarZoneFencePluginContract } from "@/plugins/barZoneFence.types";
import { BarZoneFenceWeb } from "@/plugins/BarZoneFenceWeb";

export const BarZoneFence = registerPlugin<BarZoneFencePluginContract>(
  "BarZoneFence",
  {
    web: () => new BarZoneFenceWeb(),
  }
);
