import { WebPlugin } from "@capacitor/core";
import type {
  BarFestNativeMapPlugin,
  FramePayload,
  NativeMapDebugState,
  RegionPayload,
  VenuePayload,
} from "./definitions";

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
  async getDebugState(): Promise<NativeMapDebugState> {
    return {
      mapFrameX: 0,
      mapFrameY: 0,
      mapFrameWidth: 0,
      mapFrameHeight: 0,
      webViewFrameX: 0,
      webViewFrameY: 0,
      webViewFrameWidth: 0,
      webViewFrameHeight: 0,
      webViewOffsetX: 0,
      webViewOffsetY: 0,
      rootViewWidth: 0,
      rootViewHeight: 0,
    };
  }
  async destroy(): Promise<void> {}
}
