"use client";

import { useEffect, useRef, useState } from "react";
import { CONTEXT_KINDS, type ContextKind, type ProjectInfo } from "@/lib/db";
import { openPdf, renderThumbnail } from "@/lib/pdf";
import { Button } from "@/components/ui/Button";
import { FileIcon, UploadIcon } from "@/components/ui/Icons";
import styles from "./ProjectInfoDialog.module.css";

export interface PickedPdf {
  file: File;
  pageCount: number;
  thumbnail?: string;
}

interface Props {
  mode: "create" | "edit";
  initial?: ProjectInfo;
  onClose: () => void;
  /** create: pdf is always set. edit: pdf is undefined. */
  onSubmit: (info: ProjectInfo, pdf?: PickedPdf) => Promise<void>;
}

/** Register a presentation (title, situation, PDF, target time), or edit those details later. */
export function ProjectInfoDialog({ mode, initial, onClose, onSubmit }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<ContextKind | null>(initial?.context?.kind ?? null);
  const [contextName, setContextName] = useState(initial?.context?.name ?? "");
  const [minutes, setMinutes] = useState(initial?.targetSec ? String(initial.targetSec / 60) : "");
  const [pdf, setPdf] = useState<PickedPdf | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setReading(true);
    try {
      const doc = await openPdf(file);
      try {
        if (doc.numPages < 1) throw new Error("empty");
        const thumbnail = await renderThumbnail(doc);
        setPdf({ file, pageCount: doc.numPages, thumbnail });
        if (!name.trim()) setName(file.name.replace(/\.pdf$/i, ""));
      } finally {
        await doc.destroy();
      }
    } catch {
      setPdf(null);
      setError("PDF를 열 수 없어요. 한 장 이상인 PDF 파일을 다시 선택해 주세요.");
    } finally {
      setReading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const minutesNum = Number(minutes);
  const minutesValid = !minutes.trim() || (minutesNum > 0 && minutesNum <= 180);
  const canSubmit = name.trim() && minutesValid && (mode === "edit" || pdf) && !saving && !reading;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    const info: ProjectInfo = {
      name: name.trim(),
      context: kind ? { kind, name: contextName.trim() } : undefined,
      targetSec: minutes.trim() ? Math.round(minutesNum * 60) : undefined,
    };
    try {
      await onSubmit(info, pdf ?? undefined);
    } catch {
      setError("저장하지 못했어요. 브라우저 저장 공간을 확인한 뒤 다시 시도해 주세요.");
      setSaving(false);
    }
  };

  const placeholder = CONTEXT_KINDS.find((k) => k.kind === kind)?.namePlaceholder ?? "공모전 이름, 과목 이름 등";

  return (
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="info-title" onSubmit={submit}>
        <header className={styles.header}>
          <h2 id="info-title" className={styles.title}>
            {mode === "create" ? "새 발표" : "발표 정보"}
          </h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="닫기">
            ×
          </button>
        </header>

        <div className={styles.body}>
          {mode === "create" && (
            <div className={styles.field}>
              <span className={styles.label}>발표 자료</span>
              <input
                ref={fileInput}
                type="file"
                accept="application/pdf,.pdf"
                className="visually-hidden"
                onChange={(e) => pickFile(e.target.files?.[0])}
                aria-label="발표 PDF 선택"
              />
              <button type="button" className={styles.drop} onClick={() => fileInput.current?.click()} disabled={reading}>
                {pdf ? (
                  <>
                    {pdf.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element -- local data URL
                      <img src={pdf.thumbnail} alt="" className={styles.dropThumb} />
                    ) : (
                      <FileIcon width={28} height={28} />
                    )}
                    <span className={styles.dropText}>
                      <strong>{pdf.file.name}</strong>
                      <span>{pdf.pageCount}장 · 눌러서 다른 파일 선택</span>
                    </span>
                  </>
                ) : (
                  <>
                    <span className={styles.dropIcon}>
                      <UploadIcon width={22} height={22} />
                    </span>
                    <span className={styles.dropText}>
                      <strong>{reading ? "PDF 여는 중…" : "PDF 선택"}</strong>
                      <span>PowerPoint는 PDF로 내보내 올려 주세요</span>
                    </span>
                  </>
                )}
              </button>
            </div>
          )}

          <label className={styles.field}>
            <span className={styles.label}>발표 제목</span>
            <input
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 일본 데모데이 피칭"
              required
            />
          </label>

          <div className={styles.field}>
            <span className={styles.label}>발표 상황</span>
            <div className={styles.kinds} role="radiogroup" aria-label="발표 상황 종류">
              {CONTEXT_KINDS.map((k) => (
                <button
                  key={k.kind}
                  type="button"
                  role="radio"
                  aria-checked={kind === k.kind}
                  className={`${styles.kind} ${kind === k.kind ? styles.kindActive : ""}`}
                  onClick={() => setKind(kind === k.kind ? null : k.kind)}
                >
                  {k.label}
                </button>
              ))}
            </div>
            {kind && (
              <input
                className={styles.input}
                value={contextName}
                onChange={(e) => setContextName(e.target.value)}
                placeholder={placeholder}
                aria-label={placeholder}
              />
            )}
          </div>

          <label className={styles.field}>
            <span className={styles.label}>발표 시간</span>
            <span className={styles.minutes}>
              <input
                className={styles.input}
                type="number"
                min={0.5}
                max={180}
                step={0.5}
                inputMode="decimal"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                placeholder="5"
              />
              <span>분</span>
            </span>
            {!minutesValid && <span className={styles.hint}>0.5분에서 180분 사이로 입력해 주세요</span>}
          </label>
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <footer className={styles.footer}>
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" type="submit" disabled={!canSubmit}>
            {saving ? "저장 중…" : mode === "create" ? "등록하기" : "저장"}
          </Button>
        </footer>
      </form>
    </div>
  );
}
