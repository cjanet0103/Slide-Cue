"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { contextLabel, db, saveAllSlideScripts, saveSlideTitle, updateProjectInfo, updateProjectTiming } from "@/lib/db";
import { formatClock, formatDuration } from "@/lib/timing";
import { useRehearsal } from "@/hooks/useRehearsal";
import { useAudienceLink } from "@/hooks/useAudienceLink";
import { useScriptTracking } from "@/hooks/useScriptTracking";
import { detectLang } from "@/lib/matching";
import { usePdfDocument } from "@/hooks/usePdfDocument";
import { useSlideTitles } from "@/hooks/useSlideTitles";
import { Button } from "@/components/ui/Button";
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ClockIcon,
  EyeIcon,
  EyeOffIcon,
  FileIcon,
  MicIcon,
  MicOffIcon,
  PanelRightIcon,
  ProjectorIcon,
  PauseIcon,
  PlayIcon,
  StopIcon,
} from "@/components/ui/Icons";
import { SlideViewer } from "./SlideViewer";
import { ScriptCard } from "./ScriptCard";
import { WholeScriptPanel } from "./WholeScriptPanel";
import { PaneDivider } from "./PaneDivider";
import { StartRehearsalButton, type StartOptions } from "./StartRehearsalButton";
import { RunsPanel } from "./RunsPanel";
import { ProjectInfoDialog } from "./ProjectInfoDialog";
import { TimeSettingsDialog } from "./TimeSettingsDialog";
import styles from "./Workspace.module.css";

type ScriptMode = "slides" | "runs";

// Slides/script split, remembered per browser as a convenience.
const SPLIT_KEY = "slidecue.splitRatio";
const DEFAULT_SPLIT = 0.55;
// Whether the script pane is collapsed (slides only), remembered per browser.
const SCRIPTS_CLOSED_KEY = "slidecue.scriptsClosed";
function readScriptsClosed(): boolean {
  try {
    return localStorage.getItem(SCRIPTS_CLOSED_KEY) === "1";
  } catch {
    return false;
  }
}

// Whether rehearsal clocks are hidden, remembered per browser.
const HIDE_CLOCKS_KEY = "slidecue.hideClocks";
function readHideClocks(): boolean {
  try {
    return localStorage.getItem(HIDE_CLOCKS_KEY) === "1";
  } catch {
    return false;
  }
}

function readSplit(): number {
  try {
    const v = Number(localStorage.getItem(SPLIT_KEY));
    return v >= 0.3 && v <= 0.75 ? v : DEFAULT_SPLIT;
  } catch {
    return DEFAULT_SPLIT;
  }
}

/** A clock value that can be masked in place: the real digits keep their width
 * (invisible), and a static placeholder sits on top, so nothing shifts or ticks. */
