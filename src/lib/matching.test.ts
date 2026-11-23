import { describe, expect, it } from "vitest";
import {
  createTracker,
  detectLang,
  feed,
  followSpeech,
  limitToHeard,
  spokenSoFar,
  isInformative,
  normalize,
  phraseEnd,
  sameSyllableStart,
  wordEnd,
  spokenCharIndex,
  semanticScores,
  setPosition,
  speechWindow,
  startedNextSlide,
  type TrackerState,
} from "./matching";

/** Simulates the recognizer: each part arrives as interim, then is confirmed as final. */
function speak(
  state: TrackerState,
  finals: string,
  parts: string[],
  semantic?: (number | undefined)[],
): { state: TrackerState; finals: string } {
  let s = state;
  let f = finals;
  for (const p of parts) {
    s = feed(s, f, p, semantic);
    f = `${f} ${p}`;
    s = feed(s, f, "", semantic);
  }
  return { state: s, finals: f };
}

const KO = [
  "안녕하세요, 오늘 발표를 맡은 김예찬입니다.",
  "여러분, 발표하다가 대본에서 어디까지 읽었는지 놓쳐본 적 있으신가요?",
  "저도 그랬습니다.",
  "고개를 들었다가 다시 내리면, 줄을 찾느라 몇 초씩 멈추게 되죠.",
];

const EN = [
  "Good morning, everyone.",
  "Today I want to show you how presenters lose their place.",
  "Our tool highlights the phrase you are saying right now.",
  "Thank you for listening.",
];

describe("helpers", () => {
  it("detects the script language", () => {
    expect(detectLang(KO.join(" "))).toBe("ko");
    expect(detectLang(EN.join(" "))).toBe("en");
    expect(detectLang("SlideCue로 발표를 연습합니다")).toBe("ko");
  });

  it("normalizes for comparison only", () => {
    expect(normalize("Hello, World!  2024년.")).toBe("hello world 2024년");
  });

  it("keeps a short window of the latest speech", () => {
    expect(speechWindow("가".repeat(40) + "나다라", "ko")).toHaveLength(14);
    expect(speechWindow("one two three four five six seven eight nine ten", "en")).toBe(
      "five six seven eight nine ten",
    );
  });

  it("treats numbers and filler words as uninformative", () => {
    expect(isInformative("300", "ko")).toBe(false);
    expect(isInformative("그리고음", "ko")).toBe(false);
    expect(isInformative("and so 2024", "en")).toBe(false);
    expect(isInformative("발표를맡은", "ko")).toBe(true);
  });

  it("scores meaning by how clearly one phrase beats the rest (values measured with e5-small)", () => {
    // paraphrase of phrase 2: high and ahead
    const para = semanticScores([0.839, 0.872, 0.853]);
    expect(para[1]).toBeGreaterThan(0.5);
    expect(para[0]).toBe(0);
    // unrelated ad-libs: below the gate, or no clear winner
    expect(Math.max(...semanticScores([0.852, 0.837, 0.856]))).toBe(0);
    expect(Math.max(...semanticScores([0.864, 0.847, 0.867]))).toBeLessThan(0.5);
    expect(semanticScores([undefined, 0.9])).toEqual([0, 1]);
  });
});

