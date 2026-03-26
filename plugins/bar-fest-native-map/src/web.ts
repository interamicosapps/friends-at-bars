import { WebPlugin } from "@capacitor/core";
import type { BarFestNativeMapPlugin, FramePayload, RegionPayload, VenuePayload } from "./definitions";

export class BarFestNativeMapWeb extends WebPlugin implements BarFestNativeMapPlugin {
  async initialize(_options: RegionPayload): Promise<void> {
    console.warn("BarFestNativeMap is only available on native iOS.");
  }
  async setRegion(_options: RegionPayload): Promise<void> {}
  async setVenues(_options: { venues: VenuePayload[] }): Promise<void> {}
  async setUserCoordinate(_options: {
    lat: number | null;
    lon: number | null;
  }): Promise<void> {}
  async setFrame(_options: FramePayload): Promise<void> {}
  async destroy(): Promise<void> {}
}