function MaskedClock({ className, value, masked }: { className: string; value: string; masked: boolean }) {
  return (
    <span className={`${className} ${styles.clockValue}`} data-masked={masked || undefined}>
      <span className={styles.clockReal} aria-hidden={masked || undefined}>
        {value}
      </span>
      {masked && (
        <span className={styles.clockMask} aria-label="숨김">
          ––:––
        </span>
      )}
    </span>
  );
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
  const version = useLiveQuery(() => (versionId ? db.scriptVersions.get(versionId) : undefined), [versionId]);
  const { doc, error } = usePdfDocument(projectId);
  // Runs so far (with no script yet, the run history tab still shows if there are any).
  const runCount = useLiveQuery(() => db.runs.where("projectId").equals(projectId).count(), [projectId]) ?? 0;

  const [current, setCurrent] = useState(0);
  const [mode, setMode] = useState<ScriptMode>(initialRunId ? "runs" : "slides");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initialRunId);
  const [editingInfo, setEditingInfo] = useState(false);
  const [editingTime, setEditingTime] = useState(false);
  // 전체 붙여넣기 view instead of the slide cards (switch above the script).
  const [pasting, setPasting] = useState(false);
  const [wholeDraft, setWholeDraft] = useState<string | null>(null);
  // Just split a pasted whole script: how many pages got text, and the script before (for 되돌리기).
  const [splitDone, setSplitDone] = useState<{
    previous: string[];
    count: number;
  } | null>(null);
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
    parts: project?.parts,
    onSaved: (run) => {
      setSelectedRunId(run.id);
      setMode("runs");
    },
  });
  const rehearsing = rehearsal.inProgress;

  const [scriptsClosed, setScriptsClosed] = useState(readScriptsClosed);
  const toggleScripts = () => {
    const next = !scriptsClosed;
    setScriptsClosed(next);
    try {
      localStorage.setItem(SCRIPTS_CLOSED_KEY, next ? "1" : "0");
    } catch {
      // Storage blocked: the choice lasts until the page reloads.
    }
  };

  const [clocksHidden, setClocksHidden] = useState(readHideClocks);
  const toggleClocks = () => {
    const next = !clocksHidden;
    setClocksHidden(next);
    try {
      localStorage.setItem(HIDE_CLOCKS_KEY, next ? "1" : "0");
    } catch {
      // Storage blocked: the choice lasts until the page reloads.
    }
  };

  // Live script tracking during rehearsal (on-device speech → highlighted phrase).
  // Auto-advance calls back into changeSlide (declared below), via a ref.
  const advanceRef = useRef<(next: number) => void>(() => {});
  const tracking = useScriptTracking(version?.slides ?? [], (next) => advanceRef.current(next));

  const changeSlide = (index: number) => {
    setCurrent(index);
    rehearsal.goTo(index);
    tracking.changeSlide(index);
  };

  useEffect(() => {
    advanceRef.current = changeSlide;
  });

  // Audience window (screen 3): it follows `current` — every manual or automatic
  // slide change — and a clicker pressed in that window steps the slide here.
  const audience = useAudienceLink(projectId, current, (delta) => {
    const next = current + delta;
    if (next >= 0 && next < pageCount) changeSlide(next);
  });

  // This session shows the slides on the projector: it isn't saved as a run (the user's choice).
  const [presenting, setPresenting] = useState(false);

  const finishRehearsal = () => {
    const transcripts = tracking.stop();
    if (presenting) {
      rehearsal.discard();
      audience.close();
      setPresenting(false);
    } else {
      void rehearsal.finish({ transcripts });
    }
  };

  const startRehearsal = (fromSlide: number, options: StartOptions) => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    setCurrent(fromSlide);
    setMode("slides");
    setPresenting(options.audience);
    // Open it first, while the click still counts for opening windows.
    if (options.audience) void audience.open();
    if (options.tracking)
      tracking.start(fromSlide, {
        lang: options.lang,
        autoAdvance: options.autoAdvance,
      });
    rehearsal.start(fromSlide);
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
      box.scrollTo({
        top: box.scrollTop + (r.top - boxTop) - 16,
        behavior: "smooth",
      });
    }
  }, [current, mode]);

  if (project === undefined || (versionId && version === undefined)) {
    return <p className={styles.status}>불러오는 중…</p>;
  }
  if (project === null || !version) {
    return <p className={styles.status}>발표를 찾을 수 없어요. 내 발표 목록에서 다시 선택해 주세요.</p>;
  }

  // Before any script: the top row offers 슬라이드별로 / 전체 붙여넣기. After: 대본 / 시간 기록.
  const hasScript = (appliedSlides ?? version.slides).some((t) => t.trim());
  const showTabs = hasScript || runCount > 0 || rehearsing;
  const pasteView = pasting && !showTabs;

  return (
    <div className={styles.workspace}>
      <header className={styles.topbar}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={onBack}
          disabled={rehearsing}
          aria-label="내 발표로 돌아가기"
          title={rehearsing ? "발표를 끝낸 뒤 나갈 수 있어요" : "내 발표"}
        >
          <ArrowLeftIcon />
        </button>
        <div className={styles.docTab}>
          <FileIcon width={16} height={16} />
          <span>{project.name}</span>
        </div>
        {rehearsing ? (
          <div className={styles.clocks} aria-label="연습 시간">
            <span
              className={`${styles.recDot} ${rehearsal.paused ? styles.recDotPaused : ""} ${clocksHidden ? styles.recDotStill : ""}`}
              aria-hidden="true"
            />
            <span className={styles.clockLabel}>{rehearsal.paused ? "일시정지" : presenting ? "발표 중" : "연습 중"}</span>
            {/* Hidden = masked in place: same widths, nothing moves or ticks. */}
            <MaskedClock
              className={`${styles.clockMain} ${!clocksHidden && project.targetSec && rehearsal.totalMs > project.targetSec * 1000 ? styles.clockOver : ""}`}
              value={formatClock(rehearsal.totalMs)}
              masked={clocksHidden}
            />
            {project.targetSec ? (
              <span className={styles.clockTarget}>/ {formatClock(project.targetSec * 1000)}</span>
            ) : null}
            <span className={styles.clockDivider} aria-hidden="true" />
            <span className={styles.clockLabel}>슬라이드</span>
            <MaskedClock className={styles.clockSlide} value={formatClock(rehearsal.slideMs)} masked={clocksHidden} />
            {/* Toggle hiding the ticking numbers (they keep counting); like a design tool's eye toggle */}
            <button
              type="button"
              className={styles.eyeBtn}
              onClick={toggleClocks}
              aria-pressed={clocksHidden}
              aria-label={clocksHidden ? "시간 보이기" : "시간 숨기기"}
              title={clocksHidden ? "시간 보이기" : "시간 숨기기"}
            >
              {clocksHidden ? <EyeOffIcon width={18} height={18} /> : <EyeIcon width={18} height={18} />}
            </button>
            {/* Script-tracking state; fixed size so nothing shifts when it changes */}
            <span
              className={`${styles.trackState} ${tracking.status === "listening" ? styles.trackOn : ""}`}
              role="status"
              title={
                tracking.status === "listening"
                  ? "대본 따라가는 중 (이 기기에서 음성 인식)"
                  : tracking.status === "manual"
                    ? tracking.manualReason === "denied"
                      ? "수동 진행: 마이크 권한이 꺼져 있어요"
                      : "수동 진행: 음성 인식이 멈췄어요"
                    : "수동 진행: 대본 따라가기 꺼짐"
              }
              aria-label={tracking.status === "listening" ? "대본 따라가는 중" : "수동 진행"}
            >
              {tracking.status === "listening" ? (
                <MicIcon width={16} height={16} />
              ) : (
                <MicOffIcon width={16} height={16} />
              )}
            </span>
          </div>
        ) : (
          <div className={styles.infoGroup}>
            <button
              type="button"
              className={styles.infoBtn}
              onClick={() => setEditingInfo(true)}
              title="발표 정보 고치기"
            >
              <span className={styles.infoItem}>
                {project.context ? (
                  <>
                    {contextLabel(project.context.kind)}
                    {project.context.name && <span className={styles.infoName}> · {project.context.name}</span>}
                  </>
                ) : (
                  "발표 정보"
                )}
              </span>
            </button>
            {/* 발표 시간 설정: total target and optional parts */}
            <button
              type="button"
              className={`${styles.infoBtn} ${styles.timeBtn}`}
              onClick={() => setEditingTime(true)}
              aria-haspopup="dialog"
            >
              <span className={styles.infoItem}>
                <ClockIcon width={15} height={15} />
                {project.targetSec || project.parts?.length
                  ? [
                      project.targetSec ? `목표 ${formatDuration(project.targetSec * 1000)}` : "목표 없음",
                      project.parts?.length ? `${project.parts.length}개 파트` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "발표 시간 설정"}
                <ChevronDownIcon width={14} height={14} />
              </span>
            </button>
          </div>
        )}
        {/* 연습 시작 / 일시정지 · 종료 live in the round buttons at the bottom right;
            only a failed save is reported up here. */}
        {/* On the projector: shows the link, and brings the slide window back if it was closed */}
        {rehearsing && presenting && !rehearsal.saveError && (
          <div className={styles.topActions}>
            <button
              type="button"
              className={`${styles.infoBtn} ${audience.connected ? styles.audienceOn : ""}`}
              onClick={() => void audience.open()}
              title={audience.connected ? "프로젝터에 슬라이드를 띄우고 있어요" : "프로젝터에 슬라이드 다시 띄우기"}
            >
              <span className={styles.infoItem}>
                <ProjectorIcon width={16} height={16} />
                {audience.connected ? "프로젝터 연결됨" : "프로젝터에 다시 띄우기"}
              </span>
            </button>
          </div>
        )}
        {rehearsal.saveError && (
          <div className={styles.topActions}>
            <span className={styles.saveFail}>기록을 저장하지 못했어요</span>
            <Button variant="primary" onClick={rehearsal.retry} disabled={rehearsal.saving}>
              다시 저장
            </Button>
          </div>
        )}
      </header>

      <div
        ref={splitRef}
        className={`${styles.split} ${scriptsClosed ? styles.splitClosed : ""}`}
        style={
          {
            "--slides-share": `${(splitRatio * 100).toFixed(2)}%`,
          } as React.CSSProperties
        }
      >
        <section className={styles.slidesCol} aria-label="슬라이드">
          {error && <p className={styles.errorBox}>PDF를 열지 못했어요. 대본은 그대로 편집할 수 있어요.</p>}
          <SlideViewer doc={doc} index={current} pageCount={pageCount} onChange={changeSlide} keyboard={!rehearsing} />
          {scriptsClosed && (
            <button
              type="button"
              className={`${styles.paneToggle} ${styles.paneToggleOpen}`}
              onClick={toggleScripts}
              aria-label="대본 열기"
              title="대본 열기"
            >
              <PanelRightIcon />
            </button>
          )}
        </section>

        <PaneDivider
          ratio={splitRatio}
          min={0.3}
          max={0.75}
          onChange={setSplitRatio}
          onReset={() => setSplitRatio(DEFAULT_SPLIT)}
          containerRef={splitRef}
        />

        <section className={styles.scriptCol} aria-label="대본" hidden={scriptsClosed}>
          <div className={styles.tabsRow}>
            <button
              type="button"
              className={`${styles.paneToggle} ${styles.paneToggleClose}`}
              onClick={toggleScripts}
              aria-label="대본 닫기"
              title="대본 닫기 (슬라이드만 보기)"
            >
              <PanelRightIcon />
            </button>
            {showTabs ? (
              <div className={styles.segmented} role="tablist" aria-label="대본 보기 방식">
                {(
                  [
                    ["slides", "대본"],
                    ["runs", "연습 기록"],
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
                  </button>
                ))}
              </div>
            ) : (
              // No script yet: 슬라이드별 대본 / 전체 대본. Once there is one, this row becomes 대본 · 시간 기록.
              <div className={styles.segmented} role="radiogroup" aria-label="대본 넣는 방식">
                {(
                  [
                    [false, "슬라이드별 대본"],
                    [true, "전체 대본"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={label}
                    type="button"
                    role="radio"
                    aria-checked={pasting === value}
                    className={`${styles.segment} ${pasting === value ? styles.segmentActive : ""}`}
                    onClick={() => setPasting(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {mode === "runs" ? (
            <RunsPanel
              projectId={project.id}
              titles={titles}
              selectedRunId={selectedRunId}
              onSelect={setSelectedRunId}
              onFocusSlide={setCurrent}
            />
          ) : (
            <>
              {splitDone && !pasteView && (
                <div className={styles.splitBar} role="status">
                  <span>{splitDone.count}장으로 나눴어요</span>
                  <button
                    type="button"
                    className={styles.splitUndo}
                    onClick={async () => {
                      const previous = splitDone.previous;
                      setSplitDone(null);
                      await saveAllSlideScripts(project.id, previous).catch(() => {});
                      setAppliedSlides(previous);
                      setCardsKey((k) => k + 1);
                    }}
                  >
                    되돌리기
                  </button>
                  <button
                    type="button"
                    className={styles.splitClose}
                    onClick={() => setSplitDone(null)}
                    aria-label="닫기"
                  >
                    ×
                  </button>
                </div>
              )}
              {pasteView ? (
                <WholeScriptPanel
                  projectId={project.id}
                  doc={doc}
                  slides={version.slides}
                  draft={wholeDraft}
                  onDraftChange={setWholeDraft}
                  onSplit={({ previous, slides }) => {
                    // Back to the slides, each page now holding its part.
                    setAppliedSlides(slides);
                    setWholeDraft(null);
                    setPasting(false);
                    setCardsKey((k) => k + 1);
                    setSplitDone({
                      previous,
                      count: slides.filter((t) => t.trim()).length,
                    });
                  }}
                />
              ) : (
                <div
                  ref={scriptScroll}
                  className={`${styles.scriptScroll} ${styles.scriptScrollFabRoom}`}
                  data-script-scroll
                >
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
                        trackedIndex={rehearsing && i === current ? tracking.segmentIndex : null}
                        onSelectSegment={tracking.selectSegment}
                        trackChar={tracking.charIndex}
                        onRename={(index, title) => {
                          saveSlideTitle(project.id, index, title).catch(() => {});
                        }}
                      />
                    ))}
                  </ol>
                </div>
              )}
            </>
          )}

        </section>

        {/* One round button in the bottom-right corner: 연습 시작 (mic), or
            일시정지/재개 · 종료 while rehearsing. Hidden only on the paste screen. */}
        {!pasteView && (
          <div className={styles.fab}>
            {rehearsing ? (
              <>
                <button
                  type="button"
                  className={`${styles.fabBtn} ${styles.fabBtnQuiet}`}
                  onClick={rehearsal.togglePause}
                  disabled={rehearsal.saving}
                  aria-label={rehearsal.paused ? "재개" : "일시정지"}
                  title={rehearsal.paused ? "재개" : "일시정지"}
                >
                  {rehearsal.paused ? <PlayIcon width={20} height={20} /> : <PauseIcon width={20} height={20} />}
                </button>
                <button
                  type="button"
                  className={styles.fabBtn}
                  onClick={finishRehearsal}
                  disabled={rehearsal.saving}
                  aria-label={rehearsal.saving ? "저장 중" : "종료"}
                  title={rehearsal.saving ? "저장 중…" : "종료"}
                >
                  <StopIcon width={20} height={20} />
                </button>
              </>
            ) : (
              <StartRehearsalButton
                current={current}
                defaultLang={detectLang(version.slides.join(" "))}
                onStart={startRehearsal}
                secondScreen={audience.secondScreen}
                onPrepareAudience={() => void audience.prepare()}
                variant="fab"
              />
            )}
          </div>
        )}
      </div>

      {editingTime && (
        <TimeSettingsDialog
          pageCount={pageCount}
          targetSec={project.targetSec}
          parts={project.parts}
          onClose={() => setEditingTime(false)}
          onSubmit={async (timing) => {
            await updateProjectTiming(project.id, timing);
            setEditingTime(false);
          }}
        />
      )}

      {editingInfo && (
        <ProjectInfoDialog
          mode="edit"
          initial={{
            name: project.name,
            context: project.context,
            targetSec: project.targetSec,
          }}
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
