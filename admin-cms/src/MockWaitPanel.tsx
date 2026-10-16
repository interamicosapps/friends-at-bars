import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CatalogArea,
  CatalogGeography,
  CatalogVenue,
  supabase,
} from "./supabase";

const BUCKETS = [5, 10, 15, 30, 45] as const;
type Bucket = (typeof BUCKETS)[number];

type BucketCounts = Record<Bucket, number>;

type WaitRow = {
  venue_id: string;
  venue_name: string;
  count_5: number;
  count_10: number;
  count_15: number;
  count_30: number;
  count_45: number;
};

type VenueLine = CatalogVenue & { counts: BucketCounts };

const MAX_HISTORY = 80;

function emptyCounts(): BucketCounts {
  return { 5: 0, 10: 0, 15: 0, 30: 0, 45: 0 };
}

function rowToCounts(row: WaitRow): BucketCounts {
  return {
    5: Math.max(0, Number(row.count_5) || 0),
    10: Math.max(0, Number(row.count_10) || 0),
    15: Math.max(0, Number(row.count_15) || 0),
    30: Math.max(0, Number(row.count_30) || 0),
    45: Math.max(0, Number(row.count_45) || 0),
  };
}

function bucketLabel(b: Bucket): string {
  return b === 45 ? "45+" : String(b);
}

export function MockWaitPanel() {
  const [geos, setGeos] = useState<CatalogGeography[]>([]);
  const [areas, setAreas] = useState<CatalogArea[]>([]);
  const [venues, setVenues] = useState<CatalogVenue[]>([]);
  const [countsById, setCountsById] = useState<Record<string, BucketCounts>>(
    {}
  );
  const [geographyId, setGeographyId] = useState<string>("");
  const [areaFilter, setAreaFilter] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [past, setPast] = useState<Record<string, BucketCounts>[]>([]);
  const [future, setFuture] = useState<Record<string, BucketCounts>[]>([]);
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
      supabase.from("mock_venue_wait").select("*"),
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
        mRes.error.message.includes("mock_venue_wait")
          ? `${mRes.error.message} — run supabase/mock_venue_wait.sql`
          : mRes.error.message
      );
      return;
    }

    setError(null);
    const geoList = (gRes.data ?? []) as CatalogGeography[];
    setGeos(geoList);
    setAreas((aRes.data ?? []) as CatalogArea[]);
    setVenues((vRes.data ?? []) as CatalogVenue[]);

    const map: Record<string, BucketCounts> = {};
    for (const row of (mRes.data ?? []) as WaitRow[]) {
      map[row.venue_id] = rowToCounts(row);
    }
    for (const v of (vRes.data ?? []) as CatalogVenue[]) {
      if (map[v.id] == null) map[v.id] = emptyCounts();
    }
    skipHistoryRef.current = true;
    setCountsById(map);
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
        counts: countsById[v.id] ?? emptyCounts(),
      }));
  }, [venues, geographyId, areaFilter, countsById]);

  function pushHistory(next: Record<string, BucketCounts>) {
    if (skipHistoryRef.current) {
      skipHistoryRef.current = false;
      setCountsById(next);
      return;
    }
    setPast((p) => {
      const copy = [...p, { ...countsById }];
      return copy.length > MAX_HISTORY ? copy.slice(-MAX_HISTORY) : copy;
    });
    setFuture([]);
    setCountsById(next);
  }

  async function persist(
    updates: { venue_id: string; venue_name: string; counts: BucketCounts }[]
  ) {
    if (!updates.length) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("mock_venue_wait").upsert(
      updates.map((u) => ({
        venue_id: u.venue_id,
        venue_name: u.venue_name,
        count_5: u.counts[5],
        count_10: u.counts[10],
        count_15: u.counts[15],
        count_30: u.counts[30],
        count_45: u.counts[45],
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "venue_id" }
    );
    setBusy(false);
    if (err) {
      setError(
        err.message.includes("mock_venue_wait")
          ? `${err.message} — run supabase/mock_venue_wait.sql`
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

  function applyBucket(venueId: string, bucket: Bucket, value: number) {
    const ids = targetsFor(venueId);
    const clamped = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
    const next: Record<string, BucketCounts> = { ...countsById };
    const updates: {
      venue_id: string;
      venue_name: string;
      counts: BucketCounts;
    }[] = [];

    for (const id of ids) {
      const current = { ...(next[id] ?? emptyCounts()) };
      current[bucket] = clamped;
      next[id] = current;
      const venue = venues.find((v) => v.id === id);
      if (venue) {
        updates.push({
          venue_id: id,
          venue_name: venue.name,
          counts: current,
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
    setFuture((f) => [{ ...countsById }, ...f].slice(0, MAX_HISTORY));
    setCountsById(previous);
    const updates = Object.entries(previous).map(([venue_id, counts]) => {
      const venue = venues.find((v) => v.id === venue_id);
      return {
        venue_id,
        venue_name: venue?.name ?? venue_id,
        counts,
      };
    });
    void persist(updates);
  }

  function redo() {
    if (!future.length) return;
    const next = future[0];
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, { ...countsById }].slice(-MAX_HISTORY));
    setCountsById(next);
    const updates = Object.entries(next).map(([venue_id, counts]) => {
      const venue = venues.find((v) => v.id === venue_id);
      return {
        venue_id,
        venue_name: venue?.name ?? venue_id,
        counts,
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
        Edit mock wait-time report counts used by the test app when Test Mode
        mock data is on. Each box is how many users reported that wait. Multiselect
        applies an edit to every selected venue. Undo/redo is session-only.
      </p>

      {error && <p className="error">{error}</p>}

      <div className="table-scroll">
        <table className="mock-attendance-table mock-wait-table">
          <thead>
            <tr>
              <th>Venue</th>
              <th>Area</th>
              <th>
                <div className="mock-wait-header">
                  <span className="mock-wait-header-title">Wait-Time</span>
                  <div className="mock-wait-buckets">
                    {BUCKETS.map((b) => (
                      <span key={b} className="mock-wait-bucket-label">
                        {bucketLabel(b)}
                      </span>
                    ))}
                  </div>
                </div>
              </th>
              <th>Select</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
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
                      <div className="mock-wait-buckets">
                        {BUCKETS.map((b) => (
                          <input
                            key={`${v.id}-${b}-${v.counts[b]}`}
                            className="mock-wait-count"
                            type="number"
                            min={0}
                            step={1}
                            defaultValue={v.counts[b]}
                            aria-label={`${v.name} wait ${bucketLabel(b)} count`}
                            onBlur={(e) => {
                              const n = Number(e.target.value);
                              if (!Number.isFinite(n) || n === v.counts[b])
                                return;
                              applyBucket(v.id, b, n);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                (e.target as HTMLInputElement).blur();
                              }
                            }}
                            disabled={busy}
                          />
                        ))}
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
