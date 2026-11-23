import { describe, expect, it } from "vitest";
import { audienceUrl, pickAudienceScreen, readMessage, windowFeaturesFor } from "./audience";

describe("audience link messages", () => {
  it("accepts slide, hello, step and bye", () => {
    expect(readMessage({ kind: "slide", session: "s", slide: 3 })).toEqual({ kind: "slide", session: "s", slide: 3 });
    expect(readMessage({ kind: "hello", session: "s" })).toEqual({ kind: "hello", session: "s" });
    expect(readMessage({ kind: "step", session: "s", delta: -1 })).toEqual({ kind: "step", session: "s", delta: -1 });
    expect(readMessage({ kind: "bye", session: "s" })).toEqual({ kind: "bye", session: "s" });
    expect(readMessage({ kind: "end", session: "s" })).toEqual({ kind: "end", session: "s" });
  });

  it("drops anything malformed", () => {
    expect(readMessage(null)).toBeNull();
    expect(readMessage({ kind: "slide", session: "s", slide: -1 })).toBeNull();
    expect(readMessage({ kind: "slide", session: "", slide: 1 })).toBeNull();
    expect(readMessage({ kind: "step", session: "s", delta: 2 })).toBeNull();
    expect(readMessage({ kind: "script", session: "s", text: "안녕하세요" })).toBeNull();
  });

  it("keeps only the slide number when extra fields are sent (no script reaches the audience)", () => {
    expect(readMessage({ kind: "slide", session: "s", slide: 1, text: "대본" })).toEqual({
      kind: "slide",
      session: "s",
      slide: 1,
    });
  });

  it("picks the projector: another screen, non-primary first", () => {
    const laptop = { availLeft: 0, availTop: 0, availWidth: 1440, availHeight: 900, isPrimary: true };
    const projector = { availLeft: 1440, availTop: 0, availWidth: 1920, availHeight: 1080, isPrimary: false };
    expect(pickAudienceScreen([laptop, projector], laptop)).toBe(projector);
    // Presenter window dragged onto the projector: the other screen is the laptop.
    expect(pickAudienceScreen([laptop, projector], projector)).toBe(laptop);
    expect(pickAudienceScreen([laptop], laptop)).toBeNull();
    expect(windowFeaturesFor(projector)).toBe("popup,left=1440,top=0,width=1920,height=1080");
  });

  it("puts only ids in the address", () => {
    expect(audienceUrl("p1", "abc")).toBe("/app/audience?project=p1&session=abc");
  });
});
