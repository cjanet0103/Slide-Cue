"use client";

import { useEffect, useRef, useState } from "react";
import { splitScript } from "@/lib/scriptSegments";
import styles from "./TrackedScript.module.css";

interface Props {
  text: string;
  /** Phrase being spoken. */
  current: number;
  /** Last spoken character in that phrase (string index; -1 = not started). */
  charIndex: number;
  /** Click a phrase to correct the position. */
  onSelect?: (index: number) => void;
}

/**
 * The script while tracking. Exactly one phrase is emphasized (soft mint);
 * inside it a mint line runs from the first character to the one being
 * spoken, with the star marker under that character. Everything else is plain.
 */
export function TrackedScript({ text, current, charIndex, onSelect }: Props) {
  const segments = splitScript(text);
  const currentRef = useRef<HTMLButtonElement>(null);

  // When speech moves on to the next phrase, the star first runs (fast) to the
  // end of the phrase it was on, then the emphasis moves. Clicks and other
  // jumps switch at once.
  const [shownIndex, setShownIndex] = useState(current);
  const [prevCurrent, setPrevCurrent] = useState(current);
  if (current !== prevCurrent) {
    setPrevCurrent(current);
    if (current !== shownIndex + 1) setShownIndex(current);
  }
  const finishing = shownIndex !== current;
  const shown = shownIndex;

  // Keep the spoken phrase near the top of the script list (scrolls only that list).
  useEffect(() => {
    const el = currentRef.current;
    const box = el?.closest("[data-script-scroll]") as HTMLElement | null;
    if (!el || !box) return;
    const boxRect = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.top < boxRect.top + 40 || r.bottom > boxRect.top + boxRect.height * 0.6) {
      box.scrollTo({ top: box.scrollTop + (r.top - boxRect.top) - boxRect.height / 4, behavior: "smooth" });
    }
  }, [shown]);

  if (segments.length === 0) return <p className={styles.empty}>연결된 대본 없음</p>;

  return (
    <ol className={styles.list} aria-label="대본 구절">
      {segments.map((seg, i) => (
        <li key={i}>
          <button
            ref={i === shown ? currentRef : undefined}
            type="button"
            className={`${styles.phrase} ${i === shown ? styles.now : ""}`}
            aria-current={i === shown ? "true" : undefined}
            onClick={() => onSelect?.(i)}
            title="이 구절부터 따라가기"
          >
            {i === shown ? (
              <SpokenPhrase
                key={`${i}:${seg}`}
                text={seg}
                target={finishing ? seg.length - 1 : charIndex}
                onFinished={finishing ? () => setShownIndex(current) : undefined}
              />
            ) : (
              seg
            )}
          </button>
        </li>
      ))}
    </ol>
  );
}

/**
 * Motion, drawn every animation frame (no stepping), so the line grows and the
 * star glides continuously.
 * Speed: the star closes the gap to the recognized position in about CATCH_UP_S,
 * so fast speech moves it fast, but never slower than MIN_SPEED (calm pace).
 */
const CATCH_UP_S = 0.18;
const MIN_SPEED = 14; // characters per second
/** Spin: one turn per 2.4 s while moving, easing in and out of motion. */
const SPIN_DEG_PER_S = 150;
const SPIN_EASE = 6; // per second; higher = quicker start/stop
/** Star size. */
const STAR = 15;
/** Progress line thickness and its gap below the text. */
const LINE = 2;
const LINE_GAP = 7;
/** Gap between the end of the line and the star ahead of it. */
const STAR_GAP = 3;
/** Gap between the emphasized box and the star waiting on its left. */
const WAIT_GAP = 6;

type Box = { left: number; right: number; top: number; bottom: number };

/**
 * The phrase being spoken, with the progress line and the star.
 * The star moves smoothly up to the last recognized word — never beyond it —
 * spinning slowly in one direction while it moves, and both stop when speech
 * stops. The line is the trail it leaves. Drawn as an overlay, so the text and
 * line spacing never move.
 */
