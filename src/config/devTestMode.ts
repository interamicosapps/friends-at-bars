/**
 * Dev-only test UI (bottom bar “Test Mode” + “Log” + mock check-ins on Activities/Map).
 *
 * Enable via `.env.local`:
 *   VITE_ENABLE_DEV_TEST_MODE_UI=true
 *
 * For merges to `main`: leave unset/false and remove TestModeProvider if desired
 * (see comments in `App.tsx` / `BottomNav.tsx`).
 */
export function isDevTestModeUiEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_DEV_TEST_MODE_UI === "true";
}

/** @deprecated Use `isDevTestModeUiEnabled()` — kept for existing imports. */
export const ENABLE_DEV_TEST_MODE_UI = isDevTestModeUiEnabled();
