"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { listRuns, type Run } from "@/lib/db";
import { compareRuns, formatDuration } from "@/lib/timing";
import { slideLabel } from "@/hooks/useSlideTitles";
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

function deltaText(deltaMs: number): { text: string; tone: "less" | "more" | "same" } {
  if (Math.abs(deltaMs) < 1000) return { text: "비슷함", tone: "same" };
  return deltaMs < 0
    ? { text: `${formatDuration(-deltaMs)} 감소`, tone: "less" }
    : { text: `${formatDuration(deltaMs)} 증가`, tone: "more" };
}

/** Run history: pick a run, see per-slide time against the previous rehearsal. */
export function RunsPanel({ projectId, titles, selectedRunId, onSelect, onFocusSlide }: Props) {
  const runs = useLiveQuery(() => listRuns(projectId), [projectId]);

  if (!runs) return null;
  if (runs.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>아직 연습 기록이 없어요</p>
        <p className={styles.emptyText}>위의 연습 시작을 눌러 첫 연습을 해 보세요. 끝나면 장별 시간이 여기에 남아요.</p>
      </div>
    );
  }

  // Oldest = 1회차.
  const numberOf = new Map(runs.map((r, i) => [r.id, runs.length - i]));
  const selected = runs.find((r) => r.id === selectedRunId) ?? runs[0];
  const previous: Run | undefined = runs.find((r) => r.mode === "rehearsal" && r.startedAt < selected.startedAt);
  const rows = compareRuns(selected.slideMs, previous?.slideMs ?? null);
  const targetMs = selected.targetSec ? selected.targetSec * 1000 : null;
  const totalDelta = previous ? selected.totalMs - previous.totalMs : null;

  return (
    <div className={styles.panel}>
      <div className={styles.runList} role="listbox" aria-label="회차 선택">
        {runs.map((r) => (
          <button
            key={r.id}
            type="button"
            role="option"
            aria-selected={r.id === selected.id}
            className={`${styles.runRow} ${r.id === selected.id ? styles.runRowActive : ""}`}
            onClick={() => onSelect(r.id)}
          >
            <span className={styles.runNo}>{numberOf.get(r.id)}회차</span>
            <span className={styles.runDate}>{dateFmt.format(r.startedAt)}</span>
          </button>
        ))}
      </div>

      <div className={styles.summary}>
        <div>
          <p className={styles.summaryLabel}>
            {numberOf.get(selected.id)}회차 {selected.mode === "live" ? "실전" : "연습"} · 전체 시간
          </p>
          <p className={styles.summaryTotal}>{formatDuration(selected.totalMs)}</p>
        </div>
        <div className={styles.summaryMeta}>
          {targetMs !== null && (
            <p>
              목표 {formatDuration(targetMs)} ·{" "}
              {selected.totalMs > targetMs ? (
                <span className={styles.more}>{formatDuration(selected.totalMs - targetMs)} 초과</span>
              ) : (
                <span>{formatDuration(targetMs - selected.totalMs)} 남음</span>
              )}
            </p>
          )}
          {previous && totalDelta !== null && (
            <p>
              {numberOf.get(previous.id)}회차보다{" "}
              <span className={styles[deltaText(totalDelta).tone]}>{deltaText(totalDelta).text}</span>
            </p>
          )}
        </div>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">슬라이드</th>
            <th scope="col" className={styles.num}>
              이번
            </th>
            <th scope="col" className={styles.num}>
              {previous ? `${numberOf.get(previous.id)}회차` : "지난번"}
            </th>
            <th scope="col" className={styles.num}>
              차이
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const d = row.deltaMs !== null ? deltaText(row.deltaMs) : null;
            return (
              <tr key={row.slide}>
                <th scope="row">
                  <button type="button" className={styles.slideBtn} onClick={() => onFocusSlide(row.slide)}>
                    <span className={styles.slideNo}>{String(row.slide + 1).padStart(2, "0")}</span>
                    <span className={styles.slideName}>{slideLabel(titles, row.slide)}</span>
                  </button>
                </th>
                <td className={styles.num}>{row.currentMs !== null ? formatDuration(row.currentMs) : "–"}</td>
                <td className={`${styles.num} ${styles.muted}`}>
                  {row.previousMs !== null ? formatDuration(row.previousMs) : "–"}
                </td>
                <td className={styles.num}>
                  {d ? <span className={styles[d.tone]}>{d.text}</span> : <span className={styles.none}>비교 기록 없음</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
