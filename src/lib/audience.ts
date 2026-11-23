/**
 * Presenter ↔ audience window link (PRD §1, F3, T7).
 *
 * Both windows are on the same machine and origin, so a BroadcastChannel is
 * enough. Messages carry ONLY a session id and a slide number (or a ±1 step
 * from the audience window's keyboard / clicker). Never put script, transcript,
 * notes or recording state in here: the audience window must not receive them.
 */

export const AUDIENCE_CHANNEL = "slidecue-audience";

export type AudienceMessage =
  /** Presenter → audience: show this slide (0-based). */
  | { kind: "slide"; session: string; slide: number }
  /** Audience → presenter: just opened (or reloaded); please send the slide. */
  | { kind: "hello"; session: string }
  /** Audience → presenter: a key / clicker press in the audience window. */
  | { kind: "step"; session: string; delta: 1 | -1 }
  /** Either way: this window closed (or left this presentation). */
  | { kind: "bye"; session: string }
  /** Presenter → audience: the talk ended; the audience window closes itself. */
  | { kind: "end"; session: string };

/** Accepts only well-formed messages; anything else on the channel is ignored. */
export function readMessage(data: unknown): AudienceMessage | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  if (typeof m.session !== "string" || !m.session) return null;
  switch (m.kind) {
    case "slide":
      return Number.isInteger(m.slide) && (m.slide as number) >= 0
        ? { kind: "slide", session: m.session, slide: m.slide as number }
        : null;
    case "hello":
    case "bye":
    case "end":
      return { kind: m.kind, session: m.session };
    case "step":
      return m.delta === 1 || m.delta === -1 ? { kind: "step", session: m.session, delta: m.delta } : null;
    default:
      return null;
  }
}

/** The parts of a screen (Window Management API's ScreenDetailed) used to place the window. */
export interface ScreenBox {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  isPrimary?: boolean;
}

/**
 * The projector: a screen other than the one the presenter is on, preferring a
 * non-primary one (the laptop's own screen is usually primary). Null with one screen.
 */
export function pickAudienceScreen<S extends ScreenBox>(screens: readonly S[], current: S): S | null {
  const others = screens.filter((s) => s !== current);
  return others.find((s) => !s.isPrimary) ?? others[0] ?? null;
}

/** window.open features covering that screen. */
export const windowFeaturesFor = (s: ScreenBox) =>
  `popup,left=${s.availLeft},top=${s.availTop},width=${s.availWidth},height=${s.availHeight}`;

/** /app/audience address for a project and session (ids only — never names). */
export const audienceUrl = (projectId: string, session: string) =>
  `/app/audience?project=${encodeURIComponent(projectId)}&session=${encodeURIComponent(session)}`;

export const AUDIENCE_WINDOW_NAME = "slidecue-audience";