describe("tracking — Korean", () => {
  it("stays on a phrase while it is being said", () => {
    let t = createTracker(KO, "ko");
    ({ state: t } = speak(t, "", ["안녕하세요 오늘 발표를"]));
    expect(t.index).toBe(0);
  });

  it("moves to the next phrase as soon as the current one's ending is said", () => {
    let t = createTracker(KO, "ko");
    let finals = "";
    ({ state: t, finals } = speak(t, finals, ["안녕하세요 오늘 발표를", "맡은 김예찬입니다"]));
    expect(t.index).toBe(1);
    ({ state: t, finals } = speak(t, finals, ["여러분 발표하다가 대본에서", "어디까지 읽었는지 놓쳐본 적 있으신가요"]));
    expect(t.index).toBe(2);
    ({ state: t, finals } = speak(t, finals, ["저도 그랬습니다"]));
    expect(t.index).toBe(3);
    ({ state: t } = speak(t, finals, ["고개를 들었다가 다시 내리면"]));
    expect(t.index).toBe(3); // last phrase: nothing after it to move to
  });

  it("jumps straight to the phrase being said when the speaker skips ahead", () => {
    let t = createTracker(KO, "ko");
    ({ state: t } = speak(t, "", ["고개를 들었다가 다시 내리면"]));
    expect(t.index).toBe(3);
  });

  it("holds its place during an ad-lib, then picks up again", () => {
    let t = createTracker(KO, "ko");
    let finals = "";
    ({ state: t, finals } = speak(t, finals, ["안녕하세요 오늘 발표를"]));
    ({ state: t, finals } = speak(t, finals, ["아 잠깐만요 물 한 모금 마실게요", "죄송합니다"]));
    expect(t.index).toBe(0);
    ({ state: t } = speak(t, finals, ["여러분 발표하다가 대본에서 어디까지"]));
    expect(t.index).toBe(1);
  });

  it("does not move on numbers or filler alone", () => {
    let t = createTracker(["매출은 300억입니다.", "2024년에 300명이 썼습니다."], "ko");
    ({ state: t } = speak(t, "", ["음 그리고 300", "2024"]));
    expect(t.index).toBe(0);
  });
});

describe("tracking — meaning (on-device sentence model)", () => {
  it("moves at once on a clear meaning match, waits for a second look on a borderline one", () => {
    const segs = ["시간이 부족해서 늘 불편했습니다.", "그래서 자동으로 넘겨주는 기능을 만들었습니다."];
    const said = "다음 장으로 알아서 바뀌는 걸 개발했죠";
    // measured e5 cosines for this paraphrase: clear lead → immediate
    expect(feed(createTracker(segs, "ko"), "", said, [0.839, 0.872]).index).toBe(1);
    // borderline lead → needs a second, agreeing update
    const once = feed(createTracker(segs, "ko"), "", said, [0.855, 0.868]);
    expect(once.index).toBe(0);
    expect(feed(once, "", said, [0.855, 0.868]).index).toBe(1);
  });

  const SEGS = ["시간이 부족해서 늘 불편했습니다.", "그래서 저희는 슬라이드를 자동으로 넘겨주는 기능을 만들었습니다."];

  it("follows a paraphrase when the meaning matches the next phrase", () => {
    let t = createTracker(SEGS, "ko");
    // Lexically far from phrase 2, but the model says it means the same thing.
    ({ state: t } = speak(t, "", ["다음 장으로 알아서 바뀌는 걸 개발했죠"], [0.84, 0.88]));
    expect(t.index).toBe(1);
  });

  it("ignores weak meaning matches", () => {
    let t = createTracker(SEGS, "ko");
    ({ state: t } = speak(t, "", ["오늘 날씨가 정말 좋네요"], [0.843, 0.859]));
    expect(t.index).toBe(0);
  });

  it("still holds on numbers alone, whatever the model says", () => {
    let t = createTracker(SEGS, "ko");
    ({ state: t } = speak(t, "", ["300"], [0.8, 0.95]));
    expect(t.index).toBe(0);
  });
});

describe("tracking — English", () => {
  it("follows word order and moves on at each phrase ending", () => {
    let t = createTracker(EN, "en");
    let finals = "";
    ({ state: t, finals } = speak(t, finals, ["today i want to show you"]));
    expect(t.index).toBe(1);
    ({ state: t, finals } = speak(t, finals, ["how presenters lose their place"]));
    expect(t.index).toBe(2);
    ({ state: t } = speak(t, finals, ["our tool highlights the phrase"]));
    expect(t.index).toBe(2);
  });

  it("prefers the current copy of a repeated line over a later one", () => {
    const segs = ["Thank you all for coming today.", "Here is the plan.", "Thank you all for coming today."];
    let t = createTracker(segs, "en");
    ({ state: t } = speak(t, "", ["thank you all for"]));
    expect(t.index).toBe(0);
  });
});

describe("forward only", () => {
  it("never moves back on its own, even when the previous phrase is repeated", () => {
    let t = setPosition(createTracker(KO, "ko"), 2, 0);
    ({ state: t } = speak(t, "", ["여러분 발표하다가 대본에서 어디까지 읽었는지"]));
    expect(t.index).toBe(2);
    ({ state: t } = speak(t, "", ["여러분 발표하다가 대본에서 어디까지 읽었는지 놓쳐본 적"]));
    expect(t.index).toBe(2);
  });
});

