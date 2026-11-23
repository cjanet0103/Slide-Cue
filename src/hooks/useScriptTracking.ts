"use client";

import { useEffect, useRef, useState } from "react";
import {
  createTracker,
  feed,
  semanticScores,
  setPosition,
  spokenSoFar,
  followSpeech,
  startedNextSlide,
  type Lang,
  type TrackerState,
} from "@/lib/matching";
import { startRecognition, type RecognitionHandle, type StopReason } from "@/lib/speech";
import { cosine, embed, embedOnce, semanticState } from "@/lib/semantic";
import { splitScript } from "@/lib/scriptSegments";

export type TrackingStatus = "off" | "listening" | "manual";

export interface SlideTranscript {
  slide: number;
  text: string;
}

/** Recent speech used for meaning comparison (longer than the lexical window). */
const SEM_WINDOW_KO = 22;
const SEM_WINDOW_EN_WORDS = 8;
const SEM_INTERVAL_MS = 250;

/** Wall clock for throttling (only ever called from event handlers). */
const clock = () => Date.now();

function semanticWindow(text: string, lang: Lang): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (lang === "ko") return t.slice(-SEM_WINDOW_KO);
  return t.split(" ").slice(-SEM_WINDOW_EN_WORDS).join(" ");
}

/** Meaning scores, valid only for the slide and listening point they were computed for. */
interface SemanticScores {
  slide: number;
  offset: number;
  /** Cosines for this slide's phrases, then the next slide's opening phrases. */
  scores: number[];
  /** How many of `scores` belong to this slide. */
  curLen: number;
}

/** Agreeing checks needed before auto-advancing (PRD: only when clearly confirmed). */
const ADVANCE_CONFIRM = 2;
/** After the slide's last phrase is finished, wait this long (the star reaching the end) before moving on. */
const END_ADVANCE_DELAY_MS = 300;

export interface TrackingOptions {
  lang: Lang;
  /** Move to the next slide when its opening is said (PRD 자동 넘김). */
  autoAdvance: boolean;
}

/**
 * Live script tracking: on-device recognition → phrase matching (src/lib/matching.ts),
 * plus on-device meaning comparison (src/lib/semantic.ts) once its model is ready.
 * Driven from event handlers (start / slide change / stop), not effects.
 * Also collects what was said on each slide visit, saved with the run.
 */
