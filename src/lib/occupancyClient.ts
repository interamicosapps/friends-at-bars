/**
 * Hybrid occupancy MVP: HTTPS heartbeat + polled GET /counts.
 */
import type { VenueCounts } from "@/types/checkin";
import { supabase } from "@/lib/supabaseClient";

const baseUrl = (): string =>
  (
    typeof import.meta !== "undefined"
      ? (import.meta.env?.VITE_OCCUPANCY_API_URL as string | undefined)
      : undefined
  )
    ?.trim()
    .replace(/\/$/, "") ?? "";

/** True when occupancy API URL is set (staging/prod). */
export function isOccupancyApiConfigured(): boolean {
  return baseUrl().length > 0;
}

export function isOccupancyComparisonEnabled(): boolean {
  const c =
    typeof import.meta !== "undefined"
      ? (import.meta.env?.VITE_OCCUPANCY_COMPARISON as string | undefined)
      : "";
  const v = String(c ?? "").trim().toLowerCase();
  return isOccupancyApiConfigured() && (v === "1" || v === "true");
}

const DEFAULT_POLL_MS = 22_000;

let occDebugLoggedFirstCountsOk = false;
let occDebugLoggedViteProxy500 = false;

/** When using VITE_OCCUPANCY_API_URL=/api/occupancy, HTTP 5xx from Vite usually means ECONNREFUSED to 8787. */
function logViteOccupancyProxyProbablyDown(
  root: string,
  status: number,
  methodAndPath: string
) {
  if (!import.meta.env.DEV) return;
  if (root !== "/api/occupancy" || status < 500) return;
  if (occDebugLoggedViteProxy500) return;
  occDebugLoggedViteProxy500 = true;
  console.warn(
    `[BarFest occ debug] ${methodAndPath} → HTTP ${status} (via Vite proxy → 127.0.0.1:8787)`
  );
  console.info(
    "[BarFest occ debug] Most likely: occupancy-service is not running on port 8787, or its process crashed (check Upstash env in occupancy-service/.env)."
  );
  console.info(
    "[BarFest occ debug] In the Vite terminal you should see `[Vite occupancy proxy] ... ECONNREFUSED` when this happens."
  );
  console.info(
    "[BarFest occ fix] Repo root: npm run dev:with-occupancy   OR   second terminal: cd occupancy-service && npm run dev"
  );
}

async function occupancyHeaders(extra?: HeadersInit): Promise<HeadersInit> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) {
      h.Authorization = `Bearer ${token}`;
      return { ...h, ...extra };
    }
  } catch {
    /* ignore */
  }
  return { ...h, ...extra };
}

export async function fetchOccupancyCounts(): Promise<VenueCounts | null> {
  const root = baseUrl();
  if (!root) {
    if (import.meta.env.DEV) {
      console.info(
        "[BarFest occ debug] fetchOccupancyCounts: skip (no VITE_OCCUPANCY_API_URL)"
      );
    }
    return null;
  }
  try {
    const headers = await occupancyHeaders();
    const hasAuth = Boolean(
      typeof headers === "object" &&
        headers !== null &&
        "Authorization" in headers &&
        (headers as Record<string, string>).Authorization
    );
    if (import.meta.env.DEV) {
      console.debug("[BarFest occ debug] GET /counts request", root, {
        hasAuthHeader: hasAuth,
      });
    }
    const res = await fetch(`${root}/counts`, { headers });
    if (!res.ok) {
      console.warn("[BarFest occupancy] GET /counts", res.status);
      logViteOccupancyProxyProbablyDown(root, res.status, "GET /counts");
      if (import.meta.env.DEV) {
        console.info("[BarFest occ debug] GET /counts response not OK", {
          status: res.status,
          url: `${root}/counts`,
        });
      }
      return {};
    }
    const body = (await res.json()) as Record<string, unknown>;
    const countsRaw = body.counts;
    if (!countsRaw || typeof countsRaw !== "object") {
      if (import.meta.env.DEV) {
        console.info("[BarFest occ debug] GET /counts: body.counts missing", {
          bodyKeys: Object.keys(body),
        });
      }
      return {};
    }
    const out: VenueCounts = {};
    for (const [k, v] of Object.entries(countsRaw)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) out[k] = n;
    }
    if (import.meta.env.DEV) {
      const positive = Object.entries(out).filter(([, n]) => n > 0);
      const payload = {
        venueKeys: Object.keys(out),
        positiveCount: positive.length,
        positive,
      };
      if (!occDebugLoggedFirstCountsOk) {
        occDebugLoggedFirstCountsOk = true;
        console.info("[BarFest occ debug] GET /counts first OK", payload);
      } else {
        console.debug("[BarFest occ debug] GET /counts OK", payload);
      }
    }
    return out;
  } catch (e) {
    console.warn("[BarFest occupancy] fetch counts failed", e);
    if (import.meta.env.DEV) {
      const remote =
        /\b(https?:\/\/)?(127\.0\.0\.1|localhost)(:8787)?\b/i.test(`${root}`)
          ? " On a physical device, localhost/127.0.0.1 points at that device → use VITE_OCCUPANCY_API_URL=/api/occupancy and open the dev site from the PC hosting Vite."
          : "";
      console.info(
        `[BarFest occ debug] GET /counts network error → hybrid counts stay empty.${remote} Confirm occupancy-service listens on PORT 8787 and restart Vite after env changes.`,
        e
      );
    }
    return {};
  }
}

