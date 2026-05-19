import { isDevTestModeUiEnabled } from "@/config/devTestMode";

export type DiagnosticCategory =
  | "liveLoc"
  | "native"
  | "supabase"
  | "permission"
  | "system";

export type DiagnosticLevel = "info" | "warn" | "error";

export interface DiagnosticEntry {
  id: number;
  ts: number;
  time: string;
  level: DiagnosticLevel;
  category: DiagnosticCategory;
  event: string;
  detail?: Record<string, unknown>;
}

const MAX_ENTRIES = 400;
let nextId = 1;
const entries: DiagnosticEntry[] = [];
const listeners = new Set<() => void>();

export function isDiagnosticLogEnabled(): boolean {
  return (
    isDevTestModeUiEnabled() ||
    import.meta.env.VITE_DEBUG_LIVE_LOCATION === "true"
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  } as Intl.DateTimeFormatOptions);
}

export function appendDiagnosticLog(
  category: DiagnosticCategory,
  event: string,
  detail?: Record<string, unknown>,
  level: DiagnosticLevel = "info"
): void {
  if (!isDiagnosticLogEnabled()) return;

  const entry: DiagnosticEntry = {
    id: nextId++,
    ts: Date.now(),
    time: formatTime(Date.now()),
    level,
    category,
    event,
    detail,
  };

  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }

  listeners.forEach((cb) => {
    try {
      cb();
    } catch {
      /* ignore subscriber errors */
    }
  });
}

export function getDiagnosticEntries(): readonly DiagnosticEntry[] {
  return entries;
}

export function clearDiagnosticLog(): void {
  entries.length = 0;
  listeners.forEach((cb) => cb());
}

export function subscribeDiagnosticLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
