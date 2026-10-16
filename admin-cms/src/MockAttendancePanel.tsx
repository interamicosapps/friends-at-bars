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
  recent?: number | null;
};

type Snapshot = {
  attendance: Record<string, number>;
  recent: Record<string, number>;
};

type VenueLine = CatalogVenue & { attendance: number; recent: number };

const MAX_HISTORY = 80;

export function MockAttendancePanel() {
  const [geos, setGeos] = useState<CatalogGeography[]>([]);
  const [areas, setAreas] = useState<CatalogArea[]>([]);
  const [venues, setVenues] = useState<CatalogVenue[]>([]);
  const [attendanceById, setAttendanceById] = useState<Record<string, number>>(
    {}
  );
  const [recentById, setRecentById] = useState<Record<string, number>>({});
  const [geographyId, setGeographyId] = useState<string>("");
  const [areaFilter, setAreaFilter] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
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
          : mRes.error.message.includes("recent")
            ? `${mRes.error.message} — run supabase/mock_venue_attendance_recent.sql`
            : mRes.error.message
      );
      return;
    }

    setError(null);
    const geoList = (gRes.data ?? []) as CatalogGeography[];
    setGeos(geoList);
    setAreas((aRes.data ?? []) as CatalogArea[]);
    setVenues((vRes.data ?? []) as CatalogVenue[]);

    const attendanceMap: Record<string, number> = {};
    const recentMap: Record<string, number> = {};
    for (const row of (mRes.data ?? []) as AttendanceRow[]) {
      attendanceMap[row.venue_id] = row.attendance;
      recentMap[row.venue_id] = Number(row.recent ?? 0);
    }
    for (const v of (vRes.data ?? []) as CatalogVenue[]) {
      if (attendanceMap[v.id] == null) attendanceMap[v.id] = 0;
      if (recentMap[v.id] == null) recentMap[v.id] = 0;
    }
    skipHistoryRef.current = true;
    setAttendanceById(attendanceMap);
    setRecentById(recentMap);
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
        recent: recentById[v.id] ?? 0,
      }));
  }, [venues, geographyId, areaFilter, attendanceById, recentById]);

  function currentSnapshot(): Snapshot {
    return {
      attendance: { ...attendanceById },
      recent: { ...recentById },
    };
  }

  function applySnapshot(next: Snapshot) {
    if (skipHistoryRef.current) {
      skipHistoryRef.current = false;
      setAttendanceById(next.attendance);
      setRecentById(next.recent);
      return;
    }
    setPast((p) => {
      const copy = [...p, currentSnapshot()];
      return copy.length > MAX_HISTORY ? copy.slice(-MAX_HISTORY) : copy;
    });
    setFuture([]);
    setAttendanceById(next.attendance);
    setRecentById(next.recent);
  }

  async function persist(
    updates: {
      venue_id: string;
      venue_name: string;
      attendance: number;
      recent: number;
    }[]
  ) {
    if (!updates.length) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("mock_venue_attendance").upsert(
      updates.map((u) => ({
        venue_id: u.venue_id,
        venue_name: u.venue_name,
        attendance: Math.max(0, Math.floor(u.attendance)),
        recent: Math.max(0, Math.floor(u.recent)),
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "venue_id" }
    );
    setBusy(false);
    if (err) {
      setError(
        err.message.includes("recent")
          ? `${err.message} — run supabase/mock_venue_attendance_recent.sql`
          : err.message
      );
    }
  }

  function targetsFor(venueId: string): string[] {
    if (selectedIds.has(venueId) && selectedIds.size > 0) {
      return Array.from(selectedIds);
    }
    return [venueId];
  }

  function applyField(
    venueId: string,
    field: "attendance" | "recent",
    value: number
  ) {
    const ids = targetsFor(venueId);
    const clamped = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
    const nextAttendance = { ...attendanceById };
    const nextRecent = { ...recentById };
    const updates: {
      venue_id: string;
      venue_name: string;
      attendance: number;
      recent: number;
    }[] = [];

    for (const id of ids) {
      if (field === "attendance") nextAttendance[id] = clamped;
      else nextRecent[id] = clamped;
      const venue = venues.find((v) => v.id === id);
      if (venue) {
        updates.push({
          venue_id: id,
          venue_name: venue.name,
          attendance: nextAttendance[id] ?? 0,
          recent: nextRecent[id] ?? 0,
        });
      }
    }
    applySnapshot({ attendance: nextAttendance, recent: nextRecent });
    void persist(updates);
  }

  function undo() {
    if (!past.length) return;
    const previous = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [currentSnapshot(), ...f].slice(0, MAX_HISTORY));
    setAttendanceById(previous.attendance);
    setRecentById(previous.recent);
    const updates = Object.keys({
      ...previous.attendance,
      ...previous.recent,
    }).map((venue_id) => {
      const venue = venues.find((v) => v.id === venue_id);
      return {
        venue_id,
        venue_name: venue?.name ?? venue_id,
        attendance: previous.attendance[venue_id] ?? 0,
        recent: previous.recent[venue_id] ?? 0,
      };
    });
    void persist(updates);
  }

  function redo() {
    if (!future.length) return;
    const next = future[0];
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, currentSnapshot()].slice(-MAX_HISTORY));
    setAttendanceById(next.attendance);
    setRecentById(next.recent);
    const updates = Object.keys({
      ...next.attendance,
      ...next.recent,
    }).map((venue_id) => {
      const venue = venues.find((v) => v.id === venue_id);
      return {
        venue_id,
        venue_name: venue?.name ?? venue_id,
        attendance: next.attendance[venue_id] ?? 0,
        recent: next.recent[venue_id] ?? 0,
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
        Edit mock live attendance and recent While Using counts used by the test
        app when Test Mode mock data is on. Multiselect applies an edit to every
        selected venue. Undo/redo is session-only.
      </p>

      {error && <p className="error">{error}</p>}

      <div className="table-scroll">
        <table className="mock-attendance-table">
          <thead>
            <tr>
              <th>Venue</th>
              <th>Area</th>
              <th>Attendance</th>
              <th>Recent</th>
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
                        key={`${v.id}-att-${v.attendance}`}
                        onBlur={(e) => {
                          const n = Number(e.target.value);
                          if (!Number.isFinite(n) || n === v.attendance) return;
                          applyField(v.id, "attendance", n);
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
                      <input
                        className="mock-attendance-count"
                        type="number"
                        min={0}
                        step={1}
                        defaultValue={v.recent}
                        key={`${v.id}-rec-${v.recent}`}
                        onBlur={(e) => {
                          const n = Number(e.target.value);
                          if (!Number.isFinite(n) || n === v.recent) return;
                          applyField(v.id, "recent", n);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        disabled={busy}
                      />
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