export async function sendOccupancyHeartbeat(
  latitude: number,
  longitude: number,
  deviceUserId: string
): Promise<void> {
  const root = baseUrl();
  if (!root) return;
  const headers = await occupancyHeaders();
  const res = await fetch(`${root}/heartbeat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      latitude,
      longitude,
      deviceUserId,
    }),
  });
  if (!res.ok) {
    if (import.meta.env.DEV && res.status === 401) {
      console.info(
        "[BarFest occ debug] POST /heartbeat 401 — counts may stay 0 (check JWT or OCCUPANCY_ALLOW_ANON_DEVICE_ID + anon device id)"
      );
    } else if (res.status !== 401) {
      logViteOccupancyProxyProbablyDown(root, res.status, "POST /heartbeat");
      console.warn("[BarFest occupancy] heartbeat", res.status);
    }
  }
}

export async function leaveOccupancy(deviceUserId: string): Promise<void> {
  const root = baseUrl();
  if (!root) return;
  const headers = await occupancyHeaders();
  const res = await fetch(`${root}/leave`, {
    method: "POST",
    headers,
    body: JSON.stringify({ deviceUserId }),
  });
  if (!res.ok && res.status !== 401) {
    logViteOccupancyProxyProbablyDown(root, res.status, "POST /leave");
    console.warn("[BarFest occupancy] leave", res.status);
  }
}

export type OccupancySubscriber = () => void;

/** Poll occupancy counts while visible tab; backoff when hidden. */
export function subscribeOccupancyCounts(
  callback: (counts: VenueCounts | null) => void,
  options?: { intervalMs?: number }
): OccupancySubscriber {
  const pollMs = options?.intervalMs ?? DEFAULT_POLL_MS;
  let disposed = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let loggedSubscribe = false;

  const tick = async () => {
    if (disposed) return;
    if (import.meta.env.DEV && !loggedSubscribe) {
      loggedSubscribe = true;
      const rawComp = import.meta.env?.VITE_OCCUPANCY_COMPARISON as
        | string
        | undefined;
      console.info("[BarFest occ debug] subscribeOccupancyCounts: polling", {
        baseUrl: baseUrl() || "(empty)",
        VITE_OCCUPANCY_COMPARISON: rawComp ?? "(unset)",
        comparisonFlagAccepts:
          String(rawComp ?? "")
            .trim()
            .toLowerCase() === "1" ||
          String(rawComp ?? "")
            .trim()
            .toLowerCase() === "true",
        isOccupancyComparisonEnabled: isOccupancyComparisonEnabled(),
      });
    }
    const counts = await fetchOccupancyCounts();
    if (!disposed) callback(counts);
  };

  const schedule = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    void tick();
    const ms =
      typeof document !== "undefined" &&
      document.visibilityState === "hidden"
        ? pollMs * 3
        : pollMs;
    timer = setInterval(() => void tick(), ms);
  };

  schedule();
  const onVis = () => schedule();
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVis);
  }

  return () => {
    disposed = true;
    if (timer !== null) clearInterval(timer);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVis);
    }
  };
}
