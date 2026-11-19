/**
 * Rehearsal timing (PRD §4.2), as a pure reducer so it can be unit-tested.
 * - Total time = start→end minus explicit pauses (silence still counts).
 * - Returning to a slide adds to that slide's total.
 * - Each visit records its start/end on the run clock (pauses excluded),
 *   which later lines up with the recording's timeline.
 * All times are milliseconds; `at` is a wall-clock timestamp supplied by the caller.
 */

export type TimingEvent =
  | { type: "start"; at: number; slide: number }
  | { type: "pause"; at: number }
  | { type: "resume"; at: number }
  | { type: "goto"; at: number; slide: number }
  | { type: "end"; at: number };

export interface Visit {
  slide: number;
  /** Run-clock ms (pauses excluded) when this visit began / ended. */
  startMs: number;
  endMs: number;
}

export interface TimingState {
  status: "idle" | "running" | "paused" | "ended";
  slide: number;
  /** Run-clock ms accumulated up to `lastAt`. */
  runMs: number;
  /** Wall-clock time of the last event while running. */
  lastAt: number;
  slideMs: number[];
  visits: Visit[];
}

export function initialTiming(slideCount: number): TimingState {
  return {
    status: "idle",
    slide: 0,
    runMs: 0,
    lastAt: 0,
    slideMs: Array.from({ length: slideCount }, () => 0),
    visits: [],
  };
}

/** Moves the run clock forward to `at`, crediting the current slide. */
function advance(state: TimingState, at: number): TimingState {
  if (state.status !== "running") return state;
  const delta = Math.max(0, at - state.lastAt);
  const slideMs = [...state.slideMs];
  slideMs[state.slide] += delta;
  const runMs = state.runMs + delta;
  const visits = [...state.visits];
  const open = visits[visits.length - 1];
  if (open) visits[visits.length - 1] = { ...open, endMs: runMs };
  return { ...state, runMs, lastAt: at, slideMs, visits };
}

export function applyTiming(state: TimingState, event: TimingEvent): TimingState {
  switch (event.type) {
    case "start": {
      if (state.status !== "idle") return state;
      return {
        ...state,
        status: "running",
        slide: event.slide,
        lastAt: event.at,
        visits: [{ slide: event.slide, startMs: 0, endMs: 0 }],
      };
    }
    case "pause": {
      if (state.status !== "running") return state;
      return { ...advance(state, event.at), status: "paused" };
    }
    case "resume": {
      if (state.status !== "paused") return state;
      return { ...state, status: "running", lastAt: event.at };
    }
    case "goto": {
      if (state.status === "idle" || state.status === "ended") return state;
      if (event.slide === state.slide || event.slide < 0 || event.slide >= state.slideMs.length) return state;
      const moved = advance(state, event.at);
      return {
        ...moved,
        slide: event.slide,
        visits: [...moved.visits, { slide: event.slide, startMs: moved.runMs, endMs: moved.runMs }],
      };
    }
    case "end": {
      if (state.status === "idle" || state.status === "ended") return state;
      return { ...advance(state, event.at), status: "ended" };
    }
  }
}

/** Live readout at wall-clock `now` without changing state. */
export function readTiming(state: TimingState, now: number): { totalMs: number; slideMs: number } {
  const extra = state.status === "running" ? Math.max(0, now - state.lastAt) : 0;
  return { totalMs: state.runMs + extra, slideMs: state.slideMs[state.slide] + extra };
}

export interface SlideComparison {
  slide: number;
  currentMs: number | null;
  previousMs: number | null;
  /** current − previous; null when either side has no record. */
  deltaMs: number | null;
}

/**
 * Per-slide comparison between two runs. A slide that wasn't reached in a run
 * (0 ms) counts as "no record" for that run.
 */
export function compareRuns(current: number[], previous: number[] | null): SlideComparison[] {
  return current.map((ms, slide) => {
    const cur = ms > 0 ? ms : null;
    const prevRaw = previous?.[slide];
    const prev = prevRaw && prevRaw > 0 ? prevRaw : null;
    return { slide, currentMs: cur, previousMs: prev, deltaMs: cur !== null && prev !== null ? cur - prev : null };
  });
}

/** "1분 12초", "54초", "0초". */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}분${s ? ` ${s}초` : ""}` : `${s}초`;
}

/** "01:12" clock style for live timers. */
export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
