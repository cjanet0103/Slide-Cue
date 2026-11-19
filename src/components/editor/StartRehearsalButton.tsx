"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { MicIcon } from "@/components/ui/Icons";
import styles from "./StartRehearsalButton.module.css";

interface Props {
  /** Slide the presenter is looking at (0-based). */
  current: number;
  currentLabel: string;
  onStart: (fromSlide: number) => void;
}

/**
 * 연습 시작: asks whether to start from the beginning or from the current slide.
 * On slide 1 both are the same, so it starts right away.
 */
export function StartRehearsalButton({ current, currentLabel, onStart }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const start = (from: number) => {
    setOpen(false);
    onStart(from);
  };

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <Button
        variant="primary"
        onClick={() => (current === 0 ? start(0) : setOpen((o) => !o))}
        aria-haspopup={current === 0 ? undefined : "menu"}
        aria-expanded={current === 0 ? undefined : open}
      >
        <MicIcon width={18} height={18} />
        연습 시작
      </Button>

      {open && (
        <div className={styles.menu} role="menu" aria-label="어디서부터 연습할까요?">
          <button type="button" role="menuitem" className={styles.item} onClick={() => start(0)} autoFocus>
            <span className={styles.itemTitle}>처음부터</span>
            <span className={styles.itemSub}>1번 슬라이드부터</span>
          </button>
          <button type="button" role="menuitem" className={styles.item} onClick={() => start(current)}>
            <span className={styles.itemTitle}>현재 슬라이드부터</span>
            <span className={styles.itemSub}>
              {current + 1}번 · {currentLabel}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