describe("manual correction", () => {
  it("can go back when the presenter clicks an earlier phrase", () => {
    const t = setPosition(setPosition(createTracker(KO, "ko"), 3, 0), 1, 0);
    expect(t.index).toBe(1);
  });

  it("restarts tracking from the chosen phrase and ignores earlier speech", () => {
    let t = createTracker(KO, "ko");
    let finals = "";
    ({ state: t, finals } = speak(t, finals, ["여러분 발표하다가 대본에서 어디까지"]));
    expect(t.index).toBe(1);
    t = setPosition(t, 3, finals.length);
    expect(t.index).toBe(3);
    t = feed(t, finals, "");
    expect(t.index).toBe(3);
  });
});

describe("auto-advance — next slide started", () => {
  const SLIDE1 = ["안녕하세요, 오늘 발표를 맡은 김예찬입니다.", "저희 서비스는 발표 연습을 돕습니다."];
  const SLIDE2 = ["첫 번째로 고객이 겪는 문제를 말씀드리겠습니다.", "연습 시간이 늘 부족합니다."];

  const atLast = () => setPosition(createTracker(SLIDE1, "ko"), 1, 0);

  it("fires when the last phrase is reached and the next slide's opening is said", () => {
    expect(startedNextSlide(atLast(), "", "첫 번째로 고객이 겪는 문제를", SLIDE2)).toBe(true);
  });

  it("also fires on the next slide's second phrase (the speaker skipped the first)", () => {
    expect(startedNextSlide(atLast(), "", "연습 시간이 늘 부족합니다", SLIDE2)).toBe(true);
  });

  it("does not fire before the last phrase is reached", () => {
    expect(startedNextSlide(createTracker(SLIDE1, "ko"), "", "첫 번째로 고객이 겪는 문제를", SLIDE2)).toBe(false);
  });

  it("does not fire on silence, ad-libs, or while still finishing this slide", () => {
    expect(startedNextSlide(atLast(), "", "", SLIDE2)).toBe(false);
    expect(startedNextSlide(atLast(), "", "아 잠시만요 물 좀 마실게요", SLIDE2)).toBe(false);
    expect(startedNextSlide(atLast(), "", "서비스는 발표 연습을 돕습니다", SLIDE2)).toBe(false);
  });

  it("uses meaning scores for a reworded opening", () => {
    expect(startedNextSlide(atLast(), "", "먼저 사용자들의 불편함부터 보겠습니다", SLIDE2, [0.9, 0])).toBe(true);
  });

  it("treats a slide with no script as finished", () => {
    const cover = createTracker([], "ko");
    expect(startedNextSlide(cover, "", "첫 번째로 고객이 겪는 문제를", SLIDE2)).toBe(true);
  });

  it("never fires when there is no next slide", () => {
    expect(startedNextSlide(atLast(), "", "첫 번째로 고객이 겪는 문제를", [])).toBe(false);
  });
});

describe("spoken character position (for the star marker)", () => {
  const KO_LINE = "안녕하세요, 오늘 발표를 맡은 김예찬입니다.";

  it("points at the last character of the latest recognized word", () => {
    expect(spokenCharIndex(KO_LINE, "", "ko")).toBe(-1);
    expect(spokenCharIndex(KO_LINE, "안녕하세요", "ko")).toBe(KO_LINE.indexOf("요"));
    expect(spokenCharIndex(KO_LINE, "안녕하세요 오늘 발표를", "ko")).toBe(KO_LINE.indexOf("를"));
  });

  it("never runs ahead of what was said, and never moves back", () => {
    const at = spokenCharIndex(KO_LINE, "안녕하세요 오늘", "ko");
    expect(at).toBe(KO_LINE.indexOf("늘"));
    // an ad-lib that isn't in the line keeps the position
    expect(spokenCharIndex(KO_LINE, "안녕하세요 오늘 아 잠시만요", "ko", at)).toBe(at);
    // a word from earlier in the line doesn't pull it back
    expect(spokenCharIndex(KO_LINE, "안녕하세요", "ko", at)).toBe(at);
  });

  it("still advances when a burst of speech has already run into the next phrase", () => {
    // the end of this phrase arrives together with the start of the next one
    expect(spokenCharIndex(KO_LINE, "맡은 김예찬입니다 저희 서비스는", "ko", 3)).toBe(KO_LINE.indexOf("다"));
  });

  it("skips punctuation and spaces in the display text", () => {
    expect(spokenCharIndex(KO_LINE, "김예찬입니다", "ko")).toBe(KO_LINE.indexOf("다"));
  });

  it("works word by word in English", () => {
    const line = "Our tool highlights the phrase you are saying.";
    expect(spokenCharIndex(line, "our tool", "en")).toBe(line.indexOf("tool") + 3);
    expect(spokenCharIndex(line, "our tool highlights", "en", 7)).toBe(line.indexOf("highlights") + 9);
    expect(spokenCharIndex(line, "um", "en", 7)).toBe(7);
  });
});

