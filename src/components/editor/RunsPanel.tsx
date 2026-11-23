"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { deleteRun, listRuns, saveRunMemo, type Run } from "@/lib/db";
import { formatDuration } from "@/lib/timing";
import { partLabel, partResults, rangeLabel, targetDeltaText, type PartResult } from "@/lib/parts";
import { slideLabel } from "@/hooks/useSlideTitles";
import { ChevronRightIcon, MoreIcon, NoteIcon, TrashIcon } from "@/components/ui/Icons";
import styles from "./RunsPanel.module.css";

interface Props {
  projectId: string;
  titles: string[];
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
  onFocusSlide: (index: number) => void;
}

const dateFmt = new Intl.DateTimeFormat("ko-KR", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * 연습 기록: the current run on top (회차 · date · total, memo and trash icons,
 * parts → slides); the other runs listed below as toggle rows that open in place.
 */
export function RunsPanel({ projectId, titles, selectedRunId, onSelect, onFocusSlide }: Props) {
  const runs = useLiveQuery(() => listRuns(projectId), [projectId]);
  const [openRuns, setOpenRuns] = useState<Set<string>>(new Set());

  if (!runs) return null;
  if (runs.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>아직 연습 기록이 없어요</p>
        <p className={styles.emptyText}>오른쪽 아래 마이크 버튼으로 첫 연습을 시작해 보세요.</p>
      </div>
    );
  }

  // Numbered per kind, oldest first: 1회차, 2회차, … (live talks counted separately).
  const numberOf = new Map<string, number>();
  const counts: Record<string, number> = {};
  [...runs].reverse().forEach((r) => {
    counts[r.mode] = (counts[r.mode] ?? 0) + 1;
    numberOf.set(r.id, counts[r.mode]);
  });
  const runLabel = (r: Run) => `${numberOf.get(r.id)}회차${r.mode === "live" ? " 실전" : ""}`;
  const selected = runs.find((r) => r.id === selectedRunId) ?? runs[0];
  const others = runs.filter((r) => r.id !== selected.id);

  const neighbourOf = (r: Run) => {
    const i = runs.findIndex((x) => x.id === r.id);
    return runs[i + 1] ?? runs[i - 1];
  };

  const toggleRun = (id: string) =>
    setOpenRuns((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className={styles.panel}>
      {/* The current run: 회차 · date ........ total ⋯ (memo under it) */}
      <div className={styles.headBlock}>
        <div className={styles.head}>
          <div className={styles.headLeft}>
            <span className={styles.runBadge}>{runLabel(selected)}</span>
            <span className={styles.headDate}>{dateFmt.format(selected.startedAt)}</span>
          </div>
          <div className={styles.headRight}>
            <span className={styles.headTotalBox}>
              <span className={styles.colLabel}>총 시간</span>
              <span className={styles.headTotal}>{formatDuration(selected.totalMs)}</span>
            </span>
            <RunActions
              run={selected}
              label={runLabel(selected)}
              onDeleted={() => {
                const next = neighbourOf(selected);
                if (next) onSelect(next.id);
              }}
            />
          </div>
        </div>
        <MemoLine memo={selected.memo} full />
      </div>

      <RunDetail key={selected.id} run={selected} titles={titles} onFocusSlide={onFocusSlide} />

      {/* The other runs, right below: each row opens its own result in place */}
      {others.length > 0 && (
        <section className={styles.others} aria-label="이전 연습 기록">
          {/* One line: the list's name on the left, the column name over the totals */}
          <div className={styles.otherHead}>
            <h3 className={styles.othersTitle}>이전 연습 기록</h3>
            <span className={styles.colLabel}>총 시간</span>
            <span className={styles.actionsSpace} aria-hidden="true" />
          </div>
          <ul className={styles.otherList}>
            {others.map((r) => {
              const open = openRuns.has(r.id);
              return (
                <li key={r.id} className={styles.otherItem}>
                  <div className={styles.otherRow}>
                    <button type="button" className={styles.otherToggle} aria-expanded={open} onClick={() => toggleRun(r.id)}>
                      <span className={`${styles.caret} ${open ? styles.caretOpen : ""}`}>
                        <ChevronRightIcon width={14} height={14} />
                      </span>
                      <span className={styles.otherNo}>{runLabel(r)}</span>
                      <span className={styles.otherDate}>{dateFmt.format(r.startedAt)}</span>
                      <span className={styles.otherTotal}>{formatDuration(r.totalMs)}</span>
                    </button>
                    <RunActions run={r} label={runLabel(r)} onDeleted={() => {}} />
                  </div>
                  <MemoLine memo={r.memo} indent full={open} />
                  {open && (
                    <div className={styles.otherDetail}>
                      <RunDetail run={r} titles={titles} onFocusSlide={onFocusSlide} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

/** The run's memo, right under its own row: small grey text after a note icon (2 lines in a closed row, all of it otherwise). */
function MemoLine({ memo, indent, full }: { memo?: string; indent?: boolean; full?: boolean }) {
  if (!memo?.trim()) return null;
  return (
    <p className={`${styles.memoLine} ${indent ? styles.memoIndent : ""}`}>
      <NoteIcon width={14} height={14} className={styles.memoIcon} />
      <span className={full ? styles.memoFull : styles.memoText}>{memo}</span>
    </p>
  );
}

/**
 * ⋯ button for one run: a small menu with 메모 쓰기/고치기 and 삭제.
 * The memo is written in a small card and shown under its own run's row
 * (`MemoLine`), never as a hover popup; 삭제 asks once in a small card.
 */
function RunActions({ run, label, onDeleted }: { run: Run; label: string; onDeleted: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [memoDraft, setMemoDraft] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const anyOpen = menuOpen || memoDraft !== null || confirmDelete;

  // Clicking elsewhere closes the card (an unsaved memo is dropped).
  useEffect(() => {
    if (!anyOpen) return;
    const onDown = (e: MouseEvent) => {
      if ((e.target as Element).closest?.(`[data-run-actions="${run.id}"]`)) return;
      setMenuOpen(false);
      setMemoDraft(null);
      setConfirmDelete(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [anyOpen, run.id]);

  const saveMemo = async (text: string) => {
    await saveRunMemo(run.id, text);
    setMemoDraft(null);
  };

  return (
    <div className={styles.actions} data-run-actions={run.id}>
      <div className={styles.iconWrap}>
        <button
          type="button"
          className={`${styles.iconBtn} ${anyOpen ? styles.iconBtnOpen : ""}`}
          onClick={() => {
            const next = !anyOpen;
            setMemoDraft(null);
            setConfirmDelete(false);
            setMenuOpen(next);
          }}
          aria-label={`${label} 메모·삭제`}
          aria-haspopup="menu"
          aria-expanded={anyOpen}
        >
          <MoreIcon width={17} height={17} />
        </button>
        {menuOpen && (
          <div className={styles.menu} role="menu" aria-label={`${label} 메모·삭제`}>
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => {
                setMenuOpen(false);
                setMemoDraft(run.memo ?? "");
              }}
            >
              <NoteIcon width={16} height={16} />
              {run.memo ? "메모 고치기" : "메모 쓰기"}
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => {
                setMenuOpen(false);
                setConfirmDelete(true);
              }}
            >
              <TrashIcon width={16} height={16} />
              삭제
            </button>
          </div>
        )}
        {memoDraft !== null && (
          <div className={styles.card} role="dialog" aria-label={`${label} 메모`}>
            <textarea
              className={styles.memoInput}
              value={memoDraft}
              onChange={(e) => setMemoDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setMemoDraft(null);
                else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void saveMemo(memoDraft);
              }}
              placeholder="메모"
              aria-label={`${label} 메모`}
              rows={3}
              autoFocus
            />
            <div className={styles.cardActions}>
              {run.memo && (
                <button type="button" className={`${styles.cardAction} ${styles.cardLeft}`} onClick={() => saveMemo("")}>
                  지우기
                </button>
              )}
              <button type="button" className={styles.cardAction} onClick={() => setMemoDraft(null)}>
                취소
              </button>
              <button type="button" className={`${styles.cardAction} ${styles.cardStrong}`} onClick={() => saveMemo(memoDraft)}>
                저장
              </button>
            </div>
          </div>
        )}
        {confirmDelete && (
          <div className={styles.card} role="dialog" aria-label={`${label} 기록 삭제`}>
            <p className={styles.cardText}>{label} 기록을 삭제할까요? 되돌릴 수 없어요.</p>
            <div className={styles.cardActions}>
              <button type="button" className={styles.cardAction} onClick={() => setConfirmDelete(false)}>
                취소
              </button>
              <button
                type="button"
                className={`${styles.cardAction} ${styles.cardDanger}`}
                onClick={async () => {
                  await deleteRun(run.id);
                  setConfirmDelete(false);
                  onDeleted();
                }}
              >
                삭제
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** One run's result: parts (collapsed) → slides, or the practiced slides. */
function RunDetail({ run, titles, onFocusSlide }: { run: Run; titles: string[]; onFocusSlide: (index: number) => void }) {
  const [openParts, setOpenParts] = useState<Set<number>>(new Set());
  const hasParts = (run.parts?.length ?? 0) > 0;
  const { parts: partRows, rest } = partResults(run.slideMs, run.parts ?? []);

  const practicedSlides = (from: number, to: number) => {
    const out: number[] = [];
    for (let s = from; s <= to; s++) if ((run.slideMs[s] ?? 0) > 0) out.push(s);
    return out;
  };
  const allPracticed = practicedSlides(0, run.slideMs.length - 1);

  const togglePart = (i: number) =>
    setOpenParts((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  const slideRow = (slide: number) => (
    <li key={slide} className={styles.slideRow}>
      <button type="button" className={styles.slideBtn} onClick={() => onFocusSlide(slide)}>
        <span className={styles.slideNo}>{String(slide + 1).padStart(2, "0")}</span>
        <span className={styles.slideName}>{slideLabel(titles, slide)}</span>
      </button>
      <span className={styles.slideTime}>{formatDuration(run.slideMs[slide])}</span>
    </li>
  );

  const partResultText = (p: PartResult) => {
    if (p.status === "none") return <span className={styles.muted}>미연습</span>;
    if (p.status === "partial")
      return (
        <span>
          {formatDuration(p.actualMs)}
          <span className={styles.muted}>
            {" "}
            · {p.practiced}/{p.slides}장 연습
          </span>
        </span>
      );
    return <span>{formatDuration(p.actualMs)}</span>;
  };

  return (
    <>
      {hasParts ? (
        <ul className={styles.parts}>
          {partRows.map((p) => {
            const open = openParts.has(p.index);
            return (
              <li key={p.index} className={styles.partItem}>
                <button
                  type="button"
                  className={styles.partRow}
                  aria-expanded={open}
                  onClick={() => togglePart(p.index)}
                  disabled={p.status === "none"}
                >
                  <span className={`${styles.caret} ${open ? styles.caretOpen : ""}`}>
                    <ChevronRightIcon width={14} height={14} />
                  </span>
                  <span className={styles.partName}>
                    {partLabel(p.part, p.index)} <span className={styles.muted}>({rangeLabel(p.part)})</span>
                  </span>
                  <span className={styles.partTarget}>{p.part.targetSec ? `목표 ${formatDuration(p.part.targetSec * 1000)}` : ""}</span>
                  <span className={styles.partActual}>{partResultText(p)}</span>
                  <span className={styles.partDelta}>
                    {p.deltaMs !== null &&
                      (() => {
                        const d = targetDeltaText(p.deltaMs, formatDuration);
                        return <span className={styles[d.tone]}>{d.text}</span>;
                      })()}
                  </span>
                </button>
                {open && <ul className={styles.slides}>{practicedSlides(p.part.from, p.part.to).map(slideRow)}</ul>}
              </li>
            );
          })}
          {rest.length > 0 && (
            <li className={styles.partItem}>
              <p className={styles.restTitle}>파트 밖 슬라이드</p>
              <ul className={styles.slides}>{rest.map(slideRow)}</ul>
            </li>
          )}
        </ul>
      ) : (
        <ul className={styles.slides}>{allPracticed.map(slideRow)}</ul>
      )}
    </>
  );
}
