import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CatalogArea,
  CatalogGeography,
  CatalogVenue,
  supabase,
} from "./supabase";

type AttendanceRow = {
  venue_id: string;
  venue_name: string;
  attendance: number;
};

type VenueLine = CatalogVenue & { attendance: number };

const MAX_HISTORY = 80;

export function MockAttendancePanel() {
  const [geos, setGeos] = useState<CatalogGeography[]>([]);
  const [areas, setAreas] = useState<CatalogArea[]>([]);
  const [venues, setVenues] = useState<CatalogVenue[]>([]);
  const [attendanceById, setAttendanceById] = useState<Record<string, number>>(
    {}
  );
  const [geographyId, setGeographyId] = useState<string>("");
  const [areaFilter, setAreaFilter] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deltaById, setDeltaById] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [past, setPast] = useState<Record<string, number>[]>([]);
  const [future, setFuture] = useState<Record<string, number>[]>([]);
  const skipHistoryRef = useRef(false);

  const load = useCallback(async () => {
    const [gRes, aRes, vRes, mRes] = await Promise.all([
      supabase
        .from("catalog_geographies")
        .select("*")
        .order("sort_order", { ascending: true }),
      supabase
        .from("catalog_areas")
        .select("*")
        .order("sort_order", { ascending: true }),
      supabase
        .from("catalog_venues")
        .select("*")
        .order("sort_order", { ascending: true }),
      supabase.from("mock_venue_attendance").select("*"),
    ]);

    if (gRes.error) {
      setError(gRes.error.message);
      return;
    }
    if (aRes.error) {
      setError(aRes.error.message);
      return;
    }
    if (vRes.error) {
      setError(vRes.error.message);
      return;
    }
    if (mRes.error) {
      setError(
        mRes.error.message.includes("mock_venue_attendance")
          ? `${mRes.error.message} — run supabase/mock_venue_attendance.sql`
          : mRes.error.message
      );
      return;
    }

    setError(null);
    const geoList = (gRes.data ?? []) as CatalogGeography[];
    setGeos(geoList);
    setAreas((aRes.data ?? []) as CatalogArea[]);
    setVenues((vRes.data ?? []) as CatalogVenue[]);

    const map: Record<string, number> = {};
    for (const row of (mRes.data ?? []) as AttendanceRow[]) {
      map[row.venue_id] = row.attendance;
    }
    // Ensure every venue has a local value even if seed missed a row.
    for (const v of (vRes.data ?? []) as CatalogVenue[]) {
      if (map[v.id] == null) map[v.id] = 0;
    }
    skipHistoryRef.current = true;
    setAttendanceById(map);
    setPast([]);
    setFuture([]);

    setGeographyId((prev) => {
      if (prev && geoList.some((g) => g.id === prev)) return prev;
      const def = geoList.find((g) => g.is_default) ?? geoList[0];
      return def?.id ?? "";
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setAreaFilter("");
    setSelectedIds(new Set());
  }, [geographyId]);

  const areasForGeo = useMemo(
    () => areas.filter((a) => a.geography_id === geographyId),
    [areas, geographyId]
  );

  const lines: VenueLine[] = useMemo(() => {
    return venues
      .filter((v) => v.geography_id === geographyId)
      .filter((v) => (areaFilter ? v.area === areaFilter : true))
      .map((v) => ({
        ...v,
        attendance: attendanceById[v.id] ?? 0,
      }));
  }, [venues, geographyId, areaFilter, attendanceById]);

  function pushHistory(next: Record<string, number>) {
    if (skipHistoryRef.current) {
      skipHistoryRef.current = false;
      setAttendanceById(next);
      return;
    }
    setPast((p) => {
      const copy = [...p, { ...attendanceById }];
      return copy.length > MAX_HISTORY ? copy.slice(-MAX_HISTORY) : copy;
    });
    setFuture([]);
    setAttendanceById(next);
  }

  async function persist(updates: { venue_id: string; attendance: number; venue_name: string }[]) {
    if (!updates.length) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("mock_venue_attendance").upsert(
      updates.map((u) => ({
        venue_id: u.venue_id,
        venue_name: u.venue_name,
        attendance: Math.max(0, Math.floor(u.attendance)),
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "venue_id" }
    );
    setBusy(false);
    if (err) setError(err.message);
  }

  function targetsFor(venueId: string): string[] {
    if (selectedIds.has(venueId) && selectedIds.size > 0) {
      return Array.from(selectedIds);
    }
    return [venueId];
  }

  function applyAbsolute(venueId: string, value: number) {
    const ids = targetsFor(venueId);
    const next = { ...attendanceById };
    const clamped = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
    const updates: { venue_id: string; attendance: number; venue_name: string }[] =
      [];
    for (const id of ids) {
      next[id] = clamped;
      const venue = venues.find((v) => v.id === id);
      if (venue) {
        updates.push({
          venue_id: id,
          attendance: clamped,
          venue_name: venue.name,
        });
      }
    }
    pushHistory(next);
    void persist(updates);
  }

  function applyDelta(venueId: string, delta: number) {
    if (!delta) return;
    const ids = targetsFor(venueId);
    const next = { ...attendanceById };
    const updates: { venue_id: string; attendance: number; venue_name: string }[] =
      [];
    for (const id of ids) {
      const current = next[id] ?? 0;
      const value = Math.max(0, current + delta);
      next[id] = value;
      const venue = venues.find((v) => v.id === id);
      if (venue) {
        updates.push({
          venue_id: id,
          attendance: value,
          venue_name: venue.name,
        });
      }
    }
    pushHistory(next);
    void persist(updates);
  }

  function undo() {
    if (!past.length) return;
    const previous = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [{ ...attendanceById }, ...f].slice(0, MAX_HISTORY));
    setAttendanceById(previous);
    const updates = Object.entries(previous).map(([venue_id, attendance]) => {
      const venue = venues.find((v) => v.id === venue_id);
      return {
        venue_id,
        attendance,
        venue_name: venue?.name ?? venue_id,
      };
    });
    void persist(updates);
  }

  function redo() {
    if (!future.length) return;
    const next = future[0];
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, { ...attendanceById }].slice(-MAX_HISTORY));
    setAttendanceById(next);
    const updates = Object.entries(next).map(([venue_id, attendance]) => {
      const venue = venues.find((v) => v.id === venue_id);
      return {
        venue_id,
        attendance,
        venue_name: venue?.name ?? venue_id,
      };
    });
    void persist(updates);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function deltaValue(id: string): number {
    const raw = deltaById[id] ?? "1";
    const n = Number(raw);
    return Number.isFinite(n) ? Math.floor(n) : 1;
  }

  const hasSelection = selectedIds.size > 0;

  return (
    <div className="mock-attendance-panel">
      <div className="listings-toolbar mock-attendance-toolbar">
        <label>
          Geography
          <select
            value={geographyId}
            onChange={(e) => setGeographyId(e.target.value)}
          >
            {geos.length === 0 && <option value="">No geographies</option>}
            {geos.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
                {!g.is_active ? " (off)" : ""}
                {g.is_test ? " · test" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Area
          <select
            value={areaFilter}
            onChange={(e) => setAreaFilter(e.target.value)}
          >
            <option value="">All areas</option>
            {areasForGeo.map((a) => (
              <option key={a.id} value={a.long_name}>
                {a.long_name}
              </option>
            ))}
          </select>
        </label>

        <div className="mock-attendance-actions">
          <button type="button" onClick={undo} disabled={!past.length || busy}>
            Undo
          </button>
          <button type="button" onClick={redo} disabled={!future.length || busy}>
            Redo
          </button>
          <button
            type="button"
            className={`mock-clear-selection${hasSelection ? " has-selection" : ""}`}
            onClick={clearSelection}
            disabled={!hasSelection}
            title="Clear multiselect"
            aria-label="Clear selection"
          >
            ✕ Clear
          </button>
          {hasSelection && (
            <span className="muted">{selectedIds.size} selected</span>
          )}
          {busy && <span className="muted">Saving…</span>}
        </div>
      </div>

      <p className="muted mock-attendance-help">
        Edit mock live attendance used by the test app when Test Mode mock data
        is on. Multiselect applies absolute edits and +/- steps to every selected
        venue. Undo/redo is session-only.
      </p>

      {error && <p className="error">{error}</p>}

      <div className="table-scroll">
        <table className="mock-attendance-table">
          <thead>
            <tr>
              <th>Venue</th>
              <th>Area</th>
              <th>Attendance</th>
              <th>Adjust</th>
              <th>Select</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No venues for this filter.
                </td>
              </tr>
            ) : (
              lines.map((v) => {
                const selected = selectedIds.has(v.id);
                return (
                  <tr
                    key={v.id}
                    className={selected ? "row-selected" : undefined}
                  >
                    <td>
                      <strong>{v.name}</strong>
                      {v.is_test ? (
                        <span className="muted"> · test</span>
                      ) : null}
                      {!v.is_active ? (
                        <span className="muted"> · off</span>
                      ) : null}
                    </td>
                    <td>{v.area}</td>
                    <td>
                      <input
                        className="mock-attendance-count"
                        type="number"
                        min={0}
                        step={1}
                        defaultValue={v.attendance}
                        key={`${v.id}-${v.attendance}`}
                        onBlur={(e) => {
                          const n = Number(e.target.value);
                          if (!Number.isFinite(n) || n === v.attendance) return;
                          applyAbsolute(v.id, n);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        disabled={busy}
                      />
                    </td>
                    <td>
                      <div className="mock-stepper">
                        <button
                          type="button"
                          aria-label={`Decrease ${v.name}`}
                          disabled={busy}
                          onClick={() =>
                            applyDelta(v.id, -Math.abs(deltaValue(v.id) || 1))
                          }
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={deltaById[v.id] ?? "1"}
                          onChange={(e) =>
                            setDeltaById((d) => ({
                              ...d,
                              [v.id]: e.target.value,
                            }))
                          }
                          aria-label={`Step amount for ${v.name}`}
                        />
                        <button
                          type="button"
                          aria-label={`Increase ${v.name}`}
                          disabled={busy}
                          onClick={() =>
                            applyDelta(v.id, Math.abs(deltaValue(v.id) || 1))
                          }
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td className="mock-select-cell">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleSelect(v.id)}
                        aria-label={`Select ${v.name}`}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
