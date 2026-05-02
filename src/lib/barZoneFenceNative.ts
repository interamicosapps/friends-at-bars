import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { BAR_ZONE_CENTER, BAR_ZONE_RADIUS_METERS } from "@/constants/barZoneFence";
import { BarZoneFence } from "@/plugins/barZoneFence";
import { locationService } from "@/lib/locationService";

let monitoring = false;
let listenersBound = false;

async function refreshLocationApproximate(): Promise<void> {
  try {
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 15_000,
    });
    const { latitude, longitude, accuracy } = pos.coords;
    await locationService.updateLiveLocation({
      latitude,
      longitude,
      accuracy: accuracy ?? 0,
    });
  } catch {
    /* ignore */
  }
}

export async function ensureBarZoneFenceMonitoring(): Promise<void> {
  if (monitoring) return;
  if (Capacitor.getPlatform() !== "ios") return;
  if (!listenersBound) {
    listenersBound = true;
    void BarZoneFence.addListener("barZoneEnter", () => {
      void refreshLocationApproximate();
    });
    void BarZoneFence.addListener("barZoneExit", () => {
      void refreshLocationApproximate();
    });
  }
  await BarZoneFence.startMonitoring({
    latitude: BAR_ZONE_CENTER.latitude,
    longitude: BAR_ZONE_CENTER.longitude,
    radiusMeters: BAR_ZONE_RADIUS_METERS,
  });
  monitoring = true;
}

export async function stopBarZoneFenceMonitoring(): Promise<void> {
  if (Capacitor.getPlatform() !== "ios") return;
  monitoring = false;
  try {
    await BarZoneFence.removeAllListeners();
  } catch {
    /* ignore */
  }
  listenersBound = false;
  await BarZoneFence.stopMonitoring().catch(() => {});
}
