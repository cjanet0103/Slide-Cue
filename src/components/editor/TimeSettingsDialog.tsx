"use client";

import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/timing";
import { partTargetSum, validateParts, type Part } from "@/lib/parts";
import { Button } from "@/components/ui/Button";
import base from "./ProjectInfoDialog.module.css";
import styles from "./TimeSettingsDialog.module.css";

interface Props {
  pageCount: number;
  targetSec?: number;
  parts?: Part[];
  onClose: () => void;
  onSubmit: (timing: { targetSec?: number; parts: Part[] }) => Promise<void>;
}

/** One part row as typed (strings, 1-based slide numbers, minutes). */
interface Row {
  name: string;
  from: string;
  to: string;
  minutes: string;
}

const toMinutes = (sec?: number) => (sec ? String(Math.round((sec / 60) * 100) / 100) : "");
const minutesOk = (m: string) => !m.trim() || (Number(m) > 0 && Number(m) <= 180);
const toSec = (m: string) => (m.trim() ? Math.round(Number(m) * 60) : undefined);

/**
 * 발표 시간 설정: the whole talk's target, and optional parts
 * (name / slide range / target). Saved on the project for the next rehearsals.
 */
export function TimeSettingsDialog({ pageCount, targetSec, parts, onClose, onSubmit }: Props) {
  const [total, setTotal] = useState(toMinutes(targetSec));
  const [rows, setRows] = useState<Row[]>(
    (parts ?? []).map((p) => ({ name: p.name, from: String(p.from + 1), to: String(p.to + 1), minutes: toMinutes(p.targetSec) })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const asParts: Part[] = rows.map((r) => ({
    name: r.name.trim(),
    from: r.from.trim() ? Number(r.from) - 1 : NaN,
    to: r.to.trim() ? Number(r.to) - 1 : NaN,
    targetSec: minutesOk(r.minutes) ? toSec(r.minutes) : undefined,
  }));
  const issues = validateParts(asParts, pageCount);
  const sumSec = partTargetSum(asParts);
  const totalSec = minutesOk(total) ? toSec(total) : undefined;
  const valid = minutesOk(total) && rows.every((r) => minutesOk(r.minutes)) && issues.every((i) => !i.range);

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const addPart = () =>
    setRows((rs) => {
      const lastTo = rs.length ? Number(rs[rs.length - 1].to) || 0 : 0;
      const from = Math.min(pageCount, lastTo + 1);
      return [...rs, { name: "", from: String(from), to: String(pageCount), minutes: "" }];
    });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      // With parts but no total, the parts' sum becomes the total target.
      await onSubmit({ targetSec: totalSec ?? sumSec ?? undefined, parts: asParts });
    } catch {
      setError("저장하지 못했어요. 브라우저 저장 공간을 확인한 뒤 다시 시도해 주세요.");
      setSaving(false);
    }
  };

  return (
    <div className={base.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className={base.dialog} role="dialog" aria-modal="true" aria-labelledby="time-title" onSubmit={submit}>
        <header className={base.header}>
          <h2 id="time-title" className={base.title}>
            발표 시간 설정
          </h2>
          <button type="button" className={base.close} onClick={onClose} aria-label="닫기">
            ×
          </button>
        </header>

        <div className={base.body}>
          <label className={base.field}>
            <span className={base.label}>전체 목표 시간</span>
            <span className={base.minutes}>
              <input
                className={base.input}
                type="number"
                min={0.5}
                max={180}
                step="any"
                inputMode="decimal"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                placeholder={sumSec ? String(sumSec / 60) : "7"}
                aria-label="전체 목표 시간(분)"
              />
              <span>분</span>
            </span>
            {!minutesOk(total) && <span className={base.hint}>0.5분에서 180분 사이로 입력해 주세요</span>}
          </label>

          <div className={base.field}>
            <span className={base.label}>파트 (선택)</span>
            {rows.length > 0 && (
              <ol className={styles.parts}>
                {rows.map((r, i) => (
                  <li key={i} className={styles.part}>
                    <div className={styles.partRow}>
                      <input
                        className={`${base.input} ${styles.name}`}
                        value={r.name}
                        onChange={(e) => update(i, { name: e.target.value })}
                        placeholder={`파트 ${i + 1} 이름`}
                        aria-label={`파트 ${i + 1} 이름`}
                      />
                      <span className={styles.range}>
                        <input
                          className={`${base.input} ${styles.num} ${issues[i]?.range ? styles.bad : ""}`}
                          type="number"
                          min={1}
                          max={pageCount}
                          inputMode="numeric"
                          value={r.from}
                          onChange={(e) => update(i, { from: e.target.value })}
                          aria-label={`파트 ${i + 1} 시작 장`}
                        />
                        <span>–</span>
                        <input
                          className={`${base.input} ${styles.num} ${issues[i]?.range ? styles.bad : ""}`}
                          type="number"
                          min={1}
                          max={pageCount}
                          inputMode="numeric"
                          value={r.to}
                          onChange={(e) => update(i, { to: e.target.value })}
                          aria-label={`파트 ${i + 1} 끝 장`}
                        />
                        <span>장</span>
                      </span>
                      <span className={styles.range}>
                        <input
                          className={`${base.input} ${styles.num} ${minutesOk(r.minutes) ? "" : styles.bad}`}
                          type="number"
                          min={0.5}
                          max={180}
                          step="any"
                          inputMode="decimal"
                          value={r.minutes}
                          onChange={(e) => update(i, { minutes: e.target.value })}
                          placeholder="분"
                          aria-label={`파트 ${i + 1} 목표 시간(분)`}
                        />
                        <span>분</span>
                      </span>
                      <button
                        type="button"
                        className={styles.remove}
                        onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                        aria-label={`파트 ${i + 1} 빼기`}
                        title="파트 빼기"
                      >
                        ×
                      </button>
                    </div>
                    {issues[i]?.range && <span className={base.hint}>{issues[i].range}</span>}
                    {!minutesOk(r.minutes) && <span className={base.hint}>0.5분에서 180분 사이로 입력해 주세요</span>}
                  </li>
                ))}
              </ol>
            )}
            <button type="button" className={styles.add} onClick={addPart}>
              + 파트 추가
            </button>
            {rows.length > 0 && (
              <p className={styles.sum}>
                파트 목표 합계 <strong>{sumSec ? formatDuration(sumSec * 1000) : "–"}</strong>
                {totalSec && sumSec && totalSec !== sumSec ? (
                  <span className={styles.sumNote}> · 전체 목표({formatDuration(totalSec * 1000)})와 달라요</span>
                ) : null}
                {!total.trim() && sumSec ? <span className={styles.sumNote}> · 전체 목표로 써요</span> : null}
              </p>
            )}
          </div>
        </div>

        {error && <p className={base.error}>{error}</p>}

        <footer className={base.footer}>
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" type="submit" disabled={!valid || saving}>
            {saving ? "저장 중…" : "저장"}
          </Button>
        </footer>
      </form>
    </div>
  );
}
