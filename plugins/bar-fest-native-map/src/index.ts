import { registerPlugin } from "@capacitor/core";
import type { BarFestNativeMapPlugin } from "./definitions";

const BarFestNativeMap = registerPlugin<BarFestNativeMapPlugin>(
  "BarFestNativeMap",
  {
    web: () =>
      import("./web").then((m) => new m.BarFestNativeMapWeb()),
  }
);

export * from "./definitions";
export { BarFestNativeMap };
