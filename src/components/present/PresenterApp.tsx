"use client";

import Link from "next/link";
import { useEffect, useReducer, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db, newId, saveRun, type Project, type ScriptVersion } from "@/lib/db";
import { applyTiming, formatClock, formatDuration, initialTiming, readTiming } from "@/lib/timing";
import { usePdfDocument } from "@/hooks/usePdfDocument";
import { slideLabel, useSlideTitles } from "@/hooks/useSlideTitles";
import { SlideViewer } from "@/components/editor/SlideViewer";
import { Button } from "@/components/ui/Button";
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MicIcon,
  PauseIcon,
  PlayIcon,
  StopIcon,
} from "@/components/ui/Icons";
import styles from "./Presenter.module.css";

/** Loads the project, then hands off to the presenter (keyed so timing starts fresh). */
export function PresenterApp() {
  const params = useSearchParams();
  const projectId = params.get("project") ?? "";
  const project = useLiveQuery(() => (projectId ? db.projects.get(projectId) : undefined), [projectId], null);
  const version = useLiveQuery(
    () => (project ? db.scriptVersions.get(project.currentScriptVersionId) : undefined),
    [project?.currentScriptVersionId],
    null,
  );

  if (project === null || (project && version === null)) return <p className={styles.status}>불러오는 중…</p>;
  if (!project || !version) {
    return (
      <p className={styles.status}>
        발표를 찾을 수 없어요. <Link href="/app">내 발표로 돌아가기</Link>
      </p>
    );
  }
  return <Presenter key={project.id} project={project} version={version} />;
}

const TICK_MS = 250;

