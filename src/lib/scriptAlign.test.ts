import { describe, expect, it } from "vitest";
import { alignParagraphs, composeWholeScript, splitByMarkers, splitBySeparator, splitParagraphs, splitWholeScript } from "./scriptAlign";

const empty3 = ["", "", ""];

describe("splitByMarkers", () => {
  it("splits on [n] markers, inline or on their own lines", () => {
    expect(splitByMarkers("[1] 안녕하세요. [2] 고객 문제입니다.\n[3]\n해결책입니다.", 3)).toEqual([
      "안녕하세요.",
      "고객 문제입니다.",
      "해결책입니다.",
    ]);
  });

  it("splits on 슬라이드 n / 1번 / slide n line markers", () => {
    expect(splitByMarkers("슬라이드 1\n표지\n슬라이드 2: 문제\n슬라이드 3) 해결", 3)).toEqual(["표지", "문제", "해결"]);
    expect(splitByMarkers("1번 표지\n2번 문제\n3번 해결", 3)).toEqual(["표지", "문제", "해결"]);
    expect(splitByMarkers("Slide 1 - Hello\nSlide 3 - Solution", 3)).toEqual(["Hello", "", "Solution"]);
  });

  it("keeps text before the first marker and merges repeated numbers", () => {
    expect(splitByMarkers("인사말\n[1] 표지\n[2] 문제\n[2] 보충", 3)).toEqual(["인사말\n표지", "문제\n보충", ""]);
  });

  it("ignores markers out of range or out of order", () => {
    expect(splitByMarkers("[1] a [5] b", 3)).toBeNull();
    expect(splitByMarkers("[2] a [1] b", 3)).toBeNull();
    expect(splitByMarkers("마커 없는 대본", 3)).toBeNull();
  });
});

describe("splitParagraphs", () => {
  it("prefers blank-line paragraphs, falls back to lines", () => {
    expect(splitParagraphs("a\nb\n\nc")).toEqual(["a\nb", "c"]);
    expect(splitParagraphs("a\nb\nc")).toEqual(["a", "b", "c"]);
  });
});

describe("alignParagraphs", () => {
  it("spreads paragraphs in order when slides have no text", () => {
    expect(alignParagraphs(["가", "나", "다"], empty3).slides).toEqual(["가", "나", "다"]);
    const two = alignParagraphs(["가", "나"], ["", "", "", ""]).slides;
    expect(two.filter(Boolean)).toEqual(["가", "나"]);
    expect(two.indexOf("가")).toBeLessThan(two.indexOf("나"));
  });

  it("places paragraphs on the slide whose text matches", () => {
    const { slides, usedText } = alignParagraphs(
      ["안녕하세요, 저희 팀 소개부터 하겠습니다.", "저희의 해결책은 자동 넘김입니다."],
      ["팀 소개", "고객 문제", "해결책 자동 넘김"],
    );
    expect(usedText).toBe(true);
    expect(slides).toEqual(["안녕하세요, 저희 팀 소개부터 하겠습니다.", "", "저희의 해결책은 자동 넘김입니다."]);
  });

  it("never reorders paragraphs", () => {
    const { slides } = alignParagraphs(["해결책 이야기", "팀 소개 이야기"], ["팀 소개", "해결책"]);
    expect(slides.join("|").indexOf("해결책")).toBeLessThan(slides.join("|").indexOf("팀 소개"));
  });
});

describe("splitBySeparator", () => {
  it("splits on a standalone / inline or on its own line", () => {
    expect(splitBySeparator("안녕하세요 / 고객 문제 / 해결책")).toEqual(["안녕하세요", "고객 문제", "해결책"]);
    expect(splitBySeparator("첫 장\n/\n둘째 장")).toEqual(["첫 장", "둘째 장"]);
  });

  it("ignores slashes inside words", () => {
    expect(splitBySeparator("A/B 테스트를 3/4분기에 했어요")).toBeNull();
  });
});

describe("composeWholeScript", () => {
  it("gives an empty text when no slide has a script", () => {
    expect(composeWholeScript(["", " ", ""])).toBe("");
  });

  it("round-trips through splitWholeScript, including empty slides", () => {
    const slides = ["표지 인사", "", "해결책 첫 줄\n해결책 둘째 줄"];
    const whole = composeWholeScript(slides);
    expect(whole).toBe("표지 인사\n/\n\n/\n해결책 첫 줄\n해결책 둘째 줄");
    expect(splitWholeScript(whole, ["", "", ""])).toEqual({ slides, method: "separator" });
  });
});

describe("splitWholeScript", () => {
  it("places / chunks by content when their count differs from the slides", () => {
    const { slides, method } = splitWholeScript("팀 소개입니다 / 해결책입니다", ["팀 소개", "고객 문제", "해결책"]);
    expect(method).toBe("separator");
    expect(slides).toEqual(["팀 소개입니다", "", "해결책입니다"]);
  });

  it("reports which method was used", () => {
    expect(splitWholeScript("[1] a [2] b", ["", ""]).method).toBe("markers");
    expect(splitWholeScript("a / b", ["", ""]).method).toBe("separator");
    expect(splitWholeScript("a\n\nb", ["", ""]).method).toBe("order");
    expect(splitWholeScript("팀 소개\n\n해결책", ["팀 소개", "해결책"]).method).toBe("match");
  });
});
