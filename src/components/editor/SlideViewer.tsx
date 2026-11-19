"use client";

import { useEffect, useRef, useState } from "react";
import { renderPage, type PDFDocumentProxy } from "@/lib/pdf";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/Icons";
import styles from "./Workspace.module.css";

interface Props {
  doc: PDFDocumentProxy | null;
  index: number;
  pageCount: number;
  onChange: (index: number) => void;
  /** Off when the page handles arrow keys globally (presenter screen). */
  keyboard?: boolean;
}

// One wheel "gesture" moves one slide; trackpads fire many small events.
const WHEEL_THRESHOLD = 40;
const WHEEL_COOLDOWN_MS = 450;

/** Shows one slide at a time with side arrows; wheel and arrow keys move by one. */
export function SlideViewer({ doc, index, pageCount, onChange, keyboard = true }: Props) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [rendered, setRendered] = useState(false);
  const wheel = useRef({ acc: 0, last: 0 });

  const go = (delta: number) => {
    const next = Math.max(0, Math.min(pageCount - 1, index + delta));
    if (next !== index) onChange(next);
  };

  // Measure the area the slide can occupy.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = (w: number, h: number) =>
      setBox({ width: Math.floor(w / 10) * 10, height: Math.floor(h / 10) * 10 });
    const ro = new ResizeObserver(([entry]) => measure(entry.contentRect.width, entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    const canvas = canvasRef.current;
    if (!doc || !el || !canvas) return;
    const width = box.width || el.clientWidth;
    const height = box.height || el.clientHeight;
    if (width <= 0 || height <= 0) return;
    const ctrl = new AbortController();
    renderPage(doc, index + 1, canvas, { width, height }, ctrl.signal)
      .then((ok) => {
        if (ok) setRendered(true);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [doc, index, box]);

  // The wheel flips slides only; preventDefault keeps it from scrolling anything else.
  // React's onWheel is passive and can't prevent default, so attach natively.
  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  });
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      const w = wheel.current;
      const now = performance.now();
      if (now - w.last < WHEEL_COOLDOWN_MS) return;
      w.acc += delta;
      if (Math.abs(w.acc) >= WHEEL_THRESHOLD) {
        goRef.current(w.acc > 0 ? 1 : -1);
        w.acc = 0;
        w.last = now;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!keyboard) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "PageDown") {
      e.preventDefault();
      go(1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") {
      e.preventDefault();
      go(-1);
    }
  };

  return (
    <div
      ref={viewerRef}
      className={styles.viewer}
      onKeyDown={onKeyDown}
      tabIndex={0}
      aria-roledescription="슬라이드 넘기기"
      aria-label={`${index + 1}번 슬라이드, 전체 ${pageCount}장. 방향키나 마우스 휠로 넘길 수 있어요.`}
    >
      <button
        type="button"
        className={`${styles.navArrow} ${styles.navPrev}`}
        onClick={() => go(-1)}
        disabled={index === 0}
        aria-label="이전 슬라이드"
      >
        <ChevronLeftIcon width={24} height={24} />
      </button>

      <div ref={stageRef} className={styles.stage}>
        <canvas
          ref={canvasRef}
          className={`${styles.slideCanvas} ${rendered ? "" : styles.slideCanvasEmpty}`}
          aria-label={`${index + 1}번 슬라이드`}
        />
      </div>

      <button
        type="button"
        className={`${styles.navArrow} ${styles.navNext}`}
        onClick={() => go(1)}
        disabled={index >= pageCount - 1}
        aria-label="다음 슬라이드"
      >
        <ChevronRightIcon width={24} height={24} />
      </button>

      <div className={styles.pageNo} aria-live="polite">
        <strong>{index + 1}</strong> / {pageCount}
      </div>
    </div>
  );
}
