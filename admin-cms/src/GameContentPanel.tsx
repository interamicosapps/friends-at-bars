import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabase";

type CatalogGame = {
  game_key: string;
  title: string;
  sort_order: number;
  enabled_in_test: boolean;
  enabled_in_production: boolean;
  has_details: boolean;
};

type ContentRow = {
  id: string;
  game_key: string;
  pack_key: string;
  payload: unknown;
  is_active: boolean;
};

type WordBuckets = {
  fourLetter: string[];
  fiveLetter: string[];
  sixLetter: string[];
  sevenLetter: string[];
};

type OverlayPayload = {
  schema: 2;
  extras: WordBuckets;
  bans: string[];
};

const EMPTY_BUCKETS: WordBuckets = {
  fourLetter: [],
  fiveLetter: [],
  sixLetter: [],
  sevenLetter: [],
};

function emptyOverlay(): OverlayPayload {
  return {
    schema: 2,
    extras: { ...EMPTY_BUCKETS, fourLetter: [], fiveLetter: [], sixLetter: [], sevenLetter: [] },
    bans: [],
  };
}

function normalizeWord(raw: string): string | null {
  const w = raw.trim().toLowerCase();
  if (!/^[a-z]{4,7}$/.test(w)) return null;
  return w;
}

function parseWordText(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[\n,]+/)) {
    const w = normalizeWord(part);
    if (!w || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

function wordsToText(words: string[]): string {
  return words.join("\n");
}

function bucketExtras(words: string[]): WordBuckets {
  const buckets: WordBuckets = {
    fourLetter: [],
    fiveLetter: [],
    sixLetter: [],
    sevenLetter: [],
  };
  for (const w of words) {
    if (w.length === 4) buckets.fourLetter.push(w);
    else if (w.length === 5) buckets.fiveLetter.push(w);
    else if (w.length === 6) buckets.sixLetter.push(w);
    else if (w.length === 7) buckets.sevenLetter.push(w);
  }
  return buckets;
}

function flattenBuckets(b: WordBuckets): string[] {
  return [...b.fourLetter, ...b.fiveLetter, ...b.sixLetter, ...b.sevenLetter];
}

function parseOverlay(payload: unknown): OverlayPayload {
  const base = emptyOverlay();
  if (!payload || typeof payload !== "object") return base;
  const p = payload as Record<string, unknown>;

  if (p.schema === 2 || p.extras || Array.isArray(p.bans)) {
    const extrasRaw = (p.extras as WordBuckets | undefined) ?? EMPTY_BUCKETS;
    return {
      schema: 2,
      extras: {
        fourLetter: [...(extrasRaw.fourLetter ?? [])],
        fiveLetter: [...(extrasRaw.fiveLetter ?? [])],
        sixLetter: [...(extrasRaw.sixLetter ?? [])],
        sevenLetter: [...(extrasRaw.sevenLetter ?? [])],
      },
      bans: Array.isArray(p.bans) ? [...(p.bans as string[])] : [],
    };
  }

  // Legacy full pack → treat top-level buckets as extras so editors can trim/migrate.
  const legacy: WordBuckets = {
    fourLetter: Array.isArray(p.fourLetter) ? [...(p.fourLetter as string[])] : [],
    fiveLetter: Array.isArray(p.fiveLetter) ? [...(p.fiveLetter as string[])] : [],
    sixLetter: Array.isArray(p.sixLetter) ? [...(p.sixLetter as string[])] : [],
    sevenLetter: Array.isArray(p.sevenLetter) ? [...(p.sevenLetter as string[])] : [],
  };
  if (flattenBuckets(legacy).length) {
    return { schema: 2, extras: legacy, bans: [] };
  }
  return base;
}

export function GameContentPanel() {
  const [games, setGames] = useState<CatalogGame[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  /** Details editor is closed until the user clicks Details (avoids “nothing happened”). */
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [content, setContent] = useState<ContentRow | null>(null);
  const [extrasText, setExtrasText] = useState("");
  const [bansText, setBansText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const detailsRef = useRef<HTMLFormElement | null>(null);

  const selected = useMemo(
    () => games.find((g) => g.game_key === selectedKey) ?? null,
    [games, selectedKey]
  );

  const showSwitchSearchDetails =
    detailsOpen &&
    selected?.game_key === "switch-search" &&
    Boolean(selected.has_details);

  const loadGames = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("catalog_games")
      .select("*")
      .order("sort_order", { ascending: true });
    if (err) {
      setError(
        err.message.includes("catalog_games")
          ? `${err.message} — run supabase/catalog_games.sql in the Supabase SQL editor.`
          : err.message
      );
      return;
    }
    setError(null);
    const rows = (data ?? []) as CatalogGame[];
    setGames(rows);
    setSelectedKey((prev) => {
      if (prev && rows.some((r) => r.game_key === prev)) return prev;
      // Highlight first row, but do not auto-open details.
      return rows[0]?.game_key ?? null;
    });
  }, []);

  const loadSwitchSearchDetails = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("catalog_game_content")
      .select("*")
      .eq("game_key", "switch-search")
      .eq("pack_key", "default")
      .maybeSingle();
    if (err) {
      setError(err.message);
      return;
    }
    const row = (data as ContentRow | null) ?? null;
    setContent(row);
    const overlay = parseOverlay(row?.payload);
    const extrasFlat = flattenBuckets(overlay.extras);
    setExtrasText(wordsToText(extrasFlat));
    setBansText(wordsToText(overlay.bans));
  }, []);

  useEffect(() => {
    void loadGames();
  }, [loadGames]);

  useEffect(() => {
    if (showSwitchSearchDetails) {
      void loadSwitchSearchDetails();
    } else if (!detailsOpen) {
      setContent(null);
    }
  }, [
    selectedKey,
    selected?.has_details,
    detailsOpen,
    showSwitchSearchDetails,
    loadSwitchSearchDetails,
  ]);

  useEffect(() => {
    if (!showSwitchSearchDetails) return;
    // Wait a tick so the form is in the DOM, then scroll it into view.
    const id = window.setTimeout(() => {
      detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
    return () => window.clearTimeout(id);
  }, [showSwitchSearchDetails]);

  function openDetails(game: CatalogGame) {
    setSelectedKey(game.game_key);
    setDetailsOpen(true);
    if (!game.has_details) {
      setStatus(`${game.title} has no detail editor yet.`);
    } else if (game.game_key !== "switch-search") {
      setStatus(`No detail editor wired for ${game.title} yet.`);
    } else {
      setStatus(null);
    }
  }

  async function toggleFlag(
    gameKey: string,
    field: "enabled_in_test" | "enabled_in_production",
    value: boolean
  ) {
    setError(null);
    setStatus(null);
    const { error: err } = await supabase
      .from("catalog_games")
      .update({ [field]: value })
      .eq("game_key", gameKey);
    if (err) {
      setError(err.message);
      return;
    }
    setGames((prev) =>
      prev.map((g) => (g.game_key === gameKey ? { ...g, [field]: value } : g))
    );
  }

  async function saveSwitchSearchDetails(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setStatus(null);
    const extrasWords = parseWordText(extrasText);
    const banWords = parseWordText(bansText);
    const invalidExtras = extrasText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !normalizeWord(s));
    const invalidBans = bansText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !normalizeWord(s));
    if (invalidExtras.length || invalidBans.length) {
      setError(
        `Only 4–7 letter a–z words allowed. Skipped/invalid: ${[
          ...invalidExtras,
          ...invalidBans,
        ]
          .slice(0, 8)
          .join(", ")}`
      );
      setSaving(false);
      return;
    }

    const payload: OverlayPayload = {
      schema: 2,
      extras: bucketExtras(extrasWords),
      bans: banWords,
    };

    const body = {
      game_key: "switch-search",
      pack_key: "default",
      payload,
      is_active: true,
    };

    const { error: err } = content?.id
      ? await supabase.from("catalog_game_content").update(body).eq("id", content.id)
      : await supabase
          .from("catalog_game_content")
          .upsert(body, { onConflict: "game_key,pack_key" });

    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setStatus(
      `Saved Switch Search overlay — ${extrasWords.length} extras, ${banWords.length} bans.`
    );
    await loadSwitchSearchDetails();
  }

  return (
    <div className="games-cms">
      <h2>Games</h2>
      <p className="muted" style={{ maxWidth: 720, marginTop: 0 }}>
        Toggle which games appear in the app hubs. Test Mode builds use the Test
        column; production builds use Production. Switch Search details edit CMS
        extras/bans on top of the large English word base bundled in the apps.
      </p>

      {error && <p className="error">{error}</p>}
      {status && <p className="muted">{status}</p>}

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Game</th>
              <th>Test</th>
              <th>Production</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {games.map((g) => (
              <tr
                key={g.game_key}
                className={selectedKey === g.game_key ? "row-selected" : undefined}
              >
                <td>
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => {
                      setSelectedKey(g.game_key);
                      setDetailsOpen(false);
                    }}
                  >
                    {g.title}
                  </button>
                  <div className="muted" style={{ fontSize: "0.8rem" }}>
                    {g.game_key}
                    {g.has_details ? "" : " · no details"}
                  </div>
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={g.enabled_in_test}
                    onChange={(e) =>
                      void toggleFlag(g.game_key, "enabled_in_test", e.target.checked)
                    }
                    aria-label={`${g.title} test`}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={g.enabled_in_production}
                    onChange={(e) =>
                      void toggleFlag(
                        g.game_key,
                        "enabled_in_production",
                        e.target.checked
                      )
                    }
                    aria-label={`${g.title} production`}
                  />
                </td>
                <td>
                  {g.has_details ? (
                    <button type="button" onClick={() => openDetails(g)}>
                      Details
                    </button>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
            {!games.length && (
              <tr>
                <td colSpan={4} className="muted">
                  No games yet. Run <code>supabase/catalog_games.sql</code>.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showSwitchSearchDetails && (
        <form
          ref={detailsRef}
          id="switch-search-details"
          className="grid switch-search-details"
          onSubmit={saveSwitchSearchDetails}
        >
          <h3 className="full" style={{ marginBottom: 0 }}>
            Switch Search — word extras & bans
          </h3>
          <p className="muted full" style={{ maxWidth: 720, marginTop: 0 }}>
            Apps ship a large bundled English base (~6k words, 4–7 letters). CMS
            only stores overlays: <code>extras</code> are added; <code>bans</code>{" "}
            are removed. Active set = bundled ∪ extras − bans.
          </p>
          <label className="full">
            Extras (one word per line or comma-separated)
            <textarea
              rows={10}
              value={extrasText}
              onChange={(e) => setExtrasText(e.target.value)}
              placeholder={"campus\nfriday\ntailgate"}
              style={{ fontFamily: "ui-monospace, monospace" }}
            />
          </label>
          <label className="full">
            Bans (removed from the active set)
            <textarea
              rows={8}
              value={bansText}
              onChange={(e) => setBansText(e.target.value)}
              placeholder={"word\nto\nremove"}
              style={{ fontFamily: "ui-monospace, monospace" }}
            />
          </label>
          <label className="full">
            <div className="row-actions">
              <button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save Switch Search details"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setExtrasText("");
                  setBansText("");
                }}
              >
                Clear fields
              </button>
              <button
                type="button"
                onClick={() => setDetailsOpen(false)}
              >
                Close
              </button>
            </div>
          </label>
        </form>
      )}

      {detailsOpen && selected && !selected.has_details && (
        <p className="muted" style={{ marginTop: "1.25rem" }}>
          No detail editor for <strong>{selected.title}</strong> yet — visibility
          toggles above are enough for now.
        </p>
      )}
    </div>
  );
}
