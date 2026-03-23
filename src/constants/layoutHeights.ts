/** Top navbar height (matches Navbar). */
export const NAVBAR_HEIGHT = "4rem";

/**
 * Same vertical space as Layout `paddingBottom` / bottom nav + safe area.
 * Flat calc avoids nesting `calc()` inside `calc()`.
 */
export function shellHeightWithBottomNav(): string {
  return "calc(100dvh - 4rem - 3.5rem - var(--safe-area-inset-bottom))";
}

/** When the bottom nav is hidden (e.g. Switch Search in-game). */
export function shellHeightImmersive(): string {
  return "calc(100dvh - 4rem)";
}
