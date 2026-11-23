/**
 * On-device speech recognition (PRD §4.3): Web Speech API with
 * `processLocally = true` only. If on-device processing can't be confirmed,
 * we fall back to manual mode — never to a cloud recognizer.
 */

import type { Lang } from "./matching";

/* Minimal typings: the DOM lib doesn't ship SpeechRecognition yet. */
interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: { length: number; [i: number]: RecognitionResult };
}
interface RecognitionErrorEvent {
  error: string;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type Availability = "available" | "downloadable" | "downloading" | "unavailable";
interface RecognitionCtor {
  new (): Recognition;
  available?: (opts: { langs: string[]; processLocally: boolean }) => Promise<Availability>;
  install?: (opts: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
}

export const SPEECH_LANG: Record<Lang, string> = { ko: "ko-KR", en: "en-US" };

function getCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Can this browser recognize `lang` on the device?
 * - "available": ready to use
 * - "needs-install": the on-device language pack must be downloaded first
 * - "unsupported": no API, or on-device processing can't be confirmed
 */
export type OnDeviceSupport = "available" | "needs-install" | "unsupported";

export async function checkOnDevice(lang: Lang): Promise<OnDeviceSupport> {
  const Ctor = getCtor();
  if (!Ctor || typeof Ctor.available !== "function") return "unsupported";
  try {
    const result = await Ctor.available({ langs: [SPEECH_LANG[lang]], processLocally: true });
    if (result === "available") return "available";
    if (result === "downloadable" || result === "downloading") return "needs-install";
    return "unsupported";
  } catch {
    return "unsupported";
  }
}

/** Downloads the on-device language pack. Must be called from a user click. */
export async function installOnDevice(lang: Lang): Promise<boolean> {
  const Ctor = getCtor();
  if (!Ctor || typeof Ctor.install !== "function") return false;
  try {
    return await Ctor.install({ langs: [SPEECH_LANG[lang]], processLocally: true });
  } catch {
    return false;
  }
}

/** Why live tracking stopped and the session fell back to manual. */
export type StopReason = "denied" | "error";

export interface RecognitionHandle {
  stop(): void;
}

interface StartOptions {
  lang: Lang;
  /** `finals`: all confirmed text this session (only grows). `interim`: current guess. */
  onResult: (finals: string, interim: string) => void;
  /** Recognition can't continue (permission denied or a hard error). */
  onStop: (reason: StopReason) => void;
}

const MAX_RESTARTS_PER_MINUTE = 20;

/**
 * Starts continuous on-device recognition. The browser ends a session after
 * silence; we restart it until `stop()` is called.
 * Call only after `checkOnDevice` returned "available".
 */
export function startRecognition({ lang, onResult, onStop }: StartOptions): RecognitionHandle | null {
  const Ctor = getCtor();
  if (!Ctor) return null;

  let stopped = false;
  let earlierFinals = "";
  let sessionFinals = "";
  let rec: Recognition | null = null;
  const restarts: number[] = [];

  const fail = (reason: StopReason) => {
    if (stopped) return;
    stopped = true;
    try {
      rec?.abort();
    } catch {
      // already stopped
    }
    onStop(reason);
  };

  const begin = () => {
    rec = new Ctor();
    rec.lang = SPEECH_LANG[lang];
    rec.continuous = true;
    rec.interimResults = true;
    rec.processLocally = true;

    rec.onresult = (e) => {
      let finals = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finals += ` ${r[0].transcript}`;
        else interim += ` ${r[0].transcript}`;
      }
      sessionFinals = finals;
      onResult(`${earlierFinals}${sessionFinals}`, interim.trim());
    };

    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") fail("denied");
      else if (e.error !== "no-speech" && e.error !== "aborted") fail("error");
    };

    rec.onend = () => {
      if (stopped) return;
      earlierFinals += sessionFinals;
      sessionFinals = "";
      const now = Date.now();
      while (restarts.length && now - restarts[0] > 60_000) restarts.shift();
      if (restarts.length >= MAX_RESTARTS_PER_MINUTE) return fail("error");
      restarts.push(now);
      try {
        begin();
      } catch {
        fail("error");
      }
    };

    rec.start();
  };

  try {
    begin();
  } catch {
    return null;
  }

  return {
    stop() {
      stopped = true;
      try {
        rec?.stop();
      } catch {
        // already stopped
      }
    },
  };
}
