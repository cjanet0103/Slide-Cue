/**
 * Live script tracking (PRD §4.3): match what the speaker just said to a
 * phrase (segment) of the current slide's script. Pure functions, no timers.
 *
 * - Text is normalized for comparison only; the display text is untouched.
 * - Only nearby phrases are candidates: one before, the current one, two after.
 * - Korean compares character bigrams; English compares word order (LCS).
 * - Moves only on a clear, consistent match; holds on silence, ad-libs, or
 *   matches made of nothing but numbers/filler words. Never moves on time.
 */

export type Lang = "ko" | "en";

/** Rough language of a script: Hangul vs Latin letters. */
export function detectLang(text: string): Lang {
  const hangul = (text.match(/[가-힣]/g) ?? []).length;
  const latin = (text.match(/[a-zA-Z]/g) ?? []).length;
  return hangul >= latin * 0.5 && hangul > 0 ? "ko" : latin > 0 ? "en" : "ko";
}

/** Lowercase, punctuation → space, collapsed whitespace. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Words that say nothing about position on their own.
const FILLER_KO = ["그리고", "그래서", "그런데", "하지만", "그러면", "그럼", "또", "이제", "음", "어", "아", "자", "네", "저", "그"];
const FILLER_EN = new Set([
  "and", "so", "but", "the", "a", "an", "of", "to", "in", "on", "is", "it", "that", "this", "uh", "um", "okay", "ok", "well", "now", "then", "we", "i", "you",
]);

/**
 * Korean sentence endings. Nearly every sentence ends in one, so they say
 * nothing about WHERE the speaker is: "하겠습니다" must not point at whichever
 * phrase happens to end in "있습니다". They are left out of position matching.
 */
const ENDING_KO = ["하겠습니다", "겠습니다", "습니다", "합니다", "입니다", "됩니다", "니다", "하도록", "도록", "할게요", "세요", "해요", "에요", "예요", "어요", "아요", "지요"];
const ENDING_BIGRAMS = new Set(ENDING_KO.flatMap((e) => bigramsOf(e)));

function bigramsOf(compact: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < compact.length - 1; i++) out.push(compact.slice(i, i + 2));
  return out;
}

/** Two-letter chunks used for matching (sentence-ending chunks left out). */
function bigrams(compact: string): string[] {
  return bigramsOf(compact).filter((g) => !ENDING_BIGRAMS.has(g));
}


function lcsLength(a: string[], b: string[]): number {
  const dp = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}

// Window of the most recent speech used for matching. Short on purpose: a
// phrase that was just finished should stop matching soon after the next starts.
const WINDOW_KO_CHARS = 14;
const WINDOW_EN_WORDS = 6;

/** The tail of what was heard, in comparable form. */
export function speechWindow(heard: string, lang: Lang): string {
  const norm = normalize(heard);
  if (lang === "ko") {
    const compact = norm.replace(/\s+/g, "");
    return compact.slice(-WINDOW_KO_CHARS);
  }
  return norm.split(" ").filter(Boolean).slice(-WINDOW_EN_WORDS).join(" ");
}

/** True when the window carries real content (not just numbers or filler words). */
export function isInformative(window: string, lang: Lang): boolean {
  if (lang === "ko") {
    let rest = window.replace(/\d+/g, "");
    for (const f of FILLER_KO) rest = rest.split(f).join("");
    for (const e of ENDING_KO) rest = rest.split(e).join("");
    // Endings are already gone, so two content letters (저도 그랬습니다 → 도랬) are enough.
    return rest.length >= 2;
  }
  const words = window.split(" ").filter((w) => w && !/^\d+$/.test(w) && !FILLER_EN.has(w));
  return words.length >= 2;
}

/**
 * Overlap between recent speech and a phrase (0–1), measured against the
 * shorter of the two — so a short phrase said in full scores high even when
 * the window also holds the end of the previous phrase.
 */