export function useScriptTracking(slides: string[], onAdvance: (nextSlide: number) => void) {
  const [status, setStatus] = useState<TrackingStatus>("off");
  const [manualReason, setManualReason] = useState<StopReason | null>(null);
  const [tracker, setTracker] = useState<TrackerState | null>(null);
  // Last spoken character of the highlighted phrase (display index; -1 = not started).
  const [charIndex, setCharIndex] = useState(-1);
  const charRef = useRef<{ key: string; at: number }>({ key: "", at: -1 });

  const finals = useRef("");
  const interim = useRef("");
  const handle = useRef<RecognitionHandle | null>(null);
  const lang = useRef<Lang>("ko");
  const slideRef = useRef(0);
  // Where each slide visit starts in `finals`, for per-slide transcripts.
  const visits = useRef<{ slide: number; start: number }[]>([]);
  const slidesRef = useRef(slides);
  const trackerRef = useRef<TrackerState | null>(null);
  const onAdvanceRef = useRef(onAdvance);
  useEffect(() => {
    slidesRef.current = slides;
    onAdvanceRef.current = onAdvance;
  });
  const autoAdvance = useRef(false);
  const advanceStreak = useRef(0);

  /** Updates the tracker and keeps a synchronous copy for the checks below. */
  const commit = (next: TrackerState | null) => {
    trackerRef.current = next;
    setTracker(next);
    // Star marker: how far into the highlighted phrase the speaker is. Restarts
    // at the phrase's first character whenever the phrase (or listening point) changes.
    if (!next || !next.segments[next.index]) {
      charRef.current = { key: "", at: -1 };
      setCharIndex(-1);
      return;
    }
    const key = `${slideRef.current}:${next.index}:${next.offset}`;
    const from = charRef.current.key === key ? charRef.current.at : -1;
    // Where the star is; a phrase said to its end moves the emphasis on to the
    // next phrase (the star then waits beside it), listening from here.
    const step = followSpeech(next, finals.current, interim.current, from);
    if (step.moved) {
      commit(step.state);
      return;
    }
    charRef.current = { key, at: step.at };
    setCharIndex(step.at);
    // Auto-advance: the slide's last phrase has been said to its end → next slide,
    // without waiting for the presenter to start talking about it.
    if (step.slideDone) advanceAtEnd();
  };

  /** Move to the next slide once, after the star has had time to reach the end. */
  const endTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advancedFrom = useRef<number | null>(null);
  const advanceAtEnd = () => {
    const slide = slideRef.current;
    const next = slide + 1;
    if (!autoAdvance.current || next >= slidesRef.current.length || advancedFrom.current === slide) return;
    advancedFrom.current = slide;
    if (endTimer.current) clearTimeout(endTimer.current);
    endTimer.current = setTimeout(() => {
      endTimer.current = null;
      if (slideRef.current === slide && autoAdvance.current) onAdvanceRef.current(next);
    }, END_ADVANCE_DELAY_MS);
  };

  // Meaning comparison state.
  const segVectors = useRef<{ slide: number; vectors: number[][]; curLen: number } | null>(null);
  const semantic = useRef<SemanticScores | null>(null);
  const semBusy = useRef(false);
  const semDirty = useRef(false);
  const semLast = useRef(0);

  const segmentsOf = (s: number) => splitScript(slidesRef.current[s] ?? "");

  /** Meaning scores to pass to the matcher, only if they match the tracker's current state. */
  const currentSemantic = (t: TrackerState) => {
    const s = semantic.current;
    return s && s.slide === slideRef.current && s.offset === t.offset ? s : undefined;
  };

  /** Auto-advance: two agreeing checks that the next slide's opening is being said → move once. */
  const checkAdvance = () => {
    const t = trackerRef.current;
    if (!autoAdvance.current || !t) return;
    const next = slideRef.current + 1;
    if (next >= slidesRef.current.length) return;
    const sem = currentSemantic(t);
    const nextMeaning = sem ? semanticScores(sem.scores).slice(sem.curLen) : [];
    if (startedNextSlide(t, finals.current, interim.current, segmentsOf(next), nextMeaning)) {
      advanceStreak.current += 1;
      if (advanceStreak.current >= ADVANCE_CONFIRM) {
        advanceStreak.current = 0;
        onAdvanceRef.current(next);
      }
    } else {
      advanceStreak.current = 0;
    }
  };

  /** Feed the latest speech (and meaning scores) to the tracker, then check for auto-advance. */
  const update = () => {
    const t = trackerRef.current;
    if (!t) return;
    commit(feed(t, finals.current, interim.current, currentSemantic(t)?.scores));
    checkAdvance();
  };

  const prepareSlideVectors = (slide: number) => {
    segVectors.current = null;
    semantic.current = null;
    if (semanticState().state !== "ready") return;
    // This slide's phrases plus the next slide's opening (for auto-advance).
    const segs = segmentsOf(slide);
    const opening = segmentsOf(slide + 1).slice(0, 2);
    if (segs.length + opening.length === 0) return;
    embed([...segs, ...opening])
      .then((vectors) => {
        if (slideRef.current === slide) segVectors.current = { slide, vectors, curLen: segs.length };
      })
      .catch(() => {});
  };

  /** Compute meaning scores for the latest speech (throttled; stale results dropped). */
  const runSemantic = () => {
    const t = trackerRef.current;
    if (!t || semanticState().state !== "ready") return;
    if (!segVectors.current || segVectors.current.slide !== slideRef.current) {
      prepareSlideVectors(slideRef.current);
      return;
    }
    if (semBusy.current) {
      semDirty.current = true;
      return;
    }
    const now = clock();
    if (now - semLast.current < SEM_INTERVAL_MS) {
      semDirty.current = true;
      setTimeout(runSemantic, SEM_INTERVAL_MS - (now - semLast.current));
      return;
    }
    const heard = `${finals.current.slice(t.offset)} ${interim.current}`;
    const text = semanticWindow(heard, lang.current);
    if (text.length < 4) return;
    const slide = slideRef.current;
    const offset = t.offset;
    const { vectors, curLen } = segVectors.current;
    semBusy.current = true;
    semDirty.current = false;
    semLast.current = now;
    embedOnce(text)
      .then((v) => {
        if (slideRef.current !== slide) return;
        semantic.current = { slide, offset, curLen, scores: vectors.map((sv) => cosine(v, sv)) };
        update();
      })
      .catch(() => {})
      .finally(() => {
        semBusy.current = false;
        if (semDirty.current) runSemantic();
      });
  };

  const onSpeech = (allFinals: string, now: string) => {
    finals.current = allFinals;
    interim.current = now;
    update();
    runSemantic();
  };

  /** Begin tracking at `slide`. Call from the 연습 시작 click. */
  const start = (slide: number, { lang: language, autoAdvance: advance }: TrackingOptions) => {
    handle.current?.stop();
    lang.current = language;
    autoAdvance.current = advance;
    advanceStreak.current = 0;
    advancedFrom.current = null;
    slideRef.current = slide;
    finals.current = "";
    interim.current = "";
    visits.current = [{ slide, start: 0 }];
    setManualReason(null);
    commit(createTracker(segmentsOf(slide), language, 0));
    prepareSlideVectors(slide);
    const h = startRecognition({
      lang: language,
      onResult: onSpeech,
      onStop: (reason) => {
        handle.current = null;
        setManualReason(reason);
        setStatus("manual");
      },
    });
    handle.current = h;
    if (h) {
      setStatus("listening");
    } else {
      setStatus("manual");
      setManualReason("error");
    }
  };

  /** Slide changed: drop pending recognition for the old slide; start the new one at its top. */
  const changeSlide = (slide: number) => {
    if (status === "off") return;
    const last = visits.current[visits.current.length - 1];
    if (last?.slide === slide) return;
    const at = finals.current.length;
    slideRef.current = slide;
    visits.current.push({ slide, start: at });
    advanceStreak.current = 0;
    // Listen for the new slide from now, words still in progress included.
    const listenFrom = spokenSoFar(finals.current, interim.current).length;
    advancedFrom.current = null;
    if (endTimer.current) clearTimeout(endTimer.current);
    endTimer.current = null;
    commit(createTracker(segmentsOf(slide), lang.current, listenFrom));
    prepareSlideVectors(slide);
  };

  /** Manual correction: the presenter clicked a phrase. */
  const selectSegment = (index: number) => {
    semantic.current = null;
    const t = trackerRef.current;
    if (t) commit(setPosition(t, index, spokenSoFar(finals.current, interim.current).length));
  };

  /** Stop listening; returns what was said on each slide visit (empty visits left out). */
  const stop = (): SlideTranscript[] => {
    handle.current?.stop();
    handle.current = null;
    const all = `${finals.current} ${interim.current}`;
    const transcripts = visits.current
      .map((v, i) => ({
        slide: v.slide,
        text: all.slice(v.start, visits.current[i + 1]?.start ?? all.length).trim(),
      }))
      .filter((v) => v.text);
    setStatus("off");
    if (endTimer.current) clearTimeout(endTimer.current);
    endTimer.current = null;
    commit(null);
    autoAdvance.current = false;
    segVectors.current = null;
    semantic.current = null;
    return transcripts;
  };

  // Stop the microphone if the editor goes away mid-rehearsal.
  useEffect(() => () => handle.current?.stop(), []);

  // Dev-only: `__slidecueSpeak("...")` in the console simulates speech while tracking.
  const tracking = status !== "off";
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || !tracking) return;
    const w = window as unknown as { __slidecueSpeak?: (text: string, asInterim?: boolean) => void; __slidecueTracking?: () => unknown };
    // `__slidecueSpeak("…", true)` sends it as in-progress (interim) text instead of confirmed.
    w.__slidecueSpeak = (text: string, asInterim?: boolean) =>
      asInterim ? onSpeech(finals.current, text) : onSpeech(`${finals.current} ${text}`, "");
    (w as unknown as { __slidecueProbe?: (t: string) => Promise<number[]> }).__slidecueProbe = async (t: string) => {
      const v = await embedOnce(t);
      return (segVectors.current?.vectors ?? []).map((sv) => +cosine(v, sv).toFixed(3));
    };
    w.__slidecueTracking = () => ({
      tracker: trackerRef.current && { index: trackerRef.current.index, offset: trackerRef.current.offset },
      charIndex: charRef.current.at,
      slideVectors: segVectors.current?.vectors.length ?? 0,
      semantic: semantic.current,
      finalsLength: finals.current.length,
    });
    return () => {
      delete w.__slidecueSpeak;
      delete w.__slidecueTracking;
    };
    // onSpeech only reads refs and stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking]);

  return {
    status,
    manualReason,
    /** Highlighted phrase on the current slide, or null when not tracking. */
    segmentIndex: tracker ? tracker.index : null,
    /** Last spoken character in the highlighted phrase (-1 = not started); drives the star marker. */
    charIndex,
    start,
    changeSlide,
    selectSegment,
    stop,
  };
}
