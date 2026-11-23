"use client";

import { useEffect, useRef, useState } from "react";
import type { Lang } from "@/lib/matching";
import { checkOnDevice, installOnDevice, type OnDeviceSupport } from "@/lib/speech";
import { prepareSemantic } from "@/lib/semantic";
import { Button } from "@/components/ui/Button";
import { MicIcon } from "@/components/ui/Icons";
import styles from "./StartRehearsalButton.module.css";

export interface StartOptions {
  /** Live script tracking on, and confirmed to run on this device. */
  tracking: boolean;
  lang: Lang;
  /** Move to the next slide when its opening is said (only with tracking). */
  autoAdvance: boolean;
}

interface Props {
  /** Slide the presenter is looking at (0-based). */
  current: number;
  /** Language guessed from the script. */
  defaultLang: Lang;
  onStart: (fromSlide: number, options: StartOptions) => void;
  /** "fab": the round mic button in the bottom-right corner; its menu opens upward. */
  variant?: "pill" | "fab";
}

const TRACKING_KEY = "slidecue.tracking";
const AUTO_ADVANCE_KEY = "slidecue.autoAdvance";
// PRD: auto-advance defaults to off (manual) until the presenter turns it on.
function readAutoAdvancePref(): boolean {
  try {
    return localStorage.getItem(AUTO_ADVANCE_KEY) === "1";
  } catch {
    return false;
  }
}
function readTrackingPref(): boolean {
  try {
    return localStorage.getItem(TRACKING_KEY) !== "0";
  } catch {
    return true;
  }
}

type Support = OnDeviceSupport | "checking" | "installing";

const SUPPORT_TEXT: Record<Support, string> = {
  checking: "이 기기에서 쓸 수 있는지 확인하는 중…",
  available: "말하는 구절을 대본에서 강조해요",
  "needs-install": "처음 한 번 음성 인식 언어팩 설치가 필요해요",
  installing: "언어팩을 설치하는 중…",
  unsupported: "이 브라우저에서는 쓸 수 없어요. 직접 넘기며 연습해요",
};

/**
 * 연습 시작: choose where to start, and whether to follow the script by voice.
 * Speech is recognized on this device only (PRD §4.3); otherwise rehearsal runs manually.
 */
export function StartRehearsalButton({ current, defaultLang, onStart, variant = "pill" }: Props) {
  const [open, setOpen] = useState(false);
  const [trackingPref, setTrackingPref] = useState(readTrackingPref);
  const [autoAdvancePref, setAutoAdvancePref] = useState(readAutoAdvancePref);
  const [lang, setLang] = useState<Lang>(defaultLang);
  const [support, setSupport] = useState<Support>("checking");
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

  const check = (l: Lang) => {
    setSupport("checking");
    checkOnDevice(l).then((result) => {
      setSupport(result);
      // Fetch the meaning model ahead of time so it's ready when speaking starts.
      if (result === "available" && readTrackingPref()) prepareSemantic();
    });
  };

  const toggleMenu = () => {
    if (!open) check(lang);
    setOpen(!open);
  };

  const chooseLang = (l: Lang) => {
    setLang(l);
    check(l);
  };

  const toggleTracking = () => {
    const next = !trackingPref;
    setTrackingPref(next);
    if (next && support === "available") prepareSemantic();
    try {
      localStorage.setItem(TRACKING_KEY, next ? "1" : "0");
    } catch {
      // Storage blocked: the choice lasts until reload.
    }
  };

  const toggleAutoAdvance = () => {
    const next = !autoAdvancePref;
    setAutoAdvancePref(next);
    try {
      localStorage.setItem(AUTO_ADVANCE_KEY, next ? "1" : "0");
    } catch {
      // Storage blocked: the choice lasts until reload.
    }
  };

  const install = async () => {
    setSupport("installing");
    const ok = await installOnDevice(lang);
    if (ok) check(lang);
    else setSupport("needs-install");
  };

  const trackingUsable = support === "available";
  const trackingOn = trackingPref && trackingUsable;

  const start = (from: number) => {
    setOpen(false);
    onStart(from, { tracking: trackingOn, lang, autoAdvance: trackingOn && autoAdvancePref });
  };

  return (
    <div ref={wrapRef} className={styles.wrap}>
      {variant === "fab" ? (
        <button
          type="button"
          className={styles.fab}
          onClick={toggleMenu}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="연습 시작"
          title="연습 시작"
        >
          <MicIcon width={22} height={22} />
        </button>
      ) : (
        <Button variant="primary" onClick={toggleMenu} aria-haspopup="menu" aria-expanded={open}>
          <MicIcon width={18} height={18} />
          연습 시작
        </Button>
      )}

      {open && (
        <div className={`${styles.menu} ${variant === "fab" ? styles.menuUp : ""}`} role="menu" aria-label="연습 시작 설정">
          <div className={styles.trackRow}>
            <div className={styles.trackText}>
              <span className={styles.itemTitle}>대본 따라가기</span>
              <span className={styles.itemSub}>{SUPPORT_TEXT[support]}</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={trackingOn}
              aria-label="대본 따라가기"
              className={`${styles.switch} ${trackingOn ? styles.switchOn : ""}`}
              onClick={toggleTracking}
              disabled={!trackingUsable}
            >
              <span className={styles.knob} />
            </button>
          </div>

          <div className={styles.trackOptions}>
            <div className={styles.langs} role="radiogroup" aria-label="발표 언어">
              {(
                [
                  ["ko", "한국어"],
                  ["en", "English"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={lang === value}
                  className={`${styles.lang} ${lang === value ? styles.langActive : ""}`}
                  onClick={() => chooseLang(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {support === "needs-install" && (
              <button type="button" className={styles.install} onClick={install}>
                언어팩 설치
              </button>
            )}
          </div>

          <div className={`${styles.trackRow} ${trackingOn ? "" : styles.rowDisabled}`}>
            <div className={styles.trackText}>
              <span className={styles.itemTitle}>슬라이드 자동 넘김</span>
              <span className={styles.itemSub}>
                {trackingOn ? "다음 장 설명을 시작하면 슬라이드를 넘겨요" : "대본 따라가기를 켜면 쓸 수 있어요"}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={trackingOn && autoAdvancePref}
              aria-label="슬라이드 자동 넘김"
              className={`${styles.switch} ${trackingOn && autoAdvancePref ? styles.switchOn : ""}`}
              onClick={toggleAutoAdvance}
              disabled={!trackingOn}
            >
              <span className={styles.knob} />
            </button>
          </div>

          <div className={styles.divider} />

          <button type="button" role="menuitem" className={styles.item} onClick={() => start(0)}>
            <span className={styles.itemTitle}>처음부터</span>
          </button>
          {current > 0 && (
            <button type="button" role="menuitem" className={styles.item} onClick={() => start(current)}>
              <span className={styles.itemTitle}>현재 슬라이드부터</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