export function phraseScore(window: string, segment: string, lang: Lang): number {
  if (!window) return 0;
  if (lang === "ko") {
    const w = new Set(bigrams(window));
    const s = new Set(bigrams(normalize(segment).replace(/\s+/g, "")));
    if (w.size === 0 || s.size < 2) return 0;
    let inter = 0;
    w.forEach((g) => {
      if (s.has(g)) inter++;
    });
    return inter / Math.min(w.size, s.size);
  }
  const w = window.split(" ").filter(Boolean);
  const s = normalize(segment).split(" ").filter(Boolean);
  if (w.length === 0 || s.length < 2) return 0;
  return lcsLength(w, s) / Math.min(w.length, s.length);
}

export interface TrackerState {
  segments: string[];
  lang: Lang;
  /** Highlighted phrase. */
  index: number;
  /** Chars of the final transcript to ignore (speech before the last reset/correction). */
  offset: number;
  /** A phrase that is winning but not yet confirmed. */
  candidate: number | null;
  streak: number;
}

const MIN_SCORE = 0.5;
/** Ahead by at least this much: move right away (forward only). */
const FAST_LEAD = 0.2;
/** Ahead by less: wait for a second confirming update. */
const MIN_LEAD = 0.15;
const STRONG_SCORE = 0.7;
const STRONG_LEAD = 0.25;
const CONFIRM_STREAK = 2;
/** Phrases ahead that can be matched (skipped sentences are still followed). */
const LOOKAHEAD = 3;

/*
 * Meaning similarity from the on-device sentence model (multilingual-e5-small).
 * Its cosines cluster high (≈0.80–0.95 for any Korean text), so a phrase counts
 * as a meaning match only when it is both high enough AND clearly ahead of every
 * other phrase on the slide. Measured: paraphrases lead by ≈0.015–0.07 at
 * ≥0.87; unrelated ad-libs stay ≤0.867 with leads ≤0.016.
 */
const SEM_GATE = 0.865;
const SEM_SCALE = 0.025;

/** Raw cosines (one per phrase on the slide) → 0–1 meaning scores. */
export function semanticScores(cosines: (number | undefined)[]): number[] {
  return cosines.map((c, i) => {
    if (c === undefined || Number.isNaN(c) || c < SEM_GATE) return 0;
    let runnerUp = -Infinity;
    cosines.forEach((o, j) => {
      if (j !== i && o !== undefined && o > runnerUp) runnerUp = o;
    });
    const lead = runnerUp === -Infinity ? SEM_SCALE : c - runnerUp;
    return Math.max(0, Math.min(1, lead / SEM_SCALE));
  });
}

/** The closing part of a phrase (last ~35%), in comparable form. */
function phraseTail(segment: string, lang: Lang): string {
  const norm = normalize(segment);
  if (lang === "ko") {
    const compact = norm.replace(/\s+/g, "");
    // Reach back far enough to hold some content, not just the ending (그랬습니다, not 습니다).
    let n = Math.max(4, Math.ceil(compact.length * 0.35));
    while (n < compact.length && bigrams(compact.slice(-n)).length < 2) n++;
    return compact.slice(-n);
  }
  const words = norm.split(" ").filter(Boolean);
  return words.slice(-Math.max(2, Math.ceil(words.length * 0.35))).join(" ");
}

/** The last few chars/words just spoken. */
function windowEnd(window: string, lang: Lang): string {
  return lang === "ko" ? window.slice(-5) : window.split(" ").slice(-3).join(" ");
}

const TAIL_SCORE = 0.75;

/**
 * Everything heard so far as one string: confirmed text, then the in-progress
 * guess. Tracker offsets are positions in this string, so "listen from here"
 * also drops words still in progress — they belong to what came before.
 * (When the guess is confirmed it moves into `finals` with one space, so the
 * string keeps its length and offsets stay valid.)
 */