describe("word end (a begun word will be finished)", () => {
  const line = "실제로 해본 일이 있어도, 글로 옮기기 어렵습니다.";

  it("moves from the first syllable of a word to its end, punctuation included", () => {
    const at = spokenCharIndex(line, "실제로 해본 일이 있어도 글로 옮기기 어려워요", "ko");
    // The ending was said differently, so the match stops early ("어", plus "려"↔"렵")…
    expect(line[at]).toBe("렵");
    // …but the word has begun, so the star goes to the end of the phrase.
    expect(wordEnd(line, at)).toBe(phraseEnd(line));
  });

  it("stops at the space before the next word", () => {
    expect(wordEnd(line, line.indexOf("해"))).toBe(line.indexOf("본"));
    expect(wordEnd(line, line.indexOf("도"))).toBe(line.indexOf(","));
  });

  it("keeps the not-started position", () => {
    expect(wordEnd(line, -1)).toBe(-1);
  });

  it("phrase end ignores trailing spaces", () => {
    expect(phraseEnd("어렵습니다.  ")).toBe(5);
    expect(phraseEnd("")).toBe(-1);
  });
});

describe("a word said with a different ending", () => {
  const line = "화면에 보이는 두 서류를 비교해 보세요.";

  it("syllables with the same first consonant count as the same start", () => {
    expect(sameSyllableStart("보", "볼")).toBe(true);
    expect(sameSyllableStart("보", "봐")).toBe(true);
    expect(sameSyllableStart("하", "해")).toBe(true);
    expect(sameSyllableStart("보", "고")).toBe(false);
    expect(sameSyllableStart("a", "a")).toBe(true);
    expect(sameSyllableStart("a", "b")).toBe(false);
  });

  it("'비교해 볼게요' for '비교해 보세요' reaches the end of the phrase", () => {
    const at = spokenCharIndex(line, "화면에 보이는 두 서류를 비교해 볼게요", "ko");
    expect(at).toBe(line.lastIndexOf("보"));
    expect(wordEnd(line, at)).toBe(phraseEnd(line));
  });

  it("does not start the word when the next syllable is different", () => {
    const at = spokenCharIndex(line, "화면에 보이는 두 서류를 비교해 그러니까", "ko");
    expect(at).toBe(line.indexOf("해"));
  });
});

describe("the same verb with any ending counts as said", () => {
  const finished = (line: string, said: string) =>
    wordEnd(line, spokenCharIndex(line, said, "ko")) >= phraseEnd(line);
  const line = "화면에 보이는 두 서류를 비교해 보세요.";

  it.each(["보겠습니다", "보도록 할게요", "볼게요", "봐요", "봅시다", "보시죠"])(
    "비교해 %s → 비교해 보세요 finished",
    (ending) => {
      expect(finished(line, `화면에 보이는 두 서류를 비교해 ${ending}`)).toBe(true);
    },
  );

  it("works when the verb itself changes shape (합니다/해요, 됩니다/돼요)", () => {
    expect(finished("오늘 결과를 정리합니다.", "오늘 결과를 정리해 볼게요")).toBe(true);
    expect(finished("그래서 이 방법이 됩니다.", "그래서 이 방법이 돼요")).toBe(true);
  });

  it("an auxiliary last word may be said differently (보시기 바랍니다 → 보세요)", () => {
    expect(finished("이 부분은 꼭 확인해 보시기 바랍니다.", "이 부분은 꼭 확인해 보세요")).toBe(true);
  });

  it("does not finish while the speaker stops before the last words", () => {
    const long = "여러 문단에 걸쳐 풀어낼 수 있습니다.";
    expect(finished(long, "여러 문단에 걸쳐 풀어")).toBe(false);
    expect(finished(long, "여러 문단에 걸쳐 풀어낼 그러니까")).toBe(false);
    expect(finished(line, "화면에 보이는 두 서류를 비교해")).toBe(false);
  });
});

