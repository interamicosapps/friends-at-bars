import { useState, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import MapLocationPermissionPrompt from "@/components/MapLocationPermissionPrompt";
import {
  locationService,
  getLocationTrackingEnabled,
  isNativePlatform,
  openNativeAppLocationSettings,
} from "@/lib/locationService";
import { useLocationTrackingOutlet } from "@/contexts/LocationTrackingContext";

const LAUNCH_GATE_SKIPPED_KEY = "barfest_location_launch_gate_skipped";

function readLaunchSkipped(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  return sessionStorage.getItem(LAUNCH_GATE_SKIPPED_KEY) === "1";
}

function setLaunchSkipped(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(LAUNCH_GATE_SKIPPED_KEY, "1");
}

function useNativeSettingsShortcut(): boolean {
  if (!isNativePlatform) return false;
  const p = Capacitor.getPlatform();
  return p === "ios" || p === "android";
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
  const nativeSettingsShortcut = useNativeSettingsShortcut();

  useEffect(() => {
    let cancelled = false;

    const evaluate = async () => {
      const granted = await locationService.checkPermissions();
      if (cancelled) return;
      const skipped = readLaunchSkipped();
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
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    if (overlay !== "hidden") return;
    let cancelled = false;
    (async () => {
      const granted = await locationService.checkPermissions();
      if (cancelled || !granted) return;
      await locationToggleRef.current?.requestEnable();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- locationToggleRef is stable
  }, [overlay]);

  const handleAllow = async () => {
    setNativeSettingsError(null);
    setBusy(true);
    try {
      if (nativeSettingsShortcut) {
        const result = await openNativeAppLocationSettings();
        if (!result.ok) {
          setNativeSettingsError(result.displayText);
        }
        return;
      }
      await locationToggleRef.current?.requestEnable();
      const granted = await locationService.checkPermissions();
      const trackingOn = getLocationTrackingEnabled();
      if (granted && trackingOn) {
        setOverlay("hidden");
        setShowWebLocationHelp(false);
      } else {
        setShowWebLocationHelp(true);
      }
    } catch {
      if (!nativeSettingsShortcut) {
        setShowWebLocationHelp(true);
      }
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