export function spokenSoFar(finals: string, interim: string): string {
  return interim ? `${finals} ${interim}` : finals;
}

/** What was heard after `offset` (a position in spokenSoFar). */
export function heardSince(finals: string, interim: string, offset: number): string {
  return spokenSoFar(finals, interim).slice(offset);
}

export function createTracker(segments: string[], lang: Lang, finalsLength = 0): TrackerState {
  return { segments, lang, index: 0, offset: finalsLength, candidate: null, streak: 0 };
}

/** Manual correction: highlight `index` and ignore speech heard before `heardLength` (spokenSoFar length). */
export function setPosition(state: TrackerState, index: number, heardLength: number): TrackerState {
  const clamped = Math.max(0, Math.min(state.segments.length - 1, index));
  return { ...state, index: clamped, offset: heardLength, candidate: null, streak: 0 };
}

/**
 * Update with the recognizer's output: `finals` is all confirmed text so far
 * (only ever grows), `interim` is the in-progress guess.
 * `semantic` (optional): cosine similarity of recent speech to each phrase,
 * from the on-device sentence model — lets paraphrases match too.
 */
export function feed(
  state: TrackerState,
  finals: string,
  interim: string,
  semantic?: (number | undefined)[],
): TrackerState {
  const { segments, lang, index } = state;
  if (segments.length === 0) return state;
  const heard = heardSince(finals, interim, state.offset);
  const window = speechWindow(heard, lang);
  const hold = { ...state, candidate: null, streak: 0 };
  if (!isInformative(window, lang)) return hold;

  // The current phrase and the next few only — the highlight never goes back
  // on its own (the user found back-and-forth jumps distracting); clicking a
  // phrase is the way to go back. On ties the current phrase wins.
  const order = [index];
  for (let k = 1; k <= LOOKAHEAD; k++) order.push(index + k);
  const meaning = semantic ? semanticScores(semantic) : [];
  const scored = order
    .filter((i) => i >= 0 && i < segments.length)
    .map((i) => {
      const lexical = phraseScore(window, segments[i], lang);
      const sem = meaning[i] ?? 0;
      return { i, score: Math.max(lexical, sem), byMeaningOnly: sem > lexical && lexical < MIN_SCORE };
    });
  const current = scored[0].score;
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a));
  const lead = best.score - current;

  // Still on the current phrase: if its ending was just said, move on early
  // and start listening fresh for the next phrase.
  if (best.i === index) {
    const tail = phraseTail(segments[index], lang);
    const saidEnding =
      index + 1 < segments.length &&
      phraseScore(window, tail, lang) >= TAIL_SCORE &&
      phraseScore(windowEnd(window, lang), tail, lang) >= TAIL_SCORE;
    if (saidEnding) {
      return { ...hold, index: index + 1, offset: spokenSoFar(finals, interim).length };
    }
    return hold;
  }

  if (best.score < MIN_SCORE || lead < MIN_LEAD) return hold;

  const clear = best.byMeaningOnly
    ? best.score >= STRONG_SCORE && lead >= FAST_LEAD // a clear meaning match moves at once too
    : lead >= FAST_LEAD || (best.score >= STRONG_SCORE && lead >= STRONG_LEAD);
  if (clear) return { ...hold, index: best.i };
  // Only a borderline lead: confirm with a second update first.
  const streak = state.candidate === best.i ? state.streak + 1 : 1;
  if (streak >= CONFIRM_STREAK) return { ...hold, index: best.i };
  return { ...state, candidate: best.i, streak };
}

const NEXT_START_SCORE = 0.6;
const NEXT_START_LEAD = 0.2;

/**
 * Auto-advance check (PRD §4.3-4): true only when the tracker has reached the
 * last phrase of this slide AND the latest speech clearly matches the opening
 * of the next slide (its first two phrases) better than this slide's last one.
 * Callers should require two agreeing checks in a row, then advance once.
 * `nextMeaning`: optional 0–1 meaning scores for those next-slide phrases.
 */
