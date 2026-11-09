import { supabase, isSupabaseNetworkError, logSupabaseNetworkOnce } from "@/lib/supabaseClient";
import { locationService } from "@/lib/locationService";
import { getRankedPlayDateEastern } from "./playDate";
import type {
  RankedDailyScoreRow,
  RankedGameType,
  RankedLeaderboardEntry,
  RankedSubmitPayload,
} from "./types";

function sortLeaderboard(
  gameType: RankedGameType,
  rows: RankedDailyScoreRow[]
): RankedDailyScoreRow[] {
  const copy = [...rows];
  if (gameType === "switch-search") {
    copy.sort((a, b) => {
      const wa = a.words_found ?? 0;
      const wb = b.words_found ?? 0;
      if (wb !== wa) return wb - wa;
      return (b.time_left ?? 0) - (a.time_left ?? 0);
    });
  } else if (gameType === "boozed") {
    copy.sort((a, b) => {
      const pa = a.score_points ?? 0;
      const pb = b.score_points ?? 0;
      if (pb !== pa) return pb - pa;
      return (
        new Date(a.finished_at).getTime() - new Date(b.finished_at).getTime()
      );
    });
  } else {
    copy.sort((a, b) => {
      const ca = a.completed === true ? 1 : 0;
      const cb = b.completed === true ? 1 : 0;
      if (cb !== ca) return cb - ca;
      const da = a.drink_count ?? 999;
      const db = b.drink_count ?? 999;
      if (da !== db) return da - db;
      return (
        new Date(a.finished_at).getTime() - new Date(b.finished_at).getTime()
      );
    });
  }
  return copy;
}

export async function resolveVenueForRanked(): Promise<string | null> {
  const loc = await locationService.getCurrentLocation();
  if (!loc) return null;
  return locationService.getVenueNameIfAtVenue(loc.latitude, loc.longitude);
}

export async function hasPlayedRankedToday(
  gameType: RankedGameType,
  userId: string
): Promise<boolean> {
  const playDate = getRankedPlayDateEastern();
  const { data, error } = await supabase
    .from("ranked_daily_scores")
    .select("id")
    .eq("game_type", gameType)
    .eq("user_id", userId)
    .eq("play_date", playDate)
    .maybeSingle();

  if (error) {
    if (isSupabaseNetworkError(error)) {
      logSupabaseNetworkOnce(error);
      return false;
    }
    console.error("hasPlayedRankedToday", error);
    return false;
  }
  return data != null;
}

export async function fetchLeaderboardToday(
  gameType: RankedGameType
): Promise<RankedLeaderboardEntry[]> {
  const playDate = getRankedPlayDateEastern();
  const { data, error } = await supabase
    .from("ranked_daily_scores")
    .select("*")
    .eq("game_type", gameType)
    .eq("play_date", playDate);

  if (error) {
    if (isSupabaseNetworkError(error)) {
      logSupabaseNetworkOnce(error);
      return [];
    }
    console.error("fetchLeaderboardToday", error);
    return [];
  }

  const sorted = sortLeaderboard(gameType, (data ?? []) as RankedDailyScoreRow[]);
  return sorted.slice(0, 50).map((row, i) => ({ ...row, rank: i + 1 }));
}

export async function submitRankedScore(
  userId: string,
  payload: RankedSubmitPayload
): Promise<{ ok: boolean; error?: string }> {
  const playDate = getRankedPlayDateEastern();
  const finishedAt = new Date().toISOString();

  const row =
    payload.gameType === "switch-search"
      ? {
          user_id: userId,
          game_type: payload.gameType,
          play_date: playDate,
          venue_name: payload.venueName,
          words_found: payload.wordsFound,
          time_left: payload.timeLeft,
          drink_count: null,
          completed: null,
          finished_at: finishedAt,
        }
      : {
          user_id: userId,
          game_type: payload.gameType,
          play_date: playDate,
          venue_name: payload.venueName,
          words_found: null,
          time_left: null,
          drink_count: payload.drinkCount,
          completed: payload.completed,
          finished_at: finishedAt,
        };

  const { error } = await supabase.from("ranked_daily_scores").insert(row);

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "already_played" };
    }
    if (isSupabaseNetworkError(error)) {
      logSupabaseNetworkOnce(error);
      return { ok: false, error: "network" };
    }
    console.error("submitRankedScore", error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export function formatLeaderboardScore(
  gameType: RankedGameType,
  row: RankedDailyScoreRow
): string {
  if (gameType === "switch-search") {
    const w = row.words_found ?? 0;
    const t = row.time_left ?? 0;
    return `${w} word${w === 1 ? "" : "s"} · ${t}s left`;
  }
  if (gameType === "boozed") {
    const p = row.score_points ?? 0;
    return `${p} pt${p === 1 ? "" : "s"} · best cash-out`;
  }
  const d = row.drink_count ?? 0;
  return row.completed
    ? `${d} drink${d === 1 ? "" : "s"} · completed`
    : `${d} drink${d === 1 ? "" : "s"} · incomplete`;
}

export function getMyRank(
  entries: RankedLeaderboardEntry[],
  userId: string
): RankedLeaderboardEntry | null {
  return entries.find((e) => e.user_id === userId) ?? null;
}
