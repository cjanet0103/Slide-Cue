"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, saveSlideTitle } from "@/lib/db";
import { usePdfDocument } from "@/hooks/usePdfDocument";
import { getPageTitles } from "@/lib/pdf";
import { ArrowLeftIcon, FileIcon } from "@/components/ui/Icons";
import { SlideViewer } from "./SlideViewer";
import { ScriptCard } from "./ScriptCard";
import { WholeScriptPanel } from "./WholeScriptPanel";
import { PaneDivider } from "./PaneDivider";
import styles from "./Workspace.module.css";

type ScriptMode = "slides" | "whole";

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

export function Workspace({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const versionId = project?.currentScriptVersionId;
  const version = useLiveQuery(
    () => (versionId ? db.scriptVersions.get(versionId) : undefined),
    [versionId],
  );
  const { doc, error } = usePdfDocument(projectId);

  const [current, setCurrent] = useState(0);
  const [mode, setMode] = useState<ScriptMode>("slides");
  const [wholeDraft, setWholeDraft] = useState<string | null>(null);
  // Bumped after applying the whole script so script cards reload their text.
  const [cardsKey, setCardsKey] = useState(0);
  // Applied text, shown immediately while storage catches up.
  const [appliedSlides, setAppliedSlides] = useState<string[] | null>(null);
  const scriptScroll = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLLIElement | null)[]>([]);
  const pageCount = project?.pageCount ?? 0;
  const [titles, setTitles] = useState<string[]>([]);
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

  // Section headings come from each slide's own text.
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    getPageTitles(doc)
      .then((t) => {
        if (!cancelled) setTitles(t);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [doc]);

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
        <button type="button" className={styles.iconBtn} onClick={onBack} aria-label="내 발표로 돌아가기" title="내 발표">
          <ArrowLeftIcon />
        </button>
        <div className={styles.docTab}>
          <FileIcon width={16} height={16} />
          <span>{project.name}</span>
        </div>
      </header>

      <div
        ref={splitRef}
        className={styles.split}
        style={{ "--slides-share": `${(splitRatio * 100).toFixed(2)}%` } as React.CSSProperties}
      >
        <section className={styles.slidesCol} aria-label="슬라이드">
          {error && <p className={styles.errorBox}>PDF를 열지 못했어요. 대본은 그대로 편집할 수 있어요.</p>}
          <SlideViewer doc={doc} index={current} pageCount={pageCount} onChange={setCurrent} />
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
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={mode === value}
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

          {mode === "slides" ? (
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
                    title={project.slideTitles?.[i] || titles[i] || ""}
                    active={i === current}
                    onFocusSlide={setCurrent}
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
    </div>
  );
}
