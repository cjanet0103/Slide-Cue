"use client";

import { useRef } from "react";
import styles from "./Workspace.module.css";

interface Props {
  /** Share of the container given to the left pane (0–1). */
  ratio: number;
  min: number;
  max: number;
  onChange: (ratio: number) => void;
  onReset: () => void;
  /** The element whose width the ratio refers to. */
  containerRef: React.RefObject<HTMLElement | null>;
}

/** Vertical bar between two panes; drag (or arrow keys) to resize, double-click to reset. */
export function PaneDivider({ ratio, min, max, onChange, onReset, containerRef }: Props) {
  const dragging = useRef(false);
  const clamp = (r: number) => Math.min(max, Math.max(min, r));

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.userSelect = "none";
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = containerRef.current?.getBoundingClientRect();
    if (!dragging.current || !box || box.width === 0) return;
    onChange(clamp((e.clientX - box.left) / box.width));
  };

  const stop = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.style.userSelect = "";
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") onChange(clamp(ratio - 0.02));
    else if (e.key === "ArrowRight") onChange(clamp(ratio + 0.02));
    else return;
    e.preventDefault();
  };

  return (
    <div
      className={styles.divider}
      role="separator"
      aria-orientation="vertical"
      aria-label="슬라이드와 대본 사이 너비 조절"
      aria-valuemin={Math.round(min * 100)}
      aria-valuemax={Math.round(max * 100)}
      aria-valuenow={Math.round(ratio * 100)}
      tabIndex={0}
      title="끌어서 너비 조절 · 두 번 클릭하면 원래대로"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  );
}
