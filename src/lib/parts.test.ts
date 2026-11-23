import { describe, expect, it } from "vitest";
import { formatDuration } from "./timing";
import { compareDeltaText, partResults, partTargetSum, targetDeltaText, validateParts, withGwa, type Part } from "./parts";

// 30-slide, 7-minute pitch: 서비스 소개 1–20장 5분, 사업화 전략 21–30장 2분.
const PARTS: Part[] = [
  { name: "서비스 소개", from: 0, to: 19, targetSec: 300 },
  { name: "사업화 전략", from: 20, to: 29, targetSec: 120 },
];

const slides = (n: number, ms: (i: number) => number) => Array.from({ length: n }, (_, i) => ms(i));

describe("parts: validation", () => {
  it("accepts ranges inside the deck that don't overlap", () => {
    expect(validateParts(PARTS, 30)).toEqual([{}, {}]);
  });

  it("flags ranges outside the deck, reversed, or overlapping", () => {
    expect(validateParts([{ name: "a", from: 0, to: 30 }], 30)[0].range).toContain("1–30장");
    expect(validateParts([{ name: "a", from: 5, to: 2 }], 30)[0].range).toContain("뒤에");
    const overlap = validateParts(
      [
        { name: "앞", from: 0, to: 10 },
        { name: "뒤", from: 10, to: 20 },
      ],
      30,
    );
    expect(overlap[0].range).toContain("뒤");
    expect(overlap[1].range).toContain("앞");
  });

  it("sums the part targets", () => {
    expect(partTargetSum(PARTS)).toBe(420);
    expect(partTargetSum([{ name: "a", from: 0, to: 1 }])).toBeNull();
  });
});

describe("parts: results of a run", () => {
  it("whole deck practiced: actual time and the difference to each target", () => {
    // 서비스 소개: 20 slides × 16.2 s = 5분 24초; 사업화 전략: 10 × 9.6 s = 1분 36초
    const ms = slides(30, (i) => (i < 20 ? 16200 : 9600));
    const { parts, rest } = partResults(ms, PARTS);
    expect(parts[0]).toMatchObject({ status: "full", actualMs: 324000, practiced: 20, slides: 20, deltaMs: 24000 });
    expect(parts[1]).toMatchObject({ status: "full", actualMs: 96000, deltaMs: -24000 });
    expect(targetDeltaText(parts[0].deltaMs!, formatDuration)).toEqual({ text: "24초 초과", tone: "over" });
    expect(targetDeltaText(parts[1].deltaMs!, formatDuration)).toEqual({ text: "24초 짧음", tone: "under" });
    expect(rest).toEqual([]);
  });

  it("only 5 slides of the first part: partial, no over/under, second part not practiced", () => {
    const ms = slides(30, (i) => (i < 5 ? 18200 : 0)); // 1분 31초 over 5 slides
    const { parts } = partResults(ms, PARTS);
    expect(parts[0]).toMatchObject({ status: "partial", actualMs: 91000, practiced: 5, slides: 20, deltaMs: null });
    expect(formatDuration(parts[0].actualMs)).toBe("1분 31초");
    expect(parts[1]).toMatchObject({ status: "none", actualMs: 0, deltaMs: null });
  });

  it("going back to a slide adds to its part (slideMs already sums visits)", () => {
    // PRD T2: slide 1 = 20 s + 5 s after coming back, slide 2 = 30 s
    const twoParts: Part[] = [
      { name: "앞", from: 0, to: 0, targetSec: 20 },
      { name: "뒤", from: 1, to: 1, targetSec: 30 },
    ];
    const { parts } = partResults([25000, 30000], twoParts);
    expect(parts[0]).toMatchObject({ actualMs: 25000, deltaMs: 5000 });
    expect(parts[1]).toMatchObject({ actualMs: 30000, deltaMs: 0 });
  });

  it("practiced slides outside every part are listed apart", () => {
    const { rest } = partResults([1000, 0, 2000, 3000], [{ name: "a", from: 0, to: 1 }]);
    expect(rest).toEqual([2, 3]);
  });

  it("a part without a target shows no difference", () => {
    const { parts } = partResults([1000, 1000], [{ name: "a", from: 0, to: 1 }]);
    expect(parts[0]).toMatchObject({ status: "full", deltaMs: null });
  });
});

describe("parts: comparing two runs", () => {
  it("is neutral: more / less time", () => {
    expect(compareDeltaText(12000, formatDuration)).toBe("12초 더 걸림");
    expect(compareDeltaText(-12000, formatDuration)).toBe("12초 덜 걸림");
    expect(compareDeltaText(400, formatDuration)).toBe("비슷함");
  });
});

describe("parts: wording", () => {
  it("picks 과/와 after the part name", () => {
    expect(withGwa("사업화 전략")).toBe("사업화 전략과");
    expect(withGwa("서비스 소개")).toBe("서비스 소개와");
    expect(withGwa("파트 1")).toBe("파트 1과");
    expect(withGwa("파트 2")).toBe("파트 2와");
  });
});
