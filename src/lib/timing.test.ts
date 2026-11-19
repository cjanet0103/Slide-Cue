import { describe, expect, it } from "vitest";
import {
  applyTiming,
  compareRuns,
  formatClock,
  formatDuration,
  initialTiming,
  readTiming,
  type TimingEvent,
} from "./timing";

const run = (events: TimingEvent[], slides = 3) => events.reduce(applyTiming, initialTiming(slides));
const s = (sec: number) => sec * 1000;

describe("timing — PRD T2", () => {
  // Slide 1 for 20s, pause 10s, slide 2 for 30s, back to slide 1 for 5s.
  const t2 = run([
    { type: "start", at: s(0), slide: 0 },
    { type: "pause", at: s(20) },
    { type: "resume", at: s(30) },
    { type: "goto", at: s(30), slide: 1 },
    { type: "goto", at: s(60), slide: 0 },
    { type: "end", at: s(65) },
  ]);

  it("excludes the pause from the total: 55s", () => {
    expect(t2.runMs).toBe(s(55));
    expect(t2.status).toBe("ended");
  });

  it("adds revisits to the slide: slide 1 = 25s, slide 2 = 30s", () => {
    expect(t2.slideMs).toEqual([s(25), s(30), 0]);
  });

  it("records each visit on the run clock, in order", () => {
    expect(t2.visits).toEqual([
      { slide: 0, startMs: 0, endMs: s(20) },
      { slide: 1, startMs: s(20), endMs: s(50) },
      { slide: 0, startMs: s(50), endMs: s(55) },
    ]);
  });
});

describe("timing — edge cases", () => {
  it("reads live time while running and freezes it while paused", () => {
    const running = run([{ type: "start", at: s(0), slide: 0 }]);
    expect(readTiming(running, s(7))).toEqual({ totalMs: s(7), slideMs: s(7) });
    const paused = applyTiming(running, { type: "pause", at: s(7) });
    expect(readTiming(paused, s(100))).toEqual({ totalMs: s(7), slideMs: s(7) });
  });

  it("can change slides while paused without counting the pause", () => {
    const st = run([
      { type: "start", at: s(0), slide: 0 },
      { type: "pause", at: s(10) },
      { type: "goto", at: s(40), slide: 1 },
      { type: "resume", at: s(50) },
      { type: "end", at: s(55) },
    ]);
    expect(st.slideMs).toEqual([s(10), s(5), 0]);
    expect(st.runMs).toBe(s(15));
  });

  it("ignores events that don't fit the current state", () => {
    const idle = initialTiming(2);
    expect(applyTiming(idle, { type: "pause", at: 5 })).toBe(idle);
    const ended = run([{ type: "start", at: 0, slide: 0 }, { type: "end", at: 10 }], 2);
    expect(applyTiming(ended, { type: "goto", at: 20, slide: 1 })).toBe(ended);
    const started = run([{ type: "start", at: 0, slide: 0 }], 2);
    expect(applyTiming(started, { type: "goto", at: 5, slide: 9 })).toBe(started);
  });
});

describe("compareRuns", () => {
  it("shows per-slide differences and 'no record' gaps", () => {
    expect(compareRuns([s(54), s(30), 0], [s(72), 0, s(10)])).toEqual([
      { slide: 0, currentMs: s(54), previousMs: s(72), deltaMs: -s(18) },
      { slide: 1, currentMs: s(30), previousMs: null, deltaMs: null },
      { slide: 2, currentMs: null, previousMs: s(10), deltaMs: null },
    ]);
  });

  it("handles a first run with nothing to compare", () => {
    expect(compareRuns([s(5)], null)[0]).toEqual({ slide: 0, currentMs: s(5), previousMs: null, deltaMs: null });
  });
});

describe("formatting", () => {
  it("formats durations in Korean", () => {
    expect(formatDuration(s(72))).toBe("1분 12초");
    expect(formatDuration(s(54))).toBe("54초");
    expect(formatDuration(s(120))).toBe("2분");
  });

  it("formats live clocks", () => {
    expect(formatClock(s(72))).toBe("01:12");
    expect(formatClock(s(3725))).toBe("1:02:05");
  });
});
