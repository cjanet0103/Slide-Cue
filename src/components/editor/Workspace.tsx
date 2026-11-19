"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { contextLabel, db, saveSlideTitle, updateProjectInfo } from "@/lib/db";
import { formatClock, formatDuration } from "@/lib/timing";
import { useRehearsal } from "@/hooks/useRehearsal";
import { usePdfDocument } from "@/hooks/usePdfDocument";
import { useSlideTitles } from "@/hooks/useSlideTitles";
import { Button } from "@/components/ui/Button";
import { ArrowLeftIcon, ClockIcon, FileIcon, MicIcon, PauseIcon, PlayIcon, StopIcon } from "@/components/ui/Icons";
import { SlideViewer } from "./SlideViewer";
import { ScriptCard } from "./ScriptCard";
import { WholeScriptPanel } from "./WholeScriptPanel";
import { PaneDivider } from "./PaneDivider";
import { RunsPanel } from "./RunsPanel";
import { ProjectInfoDialog } from "./ProjectInfoDialog";
import styles from "./Workspace.module.css";

type ScriptMode = "slides" | "whole" | "runs";

// Slides/script split, remembered per browser as a convenience.
const SPLIT_KEY = "slidecue.splitRatio";
const DEFAULT_SPLIT = 0.55;
function readSplit(): number {
  try {
    const v = Number(localStorage.getItem(SPLIT_KEY));
    return v >= 0.3 && v <= 0.75 ? v : DEFAULT_SPLIT;
  } catch {
    return DEFAULT_SPLIT;
  }
}

interface Props {
  projectId: string;
  /** Opens the run history with this run selected (e.g. right after a rehearsal). */
  initialRunId: string | null;
  onBack: () => void;
}

