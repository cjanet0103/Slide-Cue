/**
 * Splits a whole pasted script into per-slide scripts, entirely on-device (PRD §4.1).
 * 1. If the script carries slide markers ([1], 슬라이드 1, 1번, …), split on them.
 * 2. Else if it uses " / " separators, split on them in order.
 * 3. Otherwise keep paragraphs in order and place each on the slide whose PDF
 *    text it resembles most, with a gentle pull toward its proportional position.
 */

export type SplitMethod = "markers" | "separator" | "match" | "order";

export interface SplitResult {
  slides: string[];
  method: SplitMethod;
}

interface Marker {
  num: number;
  start: number;
  end: number;
}

// Strongest first. Only [n] may appear mid-line; the rest must start a line.
const INLINE_BRACKET = /\[\s*(\d{1,3})\s*\]/g;
const LINE_PATTERNS: RegExp[] = [
  /^[ \t]*(?:슬라이드|slide|페이지|page)[ \t]*(\d{1,3})[ \t]*[:.)\]-]?[ \t]*/gim,
  /^[ \t]*#[ \t]*(\d{1,3})[ \t]*[:.)]?[ \t]*/gm,
  /^[ \t]*(\d{1,3})[ \t]*(?:번|장|p)[ \t]*[:.)\]-]?[ \t]*/gim,
  /^[ \t]*\([ \t]*(\d{1,3})[ \t]*\)[ \t]*/gm,
  /^[ \t]*(\d{1,3})[ \t]*[.)][ \t]+/gm,
];

function findMarkers(text: string, pattern: RegExp): Marker[] {
  return [...text.matchAll(pattern)].map((m) => ({
    num: Number(m[1]),
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }));
}

function validMarkers(markers: Marker[], pageCount: number): boolean {
  if (markers.length < Math.min(2, pageCount)) return false;
  return markers.every((m, i) => m.num >= 1 && m.num <= pageCount && (i === 0 || m.num >= markers[i - 1].num));
}

function append(slides: string[], index: number, chunk: string) {
  const text = chunk.trim();
  if (!text) return;
  slides[index] = slides[index] ? `${slides[index]}\n${text}` : text;
}

export function splitByMarkers(text: string, pageCount: number): string[] | null {
  for (const pattern of [INLINE_BRACKET, ...LINE_PATTERNS]) {
    const markers = findMarkers(text, pattern);
    if (!validMarkers(markers, pageCount)) continue;
    const slides = Array.from({ length: pageCount }, () => "");
    // Text before the first marker belongs with the first marked slide.
    append(slides, markers[0].num - 1, text.slice(0, markers[0].start));
    markers.forEach((m, i) => {
      const next = markers[i + 1]?.start ?? text.length;
      append(slides, m.num - 1, text.slice(m.end, next));
    });
    return slides;
  }
  return null;
}

export function splitParagraphs(text: string): string[] {
  const byBlank = text
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (byBlank.length > 1) return byBlank;
  return text
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function bigrams(s: string): Set<string> {
  const t = s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

/** Overlap of character bigrams relative to the smaller side (works for Korean and English). */
export function similarity(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  const smaller = Math.min(A.size, B.size);
  if (smaller < 2) return 0;
  let inter = 0;
  A.forEach((g) => {
    if (B.has(g)) inter++;
  });
  return inter / smaller;
}

const POSITION_WEIGHT = 1;

/** Assigns paragraphs (in order) to slides with a monotonic best-score path. */
export function alignParagraphs(paragraphs: string[], slideTexts: string[]): { slides: string[]; usedText: boolean } {
  const m = slideTexts.length;
  const n = paragraphs.length;
  const slides = Array.from({ length: m }, () => "");
  if (n === 0 || m === 0) return { slides, usedText: false };

  const usedText = slideTexts.some((t) => bigrams(t).size >= 2);
  const score = (i: number, j: number) =>
    (usedText ? similarity(paragraphs[i], slideTexts[j]) : 0) -
    POSITION_WEIGHT * Math.abs((i + 0.5) / n - (j + 0.5) / m);

  // dp[i][j]: best total with paragraph i on slide j; from[i][j]: slide of paragraph i-1.
  const dp: number[][] = [];
  const from: number[][] = [];
  for (let i = 0; i < n; i++) {
    dp.push(new Array(m).fill(-Infinity));
    from.push(new Array(m).fill(-1));
    let bestPrev = -Infinity;
    let bestPrevJ = -1;
    for (let j = 0; j < m; j++) {
      if (i > 0 && dp[i - 1][j] > bestPrev) {
        bestPrev = dp[i - 1][j];
        bestPrevJ = j;
      }
      dp[i][j] = score(i, j) + (i === 0 ? 0 : bestPrev);
      from[i][j] = i === 0 ? -1 : bestPrevJ;
    }
  }

  let j = dp[n - 1].indexOf(Math.max(...dp[n - 1]));
  const assigned = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    assigned[i] = j;
    j = from[i][j];
  }
  paragraphs.forEach((p, i) => append(slides, assigned[i], p));
  return { slides, usedText };
}

// A "/" standing alone (whitespace or line edge on both sides): "a / b", or "/" on its own line.
// Slashes inside words ("A/B 테스트", "3/4분기") are not separators.
const SEPARATOR = /(?:^|[ \t\r\n])\/(?=[ \t\r\n]|$)/;

/** Splits on " / " separators; null when the text has none. */
export function splitBySeparator(text: string): string[] | null {
  if (!SEPARATOR.test(text)) return null;
  return text.split(new RegExp(SEPARATOR.source, "g")).map((s) => s.trim());
}

/**
 * Joins per-slide scripts into one text separated by "/" lines, which
 * splitWholeScript reads back. All-empty scripts give "" so the placeholder shows.
 */
export function composeWholeScript(slides: string[]): string {
  if (slides.every((s) => !s.trim())) return "";
  return slides.map((s) => s.trim()).join("\n/\n");
}

export function splitWholeScript(text: string, slideTexts: string[]): SplitResult {
  const pageCount = slideTexts.length;
  const marked = splitByMarkers(text, pageCount);
  if (marked) return { slides: marked, method: "markers" };

  const chunks = splitBySeparator(text);
  if (chunks) {
    if (chunks.length === pageCount) return { slides: chunks, method: "separator" };
    // Count doesn't match the slides: keep chunk order, place them by content.
    const { slides } = alignParagraphs(chunks.filter(Boolean), slideTexts);
    return { slides, method: "separator" };
  }

  const { slides, usedText } = alignParagraphs(splitParagraphs(text), slideTexts);
  return { slides, method: usedText ? "match" : "order" };
}
