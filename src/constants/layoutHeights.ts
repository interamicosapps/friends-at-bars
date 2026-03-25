/** Top navbar row height (matches Navbar inner `h-16`). */
export const NAVBAR_HEIGHT = "4rem";

/**
 * Content below Navbar: `100dvh` minus the full header (safe top + bar) and bottom tab + safe bottom.
 * Align with `Navbar` (`paddingTop: safe-area` + `h-16`) and `BottomNav` + `Layout` padding.
 */
export function shellHeightWithBottomNav(): string {
  return "calc(100dvh - var(--safe-area-inset-top) - 4rem - 3.5rem - var(--safe-area-inset-bottom))";
}

/**
 * Switch Search in-game / end: no bottom nav; still subtract full top chrome (notch + `h-16`).
 */
export function shellHeightImmersive(): string {
  return "calc(100dvh - var(--safe-area-inset-top) - 4rem)";
}