export function Workspace({ projectId, initialRunId, onBack }: Props) {
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const versionId = project?.currentScriptVersionId;
  const version = useLiveQuery(
    () => (versionId ? db.scriptVersions.get(versionId) : undefined),
    [versionId],
  );
  const { doc, error } = usePdfDocument(projectId);

  const [current, setCurrent] = useState(0);
  const [mode, setMode] = useState<ScriptMode>(initialRunId ? "runs" : "slides");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initialRunId);
  const [editingInfo, setEditingInfo] = useState(false);
  const [wholeDraft, setWholeDraft] = useState<string | null>(null);
  // Bumped after applying the whole script so script cards reload their text.
  const [cardsKey, setCardsKey] = useState(0);
  // Applied text, shown immediately while storage catches up.
  const [appliedSlides, setAppliedSlides] = useState<string[] | null>(null);
  const scriptScroll = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLLIElement | null)[]>([]);
  const pageCount = project?.pageCount ?? 0;
  const splitRef = useRef<HTMLDivElement>(null);
  const [splitRatio, setSplitRatioState] = useState(readSplit);
  const setSplitRatio = (r: number) => {
    setSplitRatioState(r);
    try {
      localStorage.setItem(SPLIT_KEY, String(r));
    } catch {
      // Storage blocked: the width just isn't remembered.
    }
  };

  // Section headings: the presenter's own, else each slide's first line of text.
  const titles = useSlideTitles(doc, project?.slideTitles);

  // Rehearsal runs right here in the editor: same slide view, timers in the top bar.
  const rehearsal = useRehearsal({
    projectId,
    pageCount,
    scriptVersionId: versionId ?? "",
    targetSec: project?.targetSec,
    onSaved: (run) => {
      setSelectedRunId(run.id);
      setMode("runs");
    },
  });
  const rehearsing = rehearsal.inProgress;

  const changeSlide = (index: number) => {
    setCurrent(index);
    rehearsal.goTo(index);
  };

  const startRehearsal = () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    setCurrent(0);
    setMode("slides");
    rehearsal.start(0);
  };

  // While rehearsing, arrow keys / presentation clicker move slides and P pauses.
  const keys = useRef({ changeSlide, current, pageCount, rehearsal });
  useEffect(() => {
    keys.current = { changeSlide, current, pageCount, rehearsal };
  });
  useEffect(() => {
    if (!rehearsing) return;
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current;
      if (e.target instanceof Element && e.target.closest("input, textarea")) return;
      if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key)) {
        e.preventDefault();
        if (k.current < k.pageCount - 1) k.changeSlide(k.current + 1);
      } else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) {
        e.preventDefault();
        if (k.current > 0) k.changeSlide(k.current - 1);
      } else if (e.key === "p" || e.key === "P") {
        k.rehearsal.togglePause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rehearsing]);

  // Keep the matching script card in view by scrolling only the script list
  // (scrollIntoView would also drag the whole window). Skipped while typing there.
  useEffect(() => {
    const box = scriptScroll.current;
    const card = cardRefs.current[current];
    if (!box || !card || box.contains(document.activeElement)) return;
    const boxTop = box.getBoundingClientRect().top;
    const r = card.getBoundingClientRect();
    if (r.top < boxTop || r.bottom > boxTop + box.clientHeight) {
      box.scrollTo({ top: box.scrollTop + (r.top - boxTop) - 16, behavior: "smooth" });
    }
  }, [current, mode]);

  if (project === undefined || (versionId && version === undefined)) {
    return <p className={styles.status}>불러오는 중…</p>;
  }
  if (project === null || !version) {
    return <p className={styles.status}>발표를 찾을 수 없어요. 내 발표 목록에서 다시 선택해 주세요.</p>;
  }

  return (
    <div className={styles.workspace}>
      <header className={styles.topbar}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={onBack}
          disabled={rehearsing}
          aria-label="내 발표로 돌아가기"
          title={rehearsing ? "연습을 끝낸 뒤 나갈 수 있어요" : "내 발표"}
        >
          <ArrowLeftIcon />
        </button>
        <div className={styles.docTab}>
          <FileIcon width={16} height={16} />
          <span>{project.name}</span>
        </div>
        {rehearsing ? (
          <div className={styles.clocks} aria-label="연습 시간">
            <span className={`${styles.recDot} ${rehearsal.paused ? styles.recDotPaused : ""}`} aria-hidden="true" />
            <span className={styles.clockLabel}>{rehearsal.paused ? "일시정지" : "연습 중"}</span>
            <span
              className={`${styles.clockMain} ${project.targetSec && rehearsal.totalMs > project.targetSec * 1000 ? styles.clockOver : ""}`}
            >
              {formatClock(rehearsal.totalMs)}
            </span>
            {project.targetSec ? <span className={styles.clockTarget}>/ {formatClock(project.targetSec * 1000)}</span> : null}
            <span className={styles.clockDivider} aria-hidden="true" />
            <span className={styles.clockLabel}>슬라이드</span>
            <span className={styles.clockSlide}>{formatClock(rehearsal.slideMs)}</span>
          </div>
        ) : (
        <button type="button" className={styles.infoBtn} onClick={() => setEditingInfo(true)} title="발표 정보 고치기">
          {project.context && (
            <span className={styles.infoItem}>
              {contextLabel(project.context.kind)}
              {project.context.name && <span className={styles.infoName}> · {project.context.name}</span>}
            </span>
          )}
          <span className={styles.infoItem}>
            <ClockIcon width={15} height={15} />
            {project.targetSec ? `목표 ${formatDuration(project.targetSec * 1000)}` : "목표 시간 없음"}
          </span>
        </button>
        )}
        <div className={styles.topActions}>
          {rehearsal.saveError ? (
            <>
              <span className={styles.saveFail}>기록을 저장하지 못했어요</span>
              <Button variant="primary" onClick={rehearsal.retry} disabled={rehearsal.saving}>
                다시 저장
              </Button>
            </>
          ) : rehearsing ? (
            <>
              <Button
                variant="utility"
                onClick={rehearsal.togglePause}
                disabled={rehearsal.saving}
                aria-label={rehearsal.paused ? "재개" : "일시정지"}
              >
                {rehearsal.paused ? <PlayIcon width={16} height={16} /> : <PauseIcon width={16} height={16} />}
                <span className={styles.pauseLabel}>{rehearsal.paused ? "재개" : "일시정지"}</span>
              </Button>
              {/* Same spot as 연습 시작, so the button doesn't jump */}
              <Button variant="primary" onClick={() => void rehearsal.finish()} disabled={rehearsal.saving}>
                <StopIcon width={16} height={16} />
                {rehearsal.saving ? "저장 중…" : "종료"}
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={startRehearsal}>
              <MicIcon width={18} height={18} />
              연습 시작
            </Button>
          )}
        </div>
      </header>

      <div
        ref={splitRef}
        className={styles.split}
        style={{ "--slides-share": `${(splitRatio * 100).toFixed(2)}%` } as React.CSSProperties}
      >
        <section className={styles.slidesCol} aria-label="슬라이드">
          {error && <p className={styles.errorBox}>PDF를 열지 못했어요. 대본은 그대로 편집할 수 있어요.</p>}
          <SlideViewer doc={doc} index={current} pageCount={pageCount} onChange={changeSlide} keyboard={!rehearsing} />
        </section>

        <PaneDivider
          ratio={splitRatio}
          min={0.3}
          max={0.75}
          onChange={setSplitRatio}
          onReset={() => setSplitRatio(DEFAULT_SPLIT)}
          containerRef={splitRef}
        />

        <section className={styles.scriptCol} aria-label="대본">
          <div className={styles.tabsRow}>
            <div className={styles.segmented} role="tablist" aria-label="대본 보기 방식">
              {(
                [
                  ["slides", "슬라이드별 대본"],
                  ["whole", "전체 대본"],
                  ["runs", "회차 기록"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={mode === value}
                  disabled={rehearsing && value !== "slides"}
                  className={`${styles.segment} ${mode === value ? styles.segmentActive : ""}`}
                  onClick={() => {
                    // Storage has caught up by now; reload cards from it.
                    setAppliedSlides(null);
                    setMode(value);
                  }}
                >
                  {label}
                  {value === "whole" && wholeDraft !== null && <span className={styles.dot} aria-label="적용 안 한 편집 있음" />}
                </button>
              ))}
            </div>
          </div>

          {mode === "runs" ? (
            <RunsPanel
              projectId={project.id}
              titles={titles}
              selectedRunId={selectedRunId}
              onSelect={setSelectedRunId}
              onFocusSlide={setCurrent}
            />
          ) : mode === "slides" ? (
            <div ref={scriptScroll} className={styles.scriptScroll}>
              <ol className={styles.scriptList}>
                {Array.from({ length: pageCount }, (_, i) => (
                  <ScriptCard
                    key={`${cardsKey}-${i}`}
                    ref={(el) => {
                      cardRefs.current[i] = el;
                    }}
                    projectId={project.id}
                    index={i}
                    initialText={appliedSlides?.[i] ?? version.slides[i] ?? ""}
                    title={titles[i] ?? ""}
                    active={i === current}
                    onFocusSlide={changeSlide}
                    readOnly={rehearsing}
                    onRename={(index, title) => {
                      saveSlideTitle(project.id, index, title).catch(() => {});
                    }}
                  />
                ))}
              </ol>
            </div>
          ) : (
            <WholeScriptPanel
              projectId={project.id}
              doc={doc}
              slides={version.slides}
              draft={wholeDraft}
              onDraftChange={setWholeDraft}
              onApplied={(slides) => {
                setAppliedSlides(slides);
                setWholeDraft(null);
                setCardsKey((k) => k + 1);
                setMode("slides");
              }}
            />
          )}
        </section>
      </div>

      {editingInfo && (
        <ProjectInfoDialog
          mode="edit"
          initial={{ name: project.name, context: project.context, targetSec: project.targetSec }}
          onClose={() => setEditingInfo(false)}
          onSubmit={async (info) => {
            await updateProjectInfo(project.id, info);
            setEditingInfo(false);
          }}
        />
      )}
    </div>
  );
}
