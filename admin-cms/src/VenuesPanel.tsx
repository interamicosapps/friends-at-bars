import { useCallback, useEffect, useState } from "react";
import { CatalogArea, CatalogGeography, CatalogVenue, supabase } from "./supabase";
import type { MapCoords } from "./MapPanel";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import {
  DEFAULT_FOOTPRINT_HALF_M,
  FOOTPRINT_CORNER_LABELS,
  defaultVenueFootprint,
  normalizeFootprint,
  type LatLng,
} from "./venueFootprint";

type VenueDraft = Omit<CatalogVenue, "id">;

const empty: VenueDraft = {
  name: "",
  area: "North Campus",
  geography_id: null,
  latitude: 40.0,
  longitude: -83.01,
  radius_m: 100,
  footprint: defaultVenueFootprint(40.0, -83.01),
  is_test: false,
  is_active: true,
  sort_order: 0,
  location_group: null,
};

type VenuesPanelProps = {
  seedCoords?: MapCoords | null;
  onSeedConsumed?: () => void;
};

function FootprintFields({
  draft,
  onChange,
}: {
  draft: VenueDraft;
  onChange: (draft: VenueDraft) => void;
}) {
  const corners = normalizeFootprint(
    draft.footprint,
    draft.latitude,
    draft.longitude
  );

  function setCorner(index: number, next: LatLng) {
    const updated = corners.map((c, i) => (i === index ? next : c));
    onChange({ ...draft, footprint: updated });
  }

  return (
    <div className="full footprint-fields">
      <div className="footprint-header">
        <strong>Footprint corners</strong>
        <span className="muted">
          NW → NE → SE → SW (presence = inside polygon; sticky ≤15 m)
        </span>
        <button
          type="button"
          onClick={() =>
            onChange({
              ...draft,
              footprint: defaultVenueFootprint(
                draft.latitude,
                draft.longitude,
                DEFAULT_FOOTPRINT_HALF_M
              ),
            })
          }
        >
          Reset {DEFAULT_FOOTPRINT_HALF_M}m square
        </button>
      </div>
      <div className="footprint-grid">
        {FOOTPRINT_CORNER_LABELS.map((label, index) => (
          <div key={label} className="footprint-corner">
            <span>{label}</span>
            <label>
              Lat
              <input
                type="number"
                step="any"
                value={corners[index]?.lat ?? 0}
                onChange={(e) =>
                  setCorner(index, {
                    lat: Number(e.target.value),
                    lng: corners[index]?.lng ?? 0,
                  })
                }
                required
              />
            </label>
            <label>
              Lng
              <input
                type="number"
                step="any"
                value={corners[index]?.lng ?? 0}
                onChange={(e) =>
                  setCorner(index, {
                    lat: corners[index]?.lat ?? 0,
                    lng: Number(e.target.value),
                  })
                }
                required
              />
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Placeholder id for the venue being created, before it has a database id. */
const DRAFT_MEMBER_ID = "__draft__";

function locationKey(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

type SharedMember = {
  key: string;
  venueId: string | null;
  name: string;
};

function stackIds(venue: CatalogVenue, venues: CatalogVenue[]): string[] {
  const key = locationKey(venue.location_group);
  if (!key) return [venue.id];
  const members = venues
    .filter(
      (other) =>
        other.geography_id === venue.geography_id &&
        locationKey(other.location_group) === key
    )
    .sort(compareVenueOrder);
  const ids = members.map((member) => member.id);
  if (!ids.includes(venue.id)) ids.unshift(venue.id);
  return ids;
}

function stackMembers(venue: CatalogVenue, venues: CatalogVenue[]): SharedMember[] {
  return stackIds(venue, venues).map((id) => {
    const row = venues.find((item) => item.id === id) ?? venue;
    return { key: id, venueId: id, name: row.name };
  });
}

function groupKeyForStack(
  members: SharedMember[],
  selfId: string,
  draft: VenueDraft,
  venues: CatalogVenue[]
): string | null {
  if (members.length < 2) return null;
  const ids = new Set(
    members.flatMap((member) => (member.venueId ? [member.venueId] : []))
  );
  if (selfId !== DRAFT_MEMBER_ID) ids.add(selfId);
  const current = (draft.location_group ?? "").trim();
  const usedOutside = (key: string) =>
    venues.some(
      (venue) =>
        !ids.has(venue.id) &&
        venue.geography_id === draft.geography_id &&
        locationKey(venue.location_group) === locationKey(key)
    );
  if (current && !usedOutside(current)) return current;
  const selfKey = selfId === DRAFT_MEMBER_ID ? crypto.randomUUID() : selfId;
  return `shared-${selfKey}`;
}

function compareVenueOrder(
  a: { sort_order: number; name: string },
  b: { sort_order: number; name: string }
): number {
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function venueListRows(rows: CatalogVenue[]): { id: string; venues: CatalogVenue[] }[] {
  const seen = new Set<string>();
  const items: { id: string; venues: CatalogVenue[] }[] = [];
  for (const venue of rows) {
    const key = locationKey(venue.location_group);
    const groupId = key
      ? `${venue.geography_id ?? "none"}:${key}`
      : `venue:${venue.id}`;
    if (seen.has(groupId)) continue;
    seen.add(groupId);
    if (!key) {
      items.push({ id: groupId, venues: [venue] });
      continue;
    }
    const members = rows
      .filter(
        (other) =>
          other.geography_id === venue.geography_id &&
          locationKey(other.location_group) === key
      )
      .sort(compareVenueOrder);
    items.push({ id: groupId, venues: members.length ? members : [venue] });
  }
  return items;
}

function venueListTitle(venues: CatalogVenue[]): string {
  return venues.map((venue) => venue.name).join(", ");
}

function VenueFields({
  draft,
  onChange,
  geos,
  areas,
  venues,
  venueId,
  sharedMembers,
  onSharedMembersChange,
  onAskRemove,
}: {
  draft: VenueDraft;
  onChange: (draft: VenueDraft) => void;
  geos: CatalogGeography[];
  areas: CatalogArea[];
  venues: CatalogVenue[];
  venueId?: string;
  sharedMembers: SharedMember[];
  onSharedMembersChange: (members: SharedMember[]) => void;
  onAskRemove: (member: SharedMember) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [sharedName, setSharedName] = useState("");
  const [sharedNameError, setSharedNameError] = useState<string | null>(null);
  const selfId = venueId ?? DRAFT_MEMBER_ID;
  const ordered = sharedMembers.some((member) => member.key === selfId)
    ? sharedMembers
    : [{ key: selfId, venueId: venueId ?? null, name: draft.name }, ...sharedMembers];
  const showCards = ordered.length > 1;

  function memberName(member: SharedMember): string {
    if (member.key === selfId) return draft.name.trim() || "This bar";
    return member.name.trim() || "New bar";
  }

  function setGeography(geographyId: string | null) {
    const firstArea = areas.find((area) => area.geography_id === geographyId);
    onChange({
      ...draft,
      geography_id: geographyId,
      area: firstArea?.long_name ?? draft.area,
    });
    onSharedMembersChange(
      ordered.filter((member) => {
        if (member.key === selfId || !member.venueId) return true;
        const venue = venues.find((item) => item.id === member.venueId);
        return venue?.geography_id === geographyId;
      })
    );
    setMenuOpen(false);
  }

  function addNamedBar() {
    const name = sharedName.trim();
    if (!name) {
      setSharedNameError("Enter a bar name.");
      return;
    }
    const taken =
      ordered.some(
        (member) => memberName(member).toLowerCase() === name.toLowerCase()
      ) ||
      venues.some(
        (venue) =>
          venue.id !== venueId &&
          venue.name.trim().toLowerCase() === name.toLowerCase()
      );
    if (taken) {
      setSharedNameError("A bar already has that name.");
      return;
    }
    onSharedMembersChange([
      ...ordered,
      { key: `new-${crypto.randomUUID()}`, venueId: null, name },
    ]);
    setSharedName("");
    setSharedNameError(null);
    setMenuOpen(false);
  }

  function moveShared(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onSharedMembersChange(next);
  }

  return (
    <div className="venue-form">
      <section className="venue-form-section">
        <h3>Bar</h3>
        <div className="venue-form-grid">
          <label>
            Name
            <input
              value={draft.name}
              onChange={(e) => onChange({ ...draft, name: e.target.value })}
              required
            />
          </label>
          <label>
            Geography
            <select
              value={draft.geography_id ?? ""}
              onChange={(e) => setGeography(e.target.value || null)}
              required
            >
              <option value="" disabled>
                Select geography
              </option>
              {geos.map((geo) => (
                <option key={geo.id} value={geo.id}>
                  {geo.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Area
            <select
              value={draft.area}
              onChange={(e) => onChange({ ...draft, area: e.target.value })}
              required
            >
              {areas
                .filter((area) => area.geography_id === draft.geography_id)
                .map((area) => (
                  <option key={area.id} value={area.long_name}>
                    {area.long_name}
                  </option>
                ))}
            </select>
          </label>
          <div className="venue-checks">
            <label className="inline-check">
              <input
                type="checkbox"
                checked={draft.is_active}
                onChange={(e) =>
                  onChange({ ...draft, is_active: e.target.checked })
                }
              />
              Active
            </label>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={draft.is_test}
                onChange={(e) =>
                  onChange({ ...draft, is_test: e.target.checked })
                }
              />
              Test venue
            </label>
          </div>
          <div className="full shared-bars">
            {showCards ? (
              <ol className="shared-bar-list">
                {ordered.map((member, index) => (
                  <li key={member.key} className="shared-bar-card">
                    <span className="shared-bar-order">{index + 1}</span>
                    <span className="shared-bar-name">{memberName(member)}</span>
                    <div className="shared-bar-moves">
                      <button
                        type="button"
                        aria-label={`Move ${memberName(member)} up`}
                        disabled={index === 0}
                        onClick={() => moveShared(index, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${memberName(member)} down`}
                        disabled={index === ordered.length - 1}
                        onClick={() => moveShared(index, 1)}
                      >
                        ↓
                      </button>
                    </div>
                    {member.key !== selfId ? (
                      <button
                        type="button"
                        className="shared-bar-remove"
                        onClick={() => onAskRemove(member)}
                      >
                        Remove
                      </button>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : null}
            <div className="shared-add">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen((open) => !open);
                  setSharedNameError(null);
                }}
                aria-expanded={menuOpen}
              >
                Add Shared Bar
              </button>
              {menuOpen ? (
                <div className="shared-add-panel">
                  <label>
                    New bar name
                    <input
                      value={sharedName}
                      placeholder="Name at this location"
                      autoFocus
                      onChange={(e) => {
                        setSharedName(e.target.value);
                        setSharedNameError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addNamedBar();
                        }
                      }}
                    />
                  </label>
                  <button type="button" onClick={addNamedBar}>
                    Add
                  </button>
                  <span className="muted">
                    Copies this footprint. Both bars show the same live
                    attendance.
                  </span>
                  {sharedNameError ? (
                    <span className="error">{sharedNameError}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="venue-form-section">
        <h3>Map</h3>
        <div className="venue-form-grid">
          <label>
            Center latitude
            <input
              type="number"
              step="any"
              value={draft.latitude}
              onChange={(e) => {
                const latitude = Number(e.target.value);
                onChange({
                  ...draft,
                  latitude,
                  footprint: draft.footprint?.length
                    ? draft.footprint
                    : defaultVenueFootprint(latitude, draft.longitude),
                });
              }}
              required
            />
          </label>
          <label>
            Center longitude
            <input
              type="number"
              step="any"
              value={draft.longitude}
              onChange={(e) => {
                const longitude = Number(e.target.value);
                onChange({
                  ...draft,
                  longitude,
                  footprint: draft.footprint?.length
                    ? draft.footprint
                    : defaultVenueFootprint(draft.latitude, longitude),
                });
              }}
              required
            />
          </label>
          <FootprintFields draft={draft} onChange={onChange} />
        </div>
      </section>
    </div>
  );
}

function normalizeDraft(draft: VenueDraft): VenueDraft {
  const group = (draft.location_group ?? "").trim();
  return {
    ...draft,
    location_group: group.length ? group : null,
  };
}

function venueToDraft(v: CatalogVenue): VenueDraft {
  return {
    name: v.name,
    area: v.area,
    geography_id: v.geography_id,
    latitude: v.latitude,
    longitude: v.longitude,
    radius_m: v.radius_m,
    footprint: normalizeFootprint(v.footprint, v.latitude, v.longitude),
    is_test: v.is_test,
    is_active: v.is_active,
    sort_order: v.sort_order,
    location_group: v.location_group ?? "",
  };
}

function freshAddDraft(
  geos: CatalogGeography[],
  areas: CatalogArea[]
): VenueDraft {
  const def = geos.find((g) => g.is_default) ?? geos[0];
  const firstArea = def
    ? areas.find((a) => a.geography_id === def.id)
    : undefined;
  return {
    ...empty,
    geography_id: def?.id ?? null,
    area: firstArea?.long_name ?? empty.area,
    footprint: defaultVenueFootprint(empty.latitude, empty.longitude),
  };
}

export function VenuesPanel({
  seedCoords = null,
  onSeedConsumed,
}: VenuesPanelProps) {
  const [rows, setRows] = useState<CatalogVenue[]>([]);
  const [geos, setGeos] = useState<CatalogGeography[]>([]);
  const [areas, setAreas] = useState<CatalogArea[]>([]);
  const [addDraft, setAddDraft] = useState<VenueDraft>(empty);
  const [addShared, setAddShared] = useState<SharedMember[]>([
    { key: DRAFT_MEMBER_ID, venueId: null, name: "" },
  ]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<VenueDraft | null>(null);
  const [editShared, setEditShared] = useState<SharedMember[]>([]);
  const [editBaselineIds, setEditBaselineIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<CatalogVenue | null>(null);
  const [removeChoice, setRemoveChoice] = useState<{
    member: SharedMember;
    where: "add" | "edit";
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [vRes, gRes, aRes] = await Promise.all([
      supabase
        .from("catalog_venues")
        .select("*")
        .order("sort_order", { ascending: true }),
      supabase
        .from("catalog_geographies")
        .select("*")
        .order("sort_order", { ascending: true }),
      supabase
        .from("catalog_areas")
        .select("*")
        .order("sort_order", { ascending: true }),
    ]);
    if (vRes.error) setError(vRes.error.message);
    else {
      setError(null);
      setRows((vRes.data ?? []) as CatalogVenue[]);
    }
    if (!gRes.error) setGeos((gRes.data ?? []) as CatalogGeography[]);
    if (!aRes.error) setAreas((aRes.data ?? []) as CatalogArea[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!geos.length || addDraft.geography_id) return;
    const def = geos.find((g) => g.is_default) ?? geos[0];
    const firstArea = areas.find((a) => a.geography_id === def.id);
    setAddDraft((d) => ({
      ...d,
      geography_id: def.id,
      area: firstArea?.long_name ?? d.area,
    }));
  }, [geos, areas, addDraft.geography_id]);

  useEffect(() => {
    if (!seedCoords) return;
    setEditingId(null);
    setEditDraft(null);
    setEditShared([]);
    setEditBaselineIds([]);
    setAddDraft({
      ...freshAddDraft(geos, areas),
      latitude: seedCoords.latitude,
      longitude: seedCoords.longitude,
      footprint: defaultVenueFootprint(
        seedCoords.latitude,
        seedCoords.longitude
      ),
    });
    setAddShared([{ key: DRAFT_MEMBER_ID, venueId: null, name: "" }]);
    onSeedConsumed?.();
  }, [seedCoords]); // onSeedConsumed clears seed; omit from deps to avoid loops

  function draftForStack(
    selfId: string,
    draft: VenueDraft,
    members: SharedMember[]
  ): VenueDraft {
    const ordered = members.some((member) => member.key === selfId)
      ? members
      : [
          {
            key: selfId,
            venueId: selfId === DRAFT_MEMBER_ID ? null : selfId,
            name: draft.name,
          },
          ...members,
        ];
    const key = groupKeyForStack(ordered, selfId, draft, rows);
    const selfIndex = Math.max(
      0,
      ordered.findIndex((member) => member.key === selfId)
    );
    return normalizeDraft({
      ...draft,
      location_group: key,
      sort_order: key ? selfIndex + 1 : draft.sort_order,
    });
  }

  async function syncCompanions(
    selfId: string,
    draft: VenueDraft,
    group: string | null,
    members: SharedMember[],
    baselineIds: string[]
  ): Promise<string | null> {
    const ordered = members.some((member) => member.key === selfId)
      ? members
      : [{ key: selfId, venueId: null, name: draft.name }, ...members];
    const keptIds = new Set(
      ordered.flatMap((member) => (member.venueId ? [member.venueId] : []))
    );
    const jobs = [];
    if (group) {
      ordered.forEach((member, index) => {
        if (member.key === selfId) return;
        const sharedLocation = {
          location_group: group,
          sort_order: index + 1,
          latitude: draft.latitude,
          longitude: draft.longitude,
          footprint: draft.footprint,
          geography_id: draft.geography_id,
          area: draft.area,
          radius_m: draft.radius_m,
        };
        if (member.venueId) {
          jobs.push(
            supabase
              .from("catalog_venues")
              .update(sharedLocation)
              .eq("id", member.venueId)
          );
          return;
        }
        jobs.push(
          supabase.from("catalog_venues").insert({
            ...sharedLocation,
            name: member.name.trim(),
            is_active: true,
            is_test: draft.is_test,
          })
        );
      });
    }
    for (const oldId of baselineIds) {
      if (!oldId || oldId === selfId || keptIds.has(oldId)) continue;
      jobs.push(
        supabase
          .from("catalog_venues")
          .update({ location_group: null })
          .eq("id", oldId)
      );
    }
    const results = await Promise.all(jobs);
    return results.find((result) => result.error)?.error?.message ?? null;
  }

  async function createVenue(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const next = draftForStack(DRAFT_MEMBER_ID, addDraft, addShared);
    const { error: err } = await supabase.from("catalog_venues").insert(next);
    if (err) {
      setError(err.message);
      return;
    }
    const sharedErr = await syncCompanions(
      DRAFT_MEMBER_ID,
      next,
      next.location_group,
      addShared,
      []
    );
    if (sharedErr) {
      setError(sharedErr);
      await load();
      return;
    }
    setAddDraft(freshAddDraft(geos, areas));
    setAddShared([{ key: DRAFT_MEMBER_ID, venueId: null, name: "" }]);
    await load();
  }

  async function updateVenue(e: React.FormEvent, id: string) {
    e.preventDefault();
    if (!editDraft) return;
    setError(null);
    const next = draftForStack(id, editDraft, editShared);
    const { error: err } = await supabase
      .from("catalog_venues")
      .update(next)
      .eq("id", id);
    if (err) {
      setError(err.message);
      return;
    }
    const sharedErr = await syncCompanions(
      id,
      next,
      next.location_group,
      editShared,
      editBaselineIds
    );
    if (sharedErr) {
      setError(sharedErr);
      await load();
      return;
    }
    setEditingId(null);
    setEditDraft(null);
    setEditShared([]);
    setEditBaselineIds([]);
    await load();
  }

  function startEdit(v: CatalogVenue) {
    if (editingId === v.id) {
      setEditingId(null);
      setEditDraft(null);
      setEditShared([]);
      setEditBaselineIds([]);
      return;
    }
    const members = stackMembers(v, rows);
    setEditingId(v.id);
    setEditDraft(venueToDraft(v));
    setEditShared(members);
    setEditBaselineIds(
      members.flatMap((member) => (member.venueId ? [member.venueId] : []))
    );
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(null);
    setEditShared([]);
    setEditBaselineIds([]);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setError(null);
    const { error: err } = await supabase
      .from("catalog_venues")
      .delete()
      .eq("id", deleteTarget.id);
    if (err) {
      setError(err.message);
      return;
    }
    if (editingId === deleteTarget.id) {
      setEditingId(null);
      setEditDraft(null);
      setEditShared([]);
      setEditBaselineIds([]);
    }
    setDeleteTarget(null);
    await load();
  }

  function dropSharedMember(member: SharedMember, where: "add" | "edit") {
    const drop = (members: SharedMember[]) =>
      members.filter((item) => item.key !== member.key);
    if (where === "add") setAddShared(drop);
    else setEditShared(drop);
    if (member.venueId) {
      setEditBaselineIds((ids) => ids.filter((id) => id !== member.venueId));
    }
  }

  async function confirmRemoveFromGroup() {
    if (!removeChoice) return;
    const { member, where } = removeChoice;
    if (member.venueId) {
      setError(null);
      const { error: err } = await supabase
        .from("catalog_venues")
        .update({ location_group: null })
        .eq("id", member.venueId);
      if (err) {
        setError(err.message);
        return;
      }
      await load();
    }
    dropSharedMember(member, where);
    setRemoveChoice(null);
  }

  async function confirmDeleteSharedBar() {
    if (!removeChoice) return;
    const { member, where } = removeChoice;
    if (member.venueId) {
      setError(null);
      const { error: err } = await supabase
        .from("catalog_venues")
        .delete()
        .eq("id", member.venueId);
      if (err) {
        setError(err.message);
        return;
      }
      if (editingId === member.venueId) {
        setEditingId(null);
        setEditDraft(null);
        setEditShared([]);
        setEditBaselineIds([]);
        setRemoveChoice(null);
        await load();
        return;
      }
      await load();
    }
    dropSharedMember(member, where);
    setRemoveChoice(null);
  }

  return (
    <div className="venues-panel">
      <h2>Add venue</h2>
      <form className="venue-add-form" onSubmit={createVenue}>
        <VenueFields
          draft={addDraft}
          onChange={setAddDraft}
          geos={geos}
          areas={areas}
          venues={rows}
          sharedMembers={addShared}
          onSharedMembersChange={setAddShared}
          onAskRemove={(member) => setRemoveChoice({ member, where: "add" })}
        />
        <div className="row-actions venue-form-actions">
          <button type="submit">Create</button>
        </div>
      </form>

      {error && <p className="error">{error}</p>}

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Geography</th>
              <th>Area</th>
              <th>Lat / Lng</th>
              <th>Flags</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {venueListRows(rows).map((item) => {
              const primary = item.venues[0];
              const editing = item.venues.find((venue) => venue.id === editingId);
              const title = venueListTitle(item.venues);
              if (editing && editDraft) {
                return (
                  <tr key={item.id} className="venue-row-editing">
                    <td colSpan={6}>
                      <form
                        className="venue-inline-edit"
                        onSubmit={(e) => void updateVenue(e, editing.id)}
                      >
                        <div className="venue-inline-edit-header">
                          <strong>Editing {title}</strong>
                        </div>
                        <VenueFields
                          key={editing.id}
                          draft={editDraft}
                          onChange={setEditDraft}
                          geos={geos}
                          areas={areas}
                          venues={rows}
                          venueId={editing.id}
                          sharedMembers={editShared}
                          onSharedMembersChange={setEditShared}
                          onAskRemove={(member) =>
                            setRemoveChoice({ member, where: "edit" })
                          }
                        />
                        <div className="row-actions venue-inline-edit-actions">
                          <button type="submit">Save changes</button>
                          <button type="button" onClick={cancelEdit}>
                            Cancel
                          </button>
                        </div>
                      </form>
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={item.id}>
                  <td>{title}</td>
                  <td>
                    {geos.find((g) => g.id === primary.geography_id)?.name ?? "—"}
                  </td>
                  <td>{primary.area}</td>
                  <td>
                    {primary.latitude.toFixed(5)}, {primary.longitude.toFixed(5)}
                  </td>
                  <td>
                    {primary.is_active ? "active" : "off"}
                    {primary.is_test ? " · test" : ""}
                  </td>
                  <td className="row-actions">
                    <button type="button" onClick={() => startEdit(primary)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => setDeleteTarget(primary)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {removeChoice && (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shared-bar-remove-title"
          onClick={() => setRemoveChoice(null)}
        >
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 id="shared-bar-remove-title">
              {removeChoice.member.name.trim() || "This bar"}
            </h3>
            <p>
              Remove from group keeps this bar as its own venue. Delete bar
              removes the venue permanently.
            </p>
            <div className="confirm-dialog-actions">
              <button type="button" onClick={() => setRemoveChoice(null)}>
                Cancel
              </button>
              <button type="button" onClick={() => void confirmRemoveFromGroup()}>
                Remove from group
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => void confirmDeleteSharedBar()}
              >
                Delete bar
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteTarget && (
        <ConfirmDeleteDialog
          title="Delete venue?"
          titleId="venue-delete-title"
          message={
            <>
              Are you sure you want to delete{" "}
              <strong>{deleteTarget.name}</strong>? This cannot be undone.
            </>
          }
          confirmLabel="Delete venue"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  );
}
