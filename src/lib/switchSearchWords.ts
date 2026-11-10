import bundled from "@/data/wordLibrary.json";

export type WordBuckets = {
  fourLetter: string[];
  fiveLetter: string[];
  sixLetter: string[];
  sevenLetter: string[];
};

export type SwitchSearchOverlay = {
  schema?: number;
  extras?: Partial<WordBuckets>;
  bans?: string[];
  /** Legacy full-pack fields (pre-schema-2). */
  fourLetter?: string[];
  fiveLetter?: string[];
  sixLetter?: string[];
  sevenLetter?: string[];
  words?: string[];
};

const EMPTY: WordBuckets = {
  fourLetter: [],
  fiveLetter: [],
  sixLetter: [],
  sevenLetter: [],
};

function normalizeWord(raw: string): string | null {
  const w = raw.trim().toLowerCase();
  if (!/^[a-z]{4,7}$/.test(w)) return null;
  return w;
}

function cleanList(words: string[] | undefined): string[] {
  if (!words?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of words) {
    const w = normalizeWord(raw);
    if (!w || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

function bucketByLength(words: string[]): WordBuckets {
  const buckets: WordBuckets = {
    fourLetter: [],
    fiveLetter: [],
    sixLetter: [],
    sevenLetter: [],
  };
  for (const raw of words) {
    const w = normalizeWord(raw);
    if (!w) continue;
    if (w.length === 4) buckets.fourLetter.push(w);
    else if (w.length === 5) buckets.fiveLetter.push(w);
    else if (w.length === 6) buckets.sixLetter.push(w);
    else buckets.sevenLetter.push(w);
  }
  return buckets;
}

function unionBucket(a: string[], b: string[]): string[] {
  const seen = new Set(a);
  const out = [...a];
  for (const w of b) {
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

function subtractBanned(words: string[], bans: Set<string>): string[] {
  if (!bans.size) return words;
  return words.filter((w) => !bans.has(w));
}

export function emptyWordBuckets(): WordBuckets {
  return { ...EMPTY, fourLetter: [], fiveLetter: [], sixLetter: [], sevenLetter: [] };
}

export function loadBundledWordLibrary(): WordBuckets {
  return {
    fourLetter: cleanList(bundled.fourLetter),
    fiveLetter: cleanList(bundled.fiveLetter),
    sixLetter: cleanList(bundled.sixLetter),
    sevenLetter: cleanList(bundled.sevenLetter),
  };
}

/**
 * Resolve active Switch Search words.
 * schema 2 / extras / bans → bundled ∪ extras − bans
 * legacy bucket payload (no schema) → full replacement
 */
export function resolveActiveWordLibrary(
  payload: unknown,
  base: WordBuckets = loadBundledWordLibrary()
): WordBuckets {
  if (payload == null) return base;

  if (Array.isArray(payload)) {
    const buckets = bucketByLength(payload as string[]);
    const n =
      buckets.fourLetter.length +
      buckets.fiveLetter.length +
      buckets.sixLetter.length +
      buckets.sevenLetter.length;
    return n ? buckets : base;
  }

  if (typeof payload !== "object") return base;
  const p = payload as SwitchSearchOverlay;
  const bans = new Set(cleanList(p.bans));
  const isOverlay =
    p.schema === 2 || p.extras != null || Object.prototype.hasOwnProperty.call(p, "bans");

  if (isOverlay) {
    const extras = p.extras ?? emptyWordBuckets();
    return {
      fourLetter: subtractBanned(
        unionBucket(base.fourLetter, cleanList(extras.fourLetter)),
        bans
      ),
      fiveLetter: subtractBanned(
        unionBucket(base.fiveLetter, cleanList(extras.fiveLetter)),
        bans
      ),
      sixLetter: subtractBanned(
        unionBucket(base.sixLetter, cleanList(extras.sixLetter)),
        bans
      ),
      sevenLetter: subtractBanned(
        unionBucket(base.sevenLetter, cleanList(extras.sevenLetter)),
        bans
      ),
    };
  }

  const four = cleanList(p.fourLetter);
  const five = cleanList(p.fiveLetter);
  const six = cleanList(p.sixLetter);
  const seven = cleanList(p.sevenLetter);
  if (four.length || five.length || six.length || seven.length) {
    return { fourLetter: four, fiveLetter: five, sixLetter: six, sevenLetter: seven };
  }

  if (p.words?.length) return bucketByLength(p.words);
  return base;
}

export function countWords(lib: WordBuckets): number {
  return (
    lib.fourLetter.length +
    lib.fiveLetter.length +
    lib.sixLetter.length +
    lib.sevenLetter.length
  );
}

export function parseExtrasText(text: string): string[] {
  return cleanList(
    text
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

export function emptyOverlayPayload() {
  return {
    schema: 2 as const,
    extras: {
      fourLetter: [] as string[],
      fiveLetter: [] as string[],
      sixLetter: [] as string[],
      sevenLetter: [] as string[],
    },
    bans: [] as string[],
  };
}