function Presenter({ project, version }: { project: Project; version: ScriptVersion }) {
  const router = useRouter();
  const { doc } = usePdfDocument(project.id);
  const titles = useSlideTitles(doc, project.slideTitles);
  const pageCount = project.pageCount;
  const [timing, dispatch] = useReducer(applyTiming, pageCount, initialTiming);
  const [now, setNow] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  // The script version is fixed when the run starts (PRD §4.1).
  const [runVersion, setRunVersion] = useState<ScriptVersion | null>(null);
  const retryRun = useRef<Parameters<typeof saveRun>[0] | null>(null);

  const running = timing.status === "running";
  const started = timing.status !== "idle";
  const { totalMs, slideMs } = readTiming(timing, now);
  const slide = timing.slide;
  const targetMs = project.targetSec ? project.targetSec * 1000 : null;

  // Live clock.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [running]);

  const start = () => {
    setRunVersion(version);
    const at = Date.now();
    setNow(at);
    dispatch({ type: "start", at, slide: 0 });
  };
  const togglePause = () => {
    const at = Date.now();
    setNow(at);
    dispatch({ type: running ? "pause" : "resume", at });
  };
  const goTo = (target: number) => {
    if (!started) return;
    const at = Date.now();
    setNow(at);
    dispatch({ type: "goto", at, slide: Math.max(0, Math.min(pageCount - 1, target)) });
  };

  const finish = async () => {
    const at = Date.now();
    const ended = applyTiming(timing, { type: "end", at });
    dispatch({ type: "end", at });
    if (ended.runMs <= 0) {
      router.replace(`/app?project=${project.id}`);
      return;
    }
    setSaving(true);
    setSaveError(false);
    const run = {
      id: newId(),
      projectId: project.id,
      mode: "rehearsal" as const,
      scriptVersionId: (runVersion ?? version).id,
      startedAt: at - ended.runMs,
      endedAt: at,
      totalMs: ended.runMs,
      slideMs: ended.slideMs,
      visits: ended.visits,
      targetSec: project.targetSec,
    };
    try {
      await saveRun(run);
      router.replace(`/app?project=${project.id}&run=${run.id}`);
    } catch {
      setSaving(false);
      setSaveError(true);
      retryRun.current = run;
    }
  };
  const retry = async () => {
    const run = retryRun.current;
    if (!run) return;
    setSaving(true);
    setSaveError(false);
    try {
      await saveRun(run);
      router.replace(`/app?project=${project.id}&run=${run.id}`);
    } catch {
      setSaving(false);
      setSaveError(true);
    }
  };

  // Keyboard / presentation clicker: arrows and PageUp/PageDown move, P pauses.
  const keys = useRef({ goTo, togglePause, start, slide, started, ended: timing.status === "ended" });
  useEffect(() => {
    keys.current = { goTo, togglePause, start, slide, started, ended: timing.status === "ended" };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current;
      const typing = e.target instanceof Element && e.target.closest("input, textarea");
      if (k.ended || typing) return;
      if (!k.started) {
        if (e.key === "Enter") {
          e.preventDefault();
          k.start();
        }
        return;
      }
      if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key)) {
        e.preventDefault();
        k.goTo(k.slide + 1);
      } else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) {
        e.preventDefault();
        k.goTo(k.slide - 1);
      } else if (e.key === "p" || e.key === "P") {
        k.togglePause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const script = (runVersion ?? version).slides[slide] ?? "";
  const overTarget = targetMs !== null && totalMs > targetMs;

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.topLeft}>
          {!started && (
            <Link href={`/app?project=${project.id}`} className={styles.iconBtn} aria-label="편집 화면으로 돌아가기">
              <ArrowLeftIcon />
            </Link>
          )}
          <span className={styles.modeBadge}>연습</span>
          <span className={styles.projectName}>{project.name}</span>
        </div>

        <div className={styles.clocks} aria-live="off">
          <div className={styles.clock}>
            <span className={styles.clockLabel}>전체</span>
            <span className={`${styles.clockValue} ${overTarget ? styles.over : ""}`}>{formatClock(totalMs)}</span>
            {targetMs !== null && <span className={styles.clockTarget}>/ {formatClock(targetMs)}</span>}
          </div>
          <div className={styles.clock}>
            <span className={styles.clockLabel}>이 장</span>
            <span className={styles.clockValueSmall}>{formatClock(slideMs)}</span>
          </div>
        </div>

        <div className={styles.topRight}>
          {timing.status === "paused" && <span className={styles.pausedBadge}>일시정지됨</span>}
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.slideCol} aria-label="슬라이드">
          <SlideViewer doc={doc} index={slide} pageCount={pageCount} onChange={goTo} keyboard={false} />
        </section>

        <aside className={styles.scriptCol} aria-label="대본">
          <p className={styles.scriptNo}>{String(slide + 1).padStart(2, "0")}</p>
          <h2 className={styles.scriptTitle}>{slideLabel(titles, slide)}</h2>
          {script.trim() ? (
            <p className={styles.scriptText}>{script}</p>
          ) : (
            <p className={styles.scriptEmpty}>연결된 대본 없음</p>
          )}
          {slide + 1 < pageCount && (
            <p className={styles.next}>
              <span>다음</span> {slideLabel(titles, slide + 1)}
            </p>
          )}
        </aside>
      </main>

      <footer className={styles.controls}>
        {!started ? (
          <div className={styles.ready}>
            <p className={styles.readyText}>
              준비되면 시작하세요. 슬라이드를 넘길 때마다 장별 시간이 기록돼요.
              {targetMs !== null && ` 목표 시간은 ${formatDuration(targetMs)}이에요.`}
            </p>
            <Button variant="primary" onClick={start} className={styles.startBtn}>
              <MicIcon width={18} height={18} />
              연습 시작
            </Button>
          </div>
        ) : (
          <>
            <div className={styles.controlGroup}>
              <button type="button" className={styles.ctrlBtn} onClick={() => goTo(slide - 1)} disabled={slide === 0} aria-label="이전 슬라이드">
                <ChevronLeftIcon />
              </button>
              <span className={styles.pageNo}>
                {slide + 1} / {pageCount}
              </span>
              <button
                type="button"
                className={styles.ctrlBtn}
                onClick={() => goTo(slide + 1)}
                disabled={slide >= pageCount - 1}
                aria-label="다음 슬라이드"
              >
                <ChevronRightIcon />
              </button>
            </div>
            <div className={styles.controlGroup}>
              {saveError ? (
                <>
                  <span className={styles.errorText}>기록을 저장하지 못했어요.</span>
                  <Button variant="primary" onClick={retry} disabled={saving}>
                    다시 저장
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="utility" onClick={togglePause} disabled={timing.status === "ended"}>
                    {timing.status === "paused" ? (
                      <>
                        <PlayIcon width={16} height={16} />
                        재개
                      </>
                    ) : (
                      <>
                        <PauseIcon width={16} height={16} />
                        일시정지
                      </>
                    )}
                  </Button>
                  <Button variant="primary" onClick={finish} disabled={saving || timing.status === "ended"}>
                    <StopIcon width={16} height={16} />
                    {saving ? "저장 중…" : "종료"}
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </footer>
    </div>
  );
}
