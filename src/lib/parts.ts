/**
 * Presentation parts (PRD F1 파트별 시간, T10): named slide ranges with their
 * own target time. Pure helpers so the rules can be unit-tested.
 * Slide indices are 0-based and inclusive (`from`..`to`); the UI shows 1-based.
 */

export interface Part {
  name: string;
  from: number;
  to: number;
  /** Target for this part, seconds; missing = no target. */
  targetSec?: number;
}

export interface PartIssue {
  /** Problem with the slide range (empty name is allowed). */
  range?: string;
}

/** Per-part problems: range outside the deck, reversed, or overlapping another part. */
export function validateParts(parts: Part[], pageCount: number): PartIssue[] {
  return parts.map((p, i) => {
    if (!Number.isInteger(p.from) || !Number.isInteger(p.to)) return { range: "슬라이드 번호를 입력해 주세요" };
    if (p.from < 0 || p.to >= pageCount) return { range: `1–${pageCount}장 안에서 정해 주세요` };
    if (p.from > p.to) return { range: "시작 장이 끝 장보다 뒤에 있어요" };
    const clash = parts.findIndex((q, j) => j !== i && Number.isInteger(q.from) && Number.isInteger(q.to) && p.from <= q.to && q.from <= p.to);
    if (clash >= 0) return { range: `${withGwa(partLabel(parts[clash], clash))} 장이 겹쳐요` };
    return {};
  });
}

/** "사업화 전략과" / "서비스 소개와": 과 after a final consonant, 와 otherwise. */
export function withGwa(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const final = code >= 0 && code <= 11171 ? code % 28 : /[0-9]$/.test(word) ? -1 : 0;
  // Digits: 1, 3, 6, 7, 8, 0 end in a consonant when read aloud (일, 삼, 육, 칠, 팔, 영).
  const digitFinal = /[136780]$/.test(word);
  return word + (final > 0 || (final === -1 && digitFinal) ? "과" : "와");
}

export const partLabel = (p: Part, index: number) => p.name.trim() || `파트 ${index + 1}`;

/** "1–20장" (1-based). */
export const rangeLabel = (p: Part) => (p.from === p.to ? `${p.from + 1}장` : `${p.from + 1}–${p.to + 1}장`);

/** Sum of the part targets, seconds (null when no part has one). */
export function partTargetSum(parts: Part[]): number | null {
  const withTarget = parts.filter((p) => p.targetSec);
  return withTarget.length ? withTarget.reduce((s, p) => s + (p.targetSec ?? 0), 0) : null;
}

export interface PartResult {
  part: Part;
  index: number;
  /** Time spent on the part's slides (revisits included, as slideMs already sums them). */
  actualMs: number;
  /** Slides of the part that got any time, and how many slides the part has. */
  practiced: number;
  slides: number;
  /** "full": every slide practiced; "partial": some; "none": not practiced at all. */
  status: "full" | "partial" | "none";
  /** actual − target, only for a fully practiced part with a target. */
  deltaMs: number | null;
}

/**
 * Totals per part from a run's per-slide times. Slides in no part are
 * returned as `rest` (only those that were practiced).
 */
export function partResults(slideMs: number[], parts: Part[]): { parts: PartResult[]; rest: number[] } {
  const covered = new Set<number>();
  const results = parts.map((part, index): PartResult => {
    let actualMs = 0;
    let practiced = 0;
    for (let s = part.from; s <= part.to; s++) {
      covered.add(s);
      const ms = slideMs[s] ?? 0;
      actualMs += ms;
      if (ms > 0) practiced++;
    }
    const slides = part.to - part.from + 1;
    const status = practiced === 0 ? "none" : practiced < slides ? "partial" : "full";
    const deltaMs = status === "full" && part.targetSec ? actualMs - part.targetSec * 1000 : null;
    return { part, index, actualMs, practiced, slides, status, deltaMs };
  });
  const rest = slideMs.map((ms, s) => (ms > 0 && !covered.has(s) ? s : -1)).filter((s) => s >= 0);
  return { parts: results, rest };
}

/** Against a target: "24초 초과" / "24초 짧음" / "목표와 같음" (within a second). */
export function targetDeltaText(deltaMs: number, format: (ms: number) => string): { text: string; tone: "over" | "under" | "same" } {
  if (Math.abs(deltaMs) < 1000) return { text: "목표와 같음", tone: "same" };
  return deltaMs > 0 ? { text: `${format(deltaMs)} 초과`, tone: "over" } : { text: `${format(-deltaMs)} 짧음`, tone: "under" };
}

/** Between two runs, neutrally: "12초 더 걸림" / "12초 덜 걸림" / "비슷함". */
export function compareDeltaText(deltaMs: number, format: (ms: number) => string): string {
  if (Math.abs(deltaMs) < 1000) return "비슷함";
  return deltaMs > 0 ? `${format(deltaMs)} 더 걸림` : `${format(-deltaMs)} 덜 걸림`;
}