export function startedNextSlide(
  state: TrackerState,
  finals: string,
  interim: string,
  nextSegments: string[],
  nextMeaning: number[] = [],
): boolean {
  const { segments, lang } = state;
  const opening = nextSegments.slice(0, 2);
  if (opening.length === 0) return false;
  // A slide without a script counts as finished; otherwise the last phrase must be reached.
  if (segments.length > 0 && state.index < segments.length - 1) return false;
  const heard = heardSince(finals, interim, state.offset);
  const window = speechWindow(heard, lang);
  if (!isInformative(window, lang)) return false;
  const next = Math.max(
    ...opening.map((seg, k) => Math.max(phraseScore(window, seg, lang), nextMeaning[k] ?? 0)),
  );
  const stay = segments.length ? phraseScore(window, segments[segments.length - 1], lang) : 0;
  return next >= NEXT_START_SCORE && next - stay >= NEXT_START_LEAD;
}

/**
 * Two letters start the same way: identical, or Hangul syllables with the same
 * first consonant (보/볼/봐, 하/한/해, 되/돼). A verb keeps its first consonant
 * however its ending is said (보세요 · 보겠습니다 · 볼게요 · 봐요).
 */
export function sameSyllableStart(a: string, b: string): boolean {
  if (a === b) return true;
  const ca = a.charCodeAt(0) - 0xac00;
  const cb = b.charCodeAt(0) - 0xac00;
  if (ca < 0 || cb < 0 || ca > 11171 || cb > 11171) return false;
  return Math.floor(ca / 588) === Math.floor(cb / 588);
}

/** Letters/digits of the display text, lowercased, with each one's index in the display text. */
function letterMap(display: string): { letters: string; at: number[] } {
  let letters = "";
  const at: number[] = [];
  const chars = Array.from(display);
  let pos = 0;
  for (const ch of chars) {
    if (/[\p{L}\p{N}]/u.test(ch)) {
      letters += ch.toLowerCase();
      at.push(pos);
    }
    pos += ch.length;
  }
  return { letters, at };
}

/**
 * Where in the phrase's display text the speaker has got to: the index of the
 * last character of the most recently recognized word, or -1 if nothing yet.
 * Only moves forward from `from` (the previous result), never past what was
 * actually recognized. Korean matches the last few letters heard; English
 * matches the last word heard.
 */
/** How many letters ahead a 2–3 letter match may move the star. */
const SHORT_MATCH_REACH = 8;