describe("no runaway: leftover or short speech never skips phrases or slides", () => {
  const slide4 = [
    "많은 기업에서는 이력서가 먼저 에이티에스, 즉 지원자 추적 시스템에 등록됩니다.",
    "채용팀은 이 시스템을 통해 지원서를 모으고, 필요한 경력이나 기술을 갖춘 지원자를 검색할 수 있습니다.",
  ];

  /** What the tracking hook does on each recognizer update. */
  function update(s: { state: TrackerState; at: number }, finals: string, interim: string) {
    let step = followSpeech(s.state, finals, interim, s.at);
    let moves = 0;
    while (step.moved) {
      moves++;
      step = followSpeech(step.state, finals, interim, -1);
    }
    return { state: step.state, at: step.at, moves, slideDone: step.slideDone };
  }

  it("half of the first sentence, word by word as an in-progress guess, stays on it", () => {
    let s = { state: createTracker(slide4, "ko", 0), at: -1 };
    let interim = "";
    for (const w of "많은 기업에서는 이력서가 먼저 에이티에스 즉 지원자".split(" ")) {
      interim = interim ? `${interim} ${w}` : w;
      const r = update(s, "", interim);
      expect(r.moves).toBe(0);
      expect(r.slideDone).toBe(false);
      s = r;
    }
    expect(s.state.index).toBe(0);
  });

  it("after finishing a sentence, the words still in progress don't count for the next one", () => {
    const first = "많은 기업에서는 이력서가 먼저 에이티에스 즉 지원자 추적 시스템에 등록됩니다";
    const r = update({ state: createTracker(slide4, "ko", 0), at: -1 }, "", first);
    expect(r.moves).toBe(1); // on to the 2nd sentence, once
    expect(r.state.index).toBe(1);
    // The same guess, a little longer: only the new word is heard for sentence 2
    const r2 = update(r, "", `${first} 채용팀은`);
    expect(r2.moves).toBe(0);
    expect(r2.slideDone).toBe(false);
    // …and when the guess is confirmed, nothing old comes back
    const r3 = update(r2, ` ${first} 채용팀은`, "");
    expect(r3.slideDone).toBe(false);
    expect(slide4[1].slice(0, r3.at + 1)).toBe("채용팀은");
  });

  it("a stray '니다' can't finish a long phrase", () => {
    expect(limitToHeard(slide4[1], slide4[1].length - 1, "니다")).toBeLessThan(6);
  });

  it("offsets survive the guess being confirmed (same length)", () => {
    expect(spokenSoFar(" 하나 둘", "셋").length).toBe(spokenSoFar(" 하나 둘 셋", "").length);
  });
});

describe("sentence endings say nothing about position", () => {
  const slide2 = [
    "화면에 보이는 두 서류를 비교해 보세요.",
    "한국 자기소개서에서는 한 가지 경험을 여러 문단에 걸쳐 풀어낼 수 있습니다.",
    "미국식 이력서에서는 같은 경험을 서너 줄로 압축해, 내가 맡은 일과 성과를 한눈에 보여줘야 합니다.",
  ];

  // The previous slide ended on "…스크리비를 소개하도록 하겠습니다": the slide moved
  // at "소개하", and the rest of that sentence arrives on this slide.
  it.each(["하겠습니다", "도록 하겠습니다", "소개하도록 하겠습니다"])("'%s' left over from the last slide keeps the first phrase", (left) => {
    let t = createTracker(slide2, "ko", 0);
    t = feed(t, "", left);
    t = feed(t, ` ${left}`, "");
    expect(t.index).toBe(0);
  });

  it("the first phrase is still followed after the leftover", () => {
    let t = createTracker(slide2, "ko", 0);
    t = feed(t, " 하겠습니다", "화면에 보이는 두 서류를");
    expect(t.index).toBe(0);
    t = feed(t, " 하겠습니다", "화면에 보이는 두 서류를 비교해 보세요 한국 자기소개서에서는");
    expect(t.index).toBe(1);
  });
});
