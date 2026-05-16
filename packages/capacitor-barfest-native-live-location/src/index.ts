import { registerPlugin } from "@capacitor/core";
import type { BarFestNativeLiveLocationPlugin } from "./definitions";

const BarFestNativeLiveLocation =
  registerPlugin<BarFestNativeLiveLocationPlugin>("BarFestNativeLiveLocation", {
    web: () => import("./web").then((m) => new m.BarFestNativeLiveLocationWeb()),
  });

export * from "./definitions";
export { BarFestNativeLiveLocation };
