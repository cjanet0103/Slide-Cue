"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { usePdfDocument } from "@/hooks/usePdfDocument";
import { renderPage } from "@/lib/pdf";
import { AUDIENCE_CHANNEL, readMessage, type AudienceMessage } from "@/lib/audience";
import styles from "./AudienceScreen.module.css";

/**
 * 청중 화면 (PRD screen 3, T7): the presenter's current slide, full window, on black.
 * It learns only the slide number from the presenter window and reads the PDF
 * from this browser's own storage. Script, transcript, notes and recording
 * state never reach this window.
 */
export function AudienceScreen() {
  const params = useSearchParams();
  const projectId = params.get("project");
  const session = params.get("session");
  if (!projectId || !session) {
    return (
      <main className={styles.screen}>
        <p className={styles.note}>
          발표자 화면에서 <strong>청중 화면 열기</strong>를 눌러 열어 주세요.
        </p>
      </main>
    );
  }
  return <Audience projectId={projectId} session={session} />;
}

function Audience({ projectId, session }: { projectId: string; session: string }) {
  const { doc, error } = usePdfDocument(projectId);
  const [slide, setSlide] = useState<number | null>(null);
  const [presenterGone, setPresenterGone] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [pointerActive, setPointerActive] = useState(true);
  const [rendered, setRendered] = useState(false);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const channel = useRef<BroadcastChannel | null>(null);

  // Link to the presenter window: say hello, then follow its slide number.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(AUDIENCE_CHANNEL);
    channel.current = ch;
    let gone = false;
    ch.onmessage = (e) => {
      const m = readMessage(e.data);
      if (!m || m.session !== session) return;
      if (m.kind === "slide") {
        setSlide(m.slide);
        setPresenterGone(false);
        // The presenter window came back (reload / reopened): tell it this window is here.
        if (gone) ch.postMessage({ kind: "hello", session } satisfies AudienceMessage);
        gone = false;
      } else if (m.kind === "bye") {
        gone = true;
        setPresenterGone(true);
      } else if (m.kind === "end") {
        window.close(); // the talk is over (works for the window the presenter opened)
      }
    };
    ch.postMessage({ kind: "hello", session } satisfies AudienceMessage);
    const bye = () => ch.postMessage({ kind: "bye", session } satisfies AudienceMessage);
    window.addEventListener("pagehide", bye);
    return () => {
      window.removeEventListener("pagehide", bye);
      bye();
      ch.close();
      channel.current = null;
    };
  }, [session]);

  // A clicker or arrow key pressed while this window has focus moves the presenter's slide.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const step = (delta: 1 | -1) => {
        e.preventDefault();
        channel.current?.postMessage({ kind: "step", session, delta } satisfies AudienceMessage);
      };
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) step(1);
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) step(-1);
      else if (e.key === "f" || e.key === "F") toggleFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session]);

  // Fill the window; re-measure on resize (e.g. after moving it to the projector).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setBox({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!doc || !canvas || slide === null || box.width <= 0 || box.height <= 0) return;
    const page = Math.min(slide, doc.numPages - 1);
    const ctrl = new AbortController();
    renderPage(doc, page + 1, canvas, box, ctrl.signal)
      .then((ok) => ok && setRendered(true))
      .catch(() => {});
    return () => ctrl.abort();
  }, [doc, slide, box]);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // The 전체 화면 button shows while the mouse moves, then gets out of the way.
  useEffect(() => {
    let timer = window.setTimeout(() => setPointerActive(false), 2500);
    const onMove = () => {
      setPointerActive(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setPointerActive(false), 2500);
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.clearTimeout(timer);
    };
  }, []);

  const note = error
    ? "이 브라우저에서 발표 파일을 찾지 못했어요. 발표자 화면과 같은 브라우저에서 열어 주세요."
    : presenterGone
      ? "발표자 화면이 닫혔어요. 발표자 화면을 다시 열면 이어서 보여요."
      : slide === null
        ? "발표자 화면과 연결하는 중…"
        : null;

  return (
    // Browsers allow full screen only after a click in this window: one click anywhere does it.
    <main
      className={`${styles.screen} ${pointerActive ? "" : styles.hideCursor}`}
      onClick={() => !document.fullscreenElement && toggleFullscreen()}
    >
      <div ref={stageRef} className={styles.stage}>
        <canvas
          ref={canvasRef}
          className={`${styles.canvas} ${rendered && !error ? "" : styles.canvasHidden}`}
          aria-label={slide === null ? "슬라이드" : `${slide + 1}번 슬라이드`}
        />
      </div>
      {/* Over a slide already shown, the note sits at the bottom instead of the middle */}
      {note && <p className={`${styles.note} ${rendered && slide !== null ? styles.noteBottom : ""}`}>{note}</p>}
      {!fullscreen && (
        <p className={`${styles.fullBtn} ${pointerActive ? "" : styles.fullBtnHidden}`}>
          화면을 클릭하면 전체 화면 <span className={styles.key}>F</span>
        </p>
      )}
    </main>
  );
}

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else void document.documentElement.requestFullscreen?.().catch(() => {});
}
