import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { VenuesPanel } from "./VenuesPanel";
import { ListingsPanel } from "./ListingsPanel";
import { GameContentPanel } from "./GameContentPanel";
import { GeographiesPanel } from "./GeographiesPanel";
import { MapPanel, type MapCoords } from "./MapPanel";
import { MockAttendancePanel } from "./MockAttendancePanel";

type Tab =
  | "venues"
  | "listings"
  | "games"
  | "geographies"
  | "mock"
  | "map";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<Tab>("venues");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [venueSeed, setVenueSeed] = useState<MapCoords | null>(null);
  const [geoSeed, setGeoSeed] = useState<MapCoords | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) =>
      setSession(s)
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setBusy(false);
    if (err) setError(err.message);
  }

  if (!session) {
    return (
      <div className="login panel">
        <h1>Bar Fest CMS</h1>
        <p className="muted">Sign in with a Supabase Auth editor account.</p>
        <form
          onSubmit={signIn}
          style={{ display: "grid", gap: "0.75rem", marginTop: "1rem" }}
        >
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    );
  }

  const shellClass =
    tab === "map"
      ? "app-shell map-mode"
      : tab === "listings" || tab === "mock"
        ? "app-shell wide"
        : "app-shell";

  return (
    <div className={shellClass}>
      <header>
        <div>
          <h1>Bar Fest CMS</h1>
          <p className="muted">{session.user.email}</p>
        </div>
        <button type="button" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </header>

      <div className="tabs">
        {(
          [
            ["venues", "Venues", "Venues"],
            ["listings", "Deals / Events", "Deals"],
            ["games", "Game content", "Games"],
            ["geographies", "Geographies", "Geos"],
            ["mock", "Mock live", "Mock"],
            ["map", "Map", "Map"],
          ] as const
        ).map(([id, label, shortLabel]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            <span className="tab-label-full">{label}</span>
            <span className="tab-label-short">{shortLabel}</span>
          </button>
        ))}
      </div>

      <div className={tab === "map" ? "panel map-panel" : "panel"}>
        {tab === "venues" && (
          <VenuesPanel
            seedCoords={venueSeed}
            onSeedConsumed={() => setVenueSeed(null)}
          />
        )}
        {tab === "listings" && <ListingsPanel />}
        {tab === "games" && <GameContentPanel />}
        {tab === "geographies" && (
          <GeographiesPanel
            seedCoords={geoSeed}
            onSeedConsumed={() => setGeoSeed(null)}
          />
        )}
        {tab === "mock" && <MockAttendancePanel />}
        {tab === "map" && (
          <MapPanel
            onStartVenue={(coords) => {
              setVenueSeed(coords);
              setTab("venues");
            }}
            onStartGeography={(coords) => {
              setGeoSeed(coords);
              setTab("geographies");
            }}
          />
        )}
      </div>
    </div>
  );
}
