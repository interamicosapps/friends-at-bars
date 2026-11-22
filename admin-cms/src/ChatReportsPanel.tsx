import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";

type ModerationStatus = "none" | "reviewed_ok" | "removed";

type ChatReportRow = {
  id: string;
  post_id: string;
  reporter_id: string;
  reason: string | null;
  created_at: string;
};

type ChatPostRow = {
  id: string;
  body: string;
  venue_name: string;
  created_at: string;
  is_hidden: boolean;
  moderation_status: ModerationStatus;
  parent_id: string | null;
  expires_at: string;
};

type ReportGroup = {
  post: ChatPostRow;
  reportCount: number;
  reasons: string[];
  latestReportAt: string;
};

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function ChatReportsPanel() {
  const [groups, setGroups] = useState<ReportGroup[]>([]);
  const [words, setWords] = useState<string[]>([]);
  const [newWord, setNewWord] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [wordBusy, setWordBusy] = useState(false);

  const load = useCallback(async () => {
    const [rRes, wRes] = await Promise.all([
      supabase
        .from("chat_reports")
        .select("id, post_id, reporter_id, reason, created_at")
        .order("created_at", { ascending: false })
        .limit(1000),
      supabase.from("chat_blocked_words").select("word").order("word"),
    ]);

    if (rRes.error) {
      setError(
        rRes.error.message.includes("chat_reports")
          ? `${rRes.error.message} — run supabase/chat_moderation.sql`
          : rRes.error.message
      );
      return;
    }
    if (wRes.error) {
      setError(
        wRes.error.message.includes("chat_blocked_words")
          ? `${wRes.error.message} — run supabase/chat_moderation.sql`
          : wRes.error.message
      );
      return;
    }

    const reports = (rRes.data ?? []) as ChatReportRow[];
    setWords(((wRes.data ?? []) as { word: string }[]).map((r) => r.word));

    const byPost = new Map<
      string,
      { count: number; reasons: string[]; latest: string }
    >();
    for (const report of reports) {
      const existing = byPost.get(report.post_id) ?? {
        count: 0,
        reasons: [],
        latest: report.created_at,
      };
      existing.count += 1;
      if (report.reason && !existing.reasons.includes(report.reason)) {
        existing.reasons.push(report.reason);
      }
      if (report.created_at > existing.latest) {
        existing.latest = report.created_at;
      }
      byPost.set(report.post_id, existing);
    }

    const postIds = Array.from(byPost.keys());
    if (postIds.length === 0) {
      setError(null);
      setGroups([]);
      return;
    }

    const pRes = await supabase.from("chat_posts").select("*").in("id", postIds);
    if (pRes.error) {
      setError(pRes.error.message);
      return;
    }

    const posts = (pRes.data ?? []) as ChatPostRow[];
    const next: ReportGroup[] = posts
      .map((post) => {
        const agg = byPost.get(post.id)!;
        return {
          post: {
            ...post,
            moderation_status: (post.moderation_status ??
              "none") as ModerationStatus,
          },
          reportCount: agg.count,
          reasons: agg.reasons,
          latestReportAt: agg.latest,
        };
      })
      .sort((a, b) => b.latestReportAt.localeCompare(a.latestReportAt));

    setError(null);
    setGroups(next);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    return groups.filter((g) => {
      if (!statusFilter) return true;
      return g.post.moderation_status === statusFilter;
    });
  }, [groups, statusFilter]);

  async function setModeration(
    postId: string,
    status: "reviewed_ok" | "removed"
  ) {
    setBusyId(postId);
    setError(null);
    const { error: err } = await supabase.rpc("admin_set_post_moderation", {
      p_post_id: postId,
      p_status: status,
    });
    setBusyId(null);
    if (err) {
      setError(err.message);
      return;
    }
    setGroups((prev) =>
      prev.map((g) =>
        g.post.id === postId
          ? {
              ...g,
              post: {
                ...g.post,
                moderation_status: status,
                is_hidden: status === "removed",
              },
            }
          : g
      )
    );
  }

  async function addWord(e: React.FormEvent) {
    e.preventDefault();
    const word = newWord.trim().toLowerCase();
    if (!word) return;
    setWordBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from("chat_blocked_words")
      .insert({ word });
    setWordBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setNewWord("");
    setWords((prev) => Array.from(new Set([...prev, word])).sort());
  }

  async function removeWord(word: string) {
    setWordBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from("chat_blocked_words")
      .delete()
      .eq("word", word);
    setWordBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setWords((prev) => prev.filter((w) => w !== word));
  }

  return (
    <div className="catalog-feedback-panel">
      <div className="listings-toolbar mock-attendance-toolbar">
        <label>
          Moderation
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All reported</option>
            <option value="none">none</option>
            <option value="reviewed_ok">reviewed_ok</option>
            <option value="removed">removed</option>
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
        Posts with at least one report. Remove hides the post (and its
        replies). Keep restores visibility and blocks auto-hide from further
        reports or −4 votes until status changes.
      </p>

      {error && <p className="error">{error}</p>}

      <div className="table-scroll">
        <table className="catalog-feedback-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Post</th>
              <th>Reports</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No reported posts for this filter.
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr
                  key={row.post.id}
                  className={
                    row.post.moderation_status === "none" ? "row-new" : undefined
                  }
                >
                  <td className="feedback-when">
                    {formatWhen(row.post.created_at)}
                    <div className="muted">
                      last report {formatWhen(row.latestReportAt)}
                    </div>
                  </td>
                  <td className="feedback-message">
                    <div>{row.post.body}</div>
                    <div className="feedback-context muted">
                      {row.post.venue_name
                        ? `Bar: ${row.post.venue_name}`
                        : "No bar tag"}
                      {row.post.parent_id ? " · reply" : ""}
                      {row.post.is_hidden ? " · hidden" : ""}
                    </div>
                  </td>
                  <td>
                    <strong>{row.reportCount}</strong>
                    {row.reasons.length > 0 && (
                      <div className="feedback-context">
                        {row.reasons.join(" · ")}
                      </div>
                    )}
                  </td>
                  <td>
                    <code>{row.post.moderation_status}</code>
                  </td>
                  <td>
                    <div className="mock-attendance-actions">
                      <button
                        type="button"
                        disabled={busyId === row.post.id}
                        onClick={() =>
                          void setModeration(row.post.id, "removed")
                        }
                      >
                        Remove
                      </button>
                      <button
                        type="button"
                        disabled={busyId === row.post.id}
                        onClick={() =>
                          void setModeration(row.post.id, "reviewed_ok")
                        }
                      >
                        Keep
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <section className="listing-card" style={{ marginTop: "1.25rem" }}>
        <h3 style={{ margin: "0 0 0.5rem" }}>Blocked words</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Whole-word, case-insensitive filter on new posts and replies.
        </p>
        <form
          onSubmit={(e) => void addWord(e)}
          style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}
        >
          <input
            value={newWord}
            onChange={(e) => setNewWord(e.target.value)}
            placeholder="Add word…"
            disabled={wordBusy}
          />
          <button type="submit" disabled={wordBusy || !newWord.trim()}>
            Add
          </button>
        </form>
        {words.length === 0 ? (
          <p className="muted">No blocked words yet.</p>
        ) : (
          <ul style={{ margin: "0.75rem 0 0", paddingLeft: "1.1rem" }}>
            {words.map((word) => (
              <li
                key={word}
                style={{
                  display: "flex",
                  gap: "0.75rem",
                  alignItems: "center",
                  marginBottom: "0.35rem",
                }}
              >
                <code>{word}</code>
                <button
                  type="button"
                  disabled={wordBusy}
                  onClick={() => void removeWord(word)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
