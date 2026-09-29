import { useCallback, useEffect, useMemo, useState } from "react";
import { CatalogGeography, supabase } from "./supabase";

type FeedbackStatus = "new" | "triaged" | "done" | "dismissed";

type FeedbackRow = {
  id: string;
  created_at: string;
  category: string;
  message: string;
  geography_id: string | null;
  venue_name: string | null;
  listing_id: string | null;
  listing_title: string | null;
  source_screen: string | null;
  reporter_id: string;
  status: FeedbackStatus;
  admin_note: string | null;
  updated_at: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  missing_bar: "Missing bar",
  missing_deal: "Missing deal",
  outdated_listing: "Outdated listing",
  closed_bar: "Closed / remove",
  bar_permanently_closed: "Bar permanently closed",
  bar_temporarily_closed: "Bar temporarily closed",
  bar_moved: "Bar has moved",
  bar_renamed: "Bar has changed names",
  incorrect_attendance: "Incorrect attendance level shown",
  other: "Other",
};

const STATUS_OPTIONS: FeedbackStatus[] = [
  "new",
  "triaged",
  "done",
  "dismissed",
];

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function CatalogFeedbackPanel() {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [geos, setGeos] = useState<CatalogGeography[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("new");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [geoFilter, setGeoFilter] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [gRes, fRes] = await Promise.all([
      supabase
        .from("catalog_geographies")
        .select("*")
        .order("sort_order", { ascending: true }),
      supabase
        .from("catalog_feedback")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300),
    ]);

    if (gRes.error) {
      setError(gRes.error.message);
      return;
    }
    if (fRes.error) {
      setError(
        fRes.error.message.includes("catalog_feedback")
          ? `${fRes.error.message} — run supabase/catalog_feedback.sql`
          : fRes.error.message
      );
      return;
    }

    setError(null);
    setGeos((gRes.data ?? []) as CatalogGeography[]);
    const list = (fRes.data ?? []) as FeedbackRow[];
    setRows(list);
    setNoteDrafts((prev) => {
      const next = { ...prev };
      for (const row of list) {
        if (next[row.id] == null) next[row.id] = row.admin_note ?? "";
      }
      return next;
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const geoName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const g of geos) map[g.id] = g.name;
    return map;
  }, [geos]);

  const visible = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (categoryFilter && r.category !== categoryFilter) return false;
      if (geoFilter && r.geography_id !== geoFilter) return false;
      return true;
    });
  }, [rows, statusFilter, categoryFilter, geoFilter]);

  async function updateRow(
    id: string,
    patch: Partial<Pick<FeedbackRow, "status" | "admin_note">>
  ) {
    setBusyId(id);
    setError(null);
    const { error: err } = await supabase
      .from("catalog_feedback")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    setBusyId(null);
    if (err) {
      setError(err.message);
      return;
    }
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              ...patch,
              updated_at: new Date().toISOString(),
            }
          : r
      )
    );
  }

  return (
    <div className="catalog-feedback-panel">
      <div className="listings-toolbar mock-attendance-toolbar">
        <label>
          Status
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Category
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">All</option>
            {Object.entries(CATEGORY_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Geography
          <select
            value={geoFilter}
            onChange={(e) => setGeoFilter(e.target.value)}
          >
            <option value="">All</option>
            {geos.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <div className="mock-attendance-actions">
          <button type="button" onClick={() => void load()}>
            Refresh
          </button>
          <span className="muted">{visible.length} shown</span>
        </div>
      </div>

      <p className="muted mock-attendance-help">
        In-app tips about missing bars/deals or outdated listings. Mark as
        triaged/done after you update the catalog — tips never auto-edit venues
        or deals.
      </p>

      {error && <p className="error">{error}</p>}

      <div className="table-scroll">
        <table className="catalog-feedback-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Category</th>
              <th>Message</th>
              <th>Context</th>
              <th>Status</th>
              <th>Admin note</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No tips for this filter.
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr key={row.id} className={row.status === "new" ? "row-new" : undefined}>
                  <td className="feedback-when">
                    {formatWhen(row.created_at)}
                  </td>
                  <td>
                    <strong>
                      {CATEGORY_LABELS[row.category] ?? row.category}
                    </strong>
                  </td>
                  <td className="feedback-message">{row.message}</td>
                  <td className="feedback-context">
                    {row.geography_id && (
                      <div>{geoName[row.geography_id] ?? "Geography"}</div>
                    )}
                    {row.venue_name && <div>Bar: {row.venue_name}</div>}
                    {row.listing_title && <div>Deal: {row.listing_title}</div>}
                    {row.source_screen && (
                      <div className="muted">via {row.source_screen}</div>
                    )}
                  </td>
                  <td>
                    <select
                      value={row.status}
                      disabled={busyId === row.id}
                      onChange={(e) =>
                        void updateRow(row.id, {
                          status: e.target.value as FeedbackStatus,
                        })
                      }
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <div className="feedback-note-cell">
                      <textarea
                        rows={2}
                        value={noteDrafts[row.id] ?? ""}
                        onChange={(e) =>
                          setNoteDrafts((d) => ({
                            ...d,
                            [row.id]: e.target.value,
                          }))
                        }
                        placeholder="Internal note…"
                      />
                      <button
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() =>
                          void updateRow(row.id, {
                            admin_note: noteDrafts[row.id]?.trim() || null,
                          })
                        }
                      >
                        Save
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