export function spokenCharIndex(display: string, heard: string, lang: Lang, from = -1): number {
  const { letters, at } = letterMap(display);
  if (letters.length === 0) return from;
  const fromLetter = from < 0 ? -1 : at.findIndex((p) => p >= from);

  if (lang === "ko") {
    const said = normalize(heard).replace(/\s+/g, "");
    const findEnding = (end: number, k: number) => {
      if (end < k) return -1;
      // first occurrence, at or after the current position, of the letters ending at `end`
      const idx = letters.indexOf(said.slice(end - k, end), Math.max(0, fromLetter - k + 1));
      if (idx < 0) return -1;
      // The speaker kept going: if the next syllable said starts like the script's
      // next one (보 ↔ 볼 · 봐, same first consonant), that word has begun.
      let last = idx + k - 1;
      const extra = said.length - end;
      const begun = extra > 0 && last + 1 < letters.length && sameSyllableStart(letters[last + 1], said[end]);
      if (begun) last++;
      // A begun word followed by at most one more word (보시기 바랍니다, 할 수 있습니다),
      // while the speaker said at least two more syllables: the ending was said
      // in other words, so the phrase counts as finished.
      const wordStop = wordEnd(display, at[last]);
      const rest = display.slice(wordStop + 1).trim();
      if (begun && extra >= 2 && rest && !/s/.test(rest)) return at[letters.length - 1];
      return at[last];
    };
    // The latest letters heard (falling back to 2 letters for very short words)…
    for (const k of [4, 3, 2]) {
      const hit = findEnding(said.length, k);
      if (hit < 0) continue;
      // Two or three letters (니다, 습니다) occur all over a script: trust them only
      // close to where the speaker already is, never as a jump to a far-off spot.
      if (k < 4 && at.findIndex((p) => p >= hit) - Math.max(0, fromLetter) > SHORT_MATCH_REACH) continue;
      return Math.max(from, hit);
    }
    // …or, if the speech has already run past this phrase (or ended differently),
    // the latest point in the last ~20 letters that still belongs to it.
    for (let end = said.length - 1; end >= Math.max(4, said.length - 20); end--) {
      const hit = findEnding(end, 4);
      if (hit >= 0) return Math.max(from, hit);
    }
    return from;
  }

  // English: word boundaries in the letter stream
  const words: { text: string; end: number }[] = [];
  const re = /[\p{L}\p{N}]+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(display))) words.push({ text: m[0].toLowerCase(), end: m.index + m[0].length - 1 });
  const saidWords = normalize(heard).split(" ").filter(Boolean);
  const last = saidWords[saidWords.length - 1];
  if (!last) return from;
  const hit = words.find((w) => w.end >= from && w.text === last);
  return hit ? Math.max(from, hit.end) : from;
}

/**
 * A word that has begun will be finished: the end of the word containing
 * `index` (up to the next space, trailing punctuation included). -1 stays -1.
 */
export function wordEnd(display: string, index: number): number {
  if (index < 0) return index;
  let i = index;
  while (i + 1 < display.length && !/\s/.test(display[i + 1])) i++;
  return i;
}

/** Index of the phrase's last visible character (-1 for an empty phrase). */
export function phraseEnd(display: string): number {
  return display.trimEnd().length - 1;
}

/**
 * How far into a phrase the star may go for the speech heard so far: at most
 * about 1.5 letters of script per letter said (+2), so other wording and
 * shortened endings still reach the end, but a few stray letters (a leftover
 * "니다") can never count as a whole phrase. Returns `index` or an earlier one.
 */
export function limitToHeard(display: string, index: number, heard: string): number {
  if (index < 0) return index;
  const said = (heard.match(/[\p{L}\p{N}]/gu) ?? []).length;
  if (said === 0) return -1;
  const max = Math.floor(said * 1.5) + 2;
  const { at } = letterMap(display);
  const upTo = at.filter((p) => p <= index).length;
  return upTo <= max ? index : at[max - 1];
}

/**
 * One step of following the speaker inside the highlighted phrase.
 * `at`: last spoken character (-1 = not started), monotonic from `from`. A begun
 * word counts to its end, limited by how much was actually heard (limitToHeard).
 * When the phrase has been said to its end and it isn't the slide's last, the
 * tracker moves to the next phrase, listening from now (`moved`). When the last
 * phrase is finished, `slideDone` is set (auto-advance decides what to do).
 */
export function followSpeech(
  state: TrackerState,
  finals: string,
  interim: string,
  from: number,
): { state: TrackerState; at: number; moved: boolean; slideDone: boolean } {
  const segment = state.segments[state.index];
  if (segment === undefined) return { state, at: -1, moved: false, slideDone: false };
  const heard = heardSince(finals, interim, state.offset);
  const raw = wordEnd(segment, spokenCharIndex(segment, heard, state.lang, from));
  const at = Math.max(from, limitToHeard(segment, raw, heard));
  const finished = at >= 0 && at >= phraseEnd(segment);
  const last = state.index >= state.segments.length - 1;
  if (finished && !last) {
    return { state: setPosition(state, state.index + 1, spokenSoFar(finals, interim).length), at: -1, moved: true, slideDone: false };
  }
  return { state, at, moved: false, slideDone: finished && last };
}
