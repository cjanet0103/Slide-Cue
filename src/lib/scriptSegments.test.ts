import { describe, expect, it } from "vitest";
import { splitScript } from "./scriptSegments";

describe("splitScript", () => {
  it("returns no segments for an empty or blank script", () => {
    expect(splitScript("")).toEqual([]);
    expect(splitScript("  \n\n  ")).toEqual([]);
  });

  it("splits on line breaks", () => {
    expect(splitScript("첫 줄\n둘째 줄\r\n셋째 줄")).toEqual(["첫 줄", "둘째 줄", "셋째 줄"]);
  });

  it("splits Korean and English sentences within a line", () => {
    expect(splitScript("고객은 시간이 부족합니다. 그래서 우리는 이걸 만들었어요! Why now? Because.")).toEqual([
      "고객은 시간이 부족합니다.",
      "그래서 우리는 이걸 만들었어요!",
      "Why now?",
      "Because.",
    ]);
  });

  it("does not split decimals or numbers", () => {
    expect(splitScript("매출이 3.5배 늘었습니다.")).toEqual(["매출이 3.5배 늘었습니다."]);
  });
});
