/**
 * Dev-only test UI (bottom bar “Test Mode” + “Log” + in-app diagnostic logs).
 *
 * Toggle here so iOS/device builds from GitHub include the Log screen without
 * relying on `.env.local` (which is not committed).
 *
 * Set to `false` before production releases to end users.
 */
export const ENABLE_DEV_TEST_MODE_UI = true;

export function isDevTestModeUiEnabled(): boolean {
  return ENABLE_DEV_TEST_MODE_UI;
}