function SpokenPhrase({
  text,
  target,
  onFinished,
}: {
  text: string;
  target: number;
  /** Set while finishing the phrase: called once the star reaches the end. */
  onFinished?: () => void;
}) {
  // Characters with their string index (target is a string index).
  const chars = Array.from(text).reduce<{ ch: string; at: number }[]>((acc, ch) => {
    const prev = acc[acc.length - 1];
    acc.push({ ch, at: prev ? prev.at + prev.ch.length : 0 });
    return acc;
  }, []);
  // Goal in characters completed (0 = not started, chars.length = whole phrase).
  const targetPos = target < 0 ? -1 : chars.findIndex((c) => c.at >= target);
  const goal = targetPos < 0 ? 0 : targetPos + 1;

  const rootRef = useRef<HTMLSpanElement>(null);
  const linesRef = useRef<HTMLSpanElement>(null);
  const starRef = useRef<HTMLSpanElement>(null);
  const spinRef = useRef<HTMLSpanElement>(null);
  const charRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const goalRef = useRef(goal);
  const finishRef = useRef(onFinished);
  useEffect(() => {
    finishRef.current = onFinished;
  });

  // Animation state, kept outside React so each frame only touches styles.
  const anim = useRef({
    pos: 0,
    angle: 0,
    spin: 0,
    last: 0,
    frame: 0,
    boxes: [] as Box[],
    waitAt: { x: 0, y: 0 },
    done: false,
  });
  const kickRef = useRef<() => void>(() => {});

  useEffect(() => {
    const root = rootRef.current;
    const lines = linesRef.current;
    const star = starRef.current;
    const spin = spinRef.current;
    if (!root || !lines || !star || !spin) return;
    const a = anim.current;

    const measure = () => {
      const base = root.getBoundingClientRect();
      a.boxes = charRefs.current.map((el) => {
        const r = el?.getBoundingClientRect();
        return r
          ? { left: r.left - base.left, right: r.right - base.left, top: r.top - base.top, bottom: r.bottom - base.top }
          : { left: 0, right: 0, top: 0, bottom: 0 };
      });
      // Waiting spot: left of the emphasized box, vertically centred on it.
      const box = (root.closest("button") ?? root).getBoundingClientRect();
      a.waitAt = {
        x: box.left - base.left - WAIT_GAP - STAR,
        y: box.top - base.top + box.height / 2 - STAR / 2,
      };
    };

    const draw = () => {
      const boxes = a.boxes;
      if (boxes.length === 0) return;
      // The character being drawn and how far into it the line has reached.
      const i = a.pos <= 0 ? 0 : Math.min(boxes.length - 1, Math.ceil(a.pos) - 1);
      const f = a.pos <= 0 ? 0 : Math.min(1, a.pos - i);
      const at = boxes[i];
      const endX = at.left + f * (at.right - at.left);

      // One bar per screen line, from the first character to the line's end.
      const rows: Box[] = [];
      if (a.pos > 0) {
        for (let k = 0; k <= i; k++) {
          const b = boxes[k];
          const right = k === i ? endX : b.right;
          const row = rows[rows.length - 1];
          if (row && Math.abs(b.top - row.top) < 4) {
            row.right = Math.max(row.right, right);
            row.bottom = Math.max(row.bottom, b.bottom);
          } else {
            rows.push({ ...b, right });
          }
        }
      }
      const bars = Array.from(lines.children) as HTMLSpanElement[];
      rows.forEach((row, k) => {
        let el = bars[k];
        if (!el) {
          el = document.createElement("span");
          el.className = styles.line;
          lines.appendChild(el);
        }
        el.style.left = `${row.left}px`;
        el.style.top = `${row.bottom + LINE_GAP}px`;
        el.style.width = `${Math.max(0, row.right - row.left)}px`;
      });
      bars.slice(rows.length).forEach((el) => el.remove());

      // Star ahead of the line, like a full stop after the spoken character:
      // on the line's height, a small gap after the line's end (on a new screen
      // line it simply appears there).
      let x = endX + STAR_GAP;
      let y = at.bottom + LINE_GAP + LINE / 2 - STAR / 2;
      // Not started yet: the star waits outside the box, on its left at mid
      // height ("this phrase starts here"), and slides in over the first character.
      const t = Math.min(1, Math.max(0, a.pos));
      if (t < 1) {
        x = a.waitAt.x + (x - a.waitAt.x) * t;
        y = a.waitAt.y + (y - a.waitAt.y) * t;
      }
      star.style.transform = `translate(${x}px, ${y}px)`;
      spin.style.transform = `rotate(${a.angle}deg)`;
    };

    const tick = (now: number) => {
      const dt = a.last ? Math.min(0.05, (now - a.last) / 1000) : 0;
      a.last = now;
      const gap = goalRef.current - a.pos;
      const moving = gap > 0;
      if (moving) {
        const speed = Math.max(MIN_SPEED, gap / CATCH_UP_S);
        a.pos = Math.min(goalRef.current, a.pos + speed * dt);
        // Land exactly on the goal instead of creeping toward it.
        if (goalRef.current - a.pos < 0.01) a.pos = goalRef.current;
      }
      // Spin speed eases toward its target, so starting and stopping are soft.
      a.spin += ((moving ? SPIN_DEG_PER_S : 0) - a.spin) * Math.min(1, SPIN_EASE * dt);
      a.angle = (a.angle + a.spin * dt) % 360;
      draw();

      // Finishing a phrase: move the emphasis on as soon as the star arrives.
      if (!a.done && finishRef.current && a.pos >= a.boxes.length) {
        a.done = true;
        finishRef.current();
      }

      if (moving || a.spin > 1) {
        a.frame = requestAnimationFrame(tick);
      } else {
        a.frame = 0;
        a.last = 0;
        a.spin = 0;
      }
    };

    kickRef.current = () => {
      if (!a.frame) a.frame = requestAnimationFrame(tick);
    };

    measure();
    draw();
    kickRef.current();
    const ro = new ResizeObserver(() => {
      measure();
      draw();
    });
    ro.observe(root);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(a.frame);
      a.frame = 0;
      a.last = 0;
    };
  }, []);

  // New recognized position (or finishing): move toward it.
  const finishing = !!onFinished;
  useEffect(() => {
    goalRef.current = goal;
    if (finishing) anim.current.done = false;
    kickRef.current();
  }, [goal, finishing]);

  return (
    <span ref={rootRef} className={styles.spoken}>
      {chars.map((c, i) => (
        <span
          key={i}
          ref={(el) => {
            charRefs.current[i] = el;
          }}
        >
          {c.ch}
        </span>
      ))}
      <span ref={linesRef} className={styles.overlay} aria-hidden="true" />
      <span ref={starRef} className={styles.star} aria-hidden="true">
        <span ref={spinRef} className={styles.spin}>
          <StarIcon />
        </span>
      </span>
    </span>
  );
}

/** The SlideCue mint asterisk (eight arms, square ends). */
function StarIcon() {
  return (
    <svg width={STAR} height={STAR} viewBox="0 0 24 24" aria-hidden="true">
      <g stroke="#00FCB4" strokeWidth="3.4" strokeLinecap="butt">
        <path d="M12 1.5v21M1.5 12h21M4.6 4.6l14.8 14.8M19.4 4.6L4.6 19.4" />
      </g>
    </svg>
  );
}
