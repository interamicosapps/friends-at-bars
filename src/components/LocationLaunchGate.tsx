import { useState, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import MapLocationPermissionPrompt from "@/components/MapLocationPermissionPrompt";
import {
  locationService,
  subscribeNativeAppResume,
} from "@/lib/locationService";
import {
  promptForLocationAndSyncLive,
  syncLiveLocationWithPermission,
} from "@/lib/ensureLiveLocationWhenPermitted";
import { useLocationTrackingOutlet } from "@/contexts/locationTrackingContext";

const LAUNCH_GATE_SKIPPED_KEY = "barfest_location_launch_gate_skipped";

function readLaunchSkipped(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  return sessionStorage.getItem(LAUNCH_GATE_SKIPPED_KEY) === "1";
}

function setLaunchSkipped(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(LAUNCH_GATE_SKIPPED_KEY, "1");
}

type LaunchOverlay = "checking" | "prompt" | "hidden";

/**
 * Full-screen location prompt on first load when permission is not granted,
 * until the user allows (system dialog / Settings) or skips (session only—map gates again).
 */
export default function LocationLaunchGate() {
  const { locationToggleRef } = useLocationTrackingOutlet();
  const [overlay, setOverlay] = useState<LaunchOverlay>("checking");
  const [busy, setBusy] = useState(false);
  const [showWebLocationHelp, setShowWebLocationHelp] = useState(false);
  const [nativeSettingsError, setNativeSettingsError] = useState<string | null>(
    null
  );
  const nativeSettingsShortcut =
    Capacitor.isNativePlatform() &&
    (Capacitor.getPlatform() === "ios" || Capacitor.getPlatform() === "android");

  useEffect(() => {
    let cancelled = false;

    const evaluate = async () => {
      const granted = await locationService.checkPermissions();
      if (cancelled) return;
      const skipped = readLaunchSkipped();
      if (granted) {
        await syncLiveLocationWithPermission(locationToggleRef.current);
      }
      if (cancelled) return;
      if (granted || skipped) {
        setOverlay("hidden");
        setShowWebLocationHelp(false);
        setNativeSettingsError(null);
      } else {
        setOverlay("prompt");
      }
    };

    void evaluate();
    const onFocus = () => {
      void evaluate();
    };
    window.addEventListener("focus", onFocus);
    const unsubResume = subscribeNativeAppResume(() => {
      void evaluate();
    });
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      unsubResume();
    };
  }, [locationToggleRef]);

  const handleAllow = async () => {
    setNativeSettingsError(null);
    setBusy(true);
    try {
      const { granted, tracking } = await promptForLocationAndSyncLive(
        locationToggleRef.current
      );
      if (granted && tracking) {
        setOverlay("hidden");
        setShowWebLocationHelp(false);
      } else if (granted) {
        setOverlay("hidden");
        setShowWebLocationHelp(true);
      } else {
        setShowWebLocationHelp(true);
      }
    } catch {
      setShowWebLocationHelp(true);
    } finally {
      setBusy(false);
    }
  };

  const handleSkip = () => {
    setLaunchSkipped();
    setOverlay("hidden");
    setShowWebLocationHelp(false);
    setNativeSettingsError(null);
  };

  const showPrompt = overlay === "prompt";

  return (
    <>
      {overlay === "checking" && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-zinc-950 text-sm text-zinc-400"
          style={{ paddingTop: "var(--safe-area-inset-top)" }}
          aria-busy="true"
          aria-label="Loading"
        >
          Loading…
        </div>
      )}
      <MapLocationPermissionPrompt
        open={showPrompt}
        variant="launch"
        onAllow={handleAllow}
        onSecondary={handleSkip}
        secondaryLabel="Skip"
        busy={busy}
        coverNav
        nativeSettingsNote={nativeSettingsShortcut}
        showWebLocationHelp={showWebLocationHelp}
        nativeSettingsError={nativeSettingsError}
      />
    </>
  );
}
