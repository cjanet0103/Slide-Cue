"use client";

import { useEffect, useRef, useState } from "react";
import { newId } from "@/lib/db";
import {
  AUDIENCE_CHANNEL,
  AUDIENCE_WINDOW_NAME,
  audienceUrl,
  pickAudienceScreen,
  readMessage,
  windowFeaturesFor,
  type AudienceMessage,
  type ScreenBox,
} from "@/lib/audience";

const SESSION_KEY = (projectId: string) => `slidecue.audienceSession.${projectId}`;

/** Same session across a reload of the presenter tab, so an open audience window reconnects. */
function sessionFor(projectId: string): string {
  try {
    const saved = sessionStorage.getItem(SESSION_KEY(projectId));
    if (saved) return saved;
    const id = newId();
    sessionStorage.setItem(SESSION_KEY(projectId), id);
    return id;
  } catch {
    return newId();
  }
}

// Window Management API (Chromium): which screens exist and where they are.
type Detailed = ScreenBox & EventTarget;
interface ScreenDetails extends EventTarget {
  screens: Detailed[];
  currentScreen: Detailed;
}
type WithScreens = Window & { getScreenDetails?: () => Promise<ScreenDetails> };
// `isExtended` and the screen "change" event exist in Chromium only.
type ExtendedScreen = Screen & Partial<EventTarget> & { isExtended?: boolean };

/** True when a second display (projector) is connected; updates when one is plugged in or out. */
function useSecondScreen(): boolean {
  const [extended, setExtended] = useState(false);
  useEffect(() => {
    const s = window.screen as ExtendedScreen;
    const read = () => setExtended(s.isExtended === true);
    read();
    s.addEventListener?.("change", read);
    return () => s.removeEventListener?.("change", read);
  }, []);
  return extended;
}

/**
 * Presenter side of the audience screen (PowerPoint-style presenter view):
 * with a projector connected, `open()` puts a slide-only window on it, and the
 * editor stays here with the script. Sends the current slide number — nothing
 * else — whenever it changes. `onStep` gets ±1 from a clicker pressed while
 * the audience window has focus.
 */
export function useAudienceLink(projectId: string, slide: number, onStep: (delta: 1 | -1) => void) {
  const [session] = useState(() => sessionFor(projectId));
  const [connected, setConnected] = useState(false);
  const secondScreen = useSecondScreen();
  const channel = useRef<BroadcastChannel | null>(null);
  const latest = useRef({ slide, onStep });

  useEffect(() => {
    latest.current = { slide, onStep };
  });

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(AUDIENCE_CHANNEL);
    channel.current = ch;
    const send = (m: AudienceMessage) => ch.postMessage(m);
    ch.onmessage = (e) => {
      const m = readMessage(e.data);
      if (!m || m.session !== session) return;
      if (m.kind === "hello") {
        setConnected(true);
        send({ kind: "slide", session, slide: latest.current.slide });
      } else if (m.kind === "step") {
        latest.current.onStep(m.delta);
      } else if (m.kind === "bye") {
        setConnected(false); // the audience window was closed
      }
    };
    // An audience window left open from before a reload picks the slide up again.
    send({ kind: "slide", session, slide: latest.current.slide });
    const bye = () => send({ kind: "bye", session });
    window.addEventListener("pagehide", bye);
    return () => {
      window.removeEventListener("pagehide", bye);
      bye();
      ch.close();
      channel.current = null;
    };
  }, [session]);

  useEffect(() => {
    channel.current?.postMessage({ kind: "slide", session, slide } satisfies AudienceMessage);
  }, [session, slide]);

  /**
   * Asks once for screen-placement permission (Chrome's "manage windows").
   * Call from a click, before the talk starts, so opening later needs no prompt.
   */
  const prepare = async () => {
    const w = window as WithScreens;
    try {
      await w.getScreenDetails?.();
    } catch {
      // Refused: the window still opens, just not placed on the projector.
    }
  };

  /** Opens the slide-only window, on the projector when the browser can tell where it is. */
  const open = async () => {
    const url = audienceUrl(projectId, session);
    const w = window as WithScreens;
    let features = "popup,width=1024,height=576";
    try {
      const details = await w.getScreenDetails?.();
      const target = details && pickAudienceScreen(details.screens, details.currentScreen);
      if (target) features = windowFeaturesFor(target);
    } catch {
      // No permission / not supported: open a normal window to drag over.
    }
    window.open(url, AUDIENCE_WINDOW_NAME, features)?.focus();
  };

  /** The talk is over: the audience window closes itself. */
  const close = () => {
    channel.current?.postMessage({ kind: "end", session } satisfies AudienceMessage);
    setConnected(false);
  };

  return { open, close, prepare, connected, secondScreen };
}
