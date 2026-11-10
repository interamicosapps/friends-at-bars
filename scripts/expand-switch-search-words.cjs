/**
 * Expand bundled Switch Search word base from common English lists + existing JSON.
 * Writes src/data/wordLibrary.json and copies to native Resources.
 *
 * Usage: node scripts/expand-switch-search-words.cjs
 * Optional env:
 *   GOOGLE_10K=path  mnemonic=path
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "src/data/wordLibrary.json");
const NATIVE = path.join(
  ROOT,
  "native/ios/BarFest/BarFest/Resources/wordLibrary.json"
);

function normalize(raw) {
  const w = String(raw).trim().toLowerCase();
  if (!/^[a-z]{4,7}$/.test(w)) return null;
  return w;
}

function addWords(set, source) {
  for (const raw of source) {
    const w = normalize(raw);
    if (w) set.add(w);
  }
}

function parseWhitespaceWords(text) {
  return text.split(/\s+/).filter(Boolean);
}

function loadExisting() {
  const set = new Set();
  if (!fs.existsSync(OUT)) return set;
  const lib = JSON.parse(fs.readFileSync(OUT, "utf8"));
  for (const key of ["fourLetter", "fiveLetter", "sixLetter", "sevenLetter"]) {
    addWords(set, lib[key] || []);
  }
  return set;
}

function loadFileWords(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf8");
  // Skip comment / header lines for mnemonic-style files
  const lines = text.split(/\r?\n/).filter((line) => {
    const t = line.trim();
    if (!t) return false;
    if (t.startsWith("taken from")) return false;
    if (t.startsWith("These ")) return false;
    if (t.startsWith("Wordlist")) return false;
    if (t.startsWith("phonetically")) return false;
    if (t.startsWith("and also")) return false;
    return true;
  });
  return parseWhitespaceWords(lines.join("\n"));
}

const words = loadExisting();
const googlePath =
  process.env.GOOGLE_10K || path.join(os.tmpdir(), "google-10k.txt");
const mnemonicPath =
  process.env.MNEMONIC || path.join(os.tmpdir(), "mnemonic-words.txt");

addWords(words, loadFileWords(googlePath));
addWords(words, loadFileWords(mnemonicPath));

const buckets = {
  fourLetter: [],
  fiveLetter: [],
  sixLetter: [],
  sevenLetter: [],
};

for (const w of [...words].sort()) {
  if (w.length === 4) buckets.fourLetter.push(w);
  else if (w.length === 5) buckets.fiveLetter.push(w);
  else if (w.length === 6) buckets.sixLetter.push(w);
  else if (w.length === 7) buckets.sevenLetter.push(w);
}

fs.writeFileSync(OUT, JSON.stringify(buckets, null, 2) + "\n");
fs.mkdirSync(path.dirname(NATIVE), { recursive: true });
fs.copyFileSync(OUT, NATIVE);

console.log("expanded wordLibrary:", {
  fourLetter: buckets.fourLetter.length,
  fiveLetter: buckets.fiveLetter.length,
  sixLetter: buckets.sixLetter.length,
  sevenLetter: buckets.sevenLetter.length,
  total:
    buckets.fourLetter.length +
    buckets.fiveLetter.length +
    buckets.sixLetter.length +
    buckets.sevenLetter.length,
});
