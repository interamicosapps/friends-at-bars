import { Link } from "react-router-dom";

/** Map screen only: logo over the map, no top banner. */
export default function MapFloatingLogo() {
  return (
    <Link
      to="/"
      className="pointer-events-auto fixed left-3 z-[60] flex h-3.5 w-3.5 items-center justify-center rounded-md bg-primary shadow-sm"
      style={{ top: "calc(var(--safe-area-inset-top) + 8px)" }}
      aria-label="Bar Fest home"
    >
      <img
        src="/brand/logo-mark.png"
        alt="Bar Fest"
        draggable={false}
        className="h-3.5 w-3.5 object-contain"
      />
    </Link>
  );
}
