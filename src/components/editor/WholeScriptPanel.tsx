"use client";

import { useState } from "react";
import { saveAllSlideScripts } from "@/lib/db";
import { getPageTexts, type PDFDocumentProxy } from "@/lib/pdf";
import { composeWholeScript, splitWholeScript, type SplitMethod } from "@/lib/scriptAlign";
import { Button } from "@/components/ui/Button";
import styles from "./WholeScriptPanel.module.css";

const PLACEHOLDER = [
  "대본 전체를 붙여 넣으세요.",
  "",
  "슬라이드 구분은 번호([1], 1번)나 / 로 표시할 수 있어요.",
  "구분이 없으면 슬라이드 글자와 대조해 자동으로 나눠 드려요.",
].join("\n");

const METHOD_TEXT: Record<SplitMethod, string> = {
  markers: "대본에 적힌 슬라이드 번호대로 나눴어요.",
  separator: "/ 로 구분한 대로 나눴어요.",
  match: "문단마다 슬라이드에 적힌 글자와 비교해 가장 비슷한 장에 넣었어요. 순서는 그대로예요.",
  order: "슬라이드에서 글자를 찾지 못해 문단을 순서대로 고르게 나눴어요.",
};

interface Props {
  projectId: string;
  doc: PDFDocumentProxy | null;
  slides: string[];
  /** Unapplied edit kept while switching tabs; null = show the saved script. */
  draft: string | null;
  onDraftChange: (text: string | null) => void;
  onApplied: (slides: string[]) => void;
}

export function WholeScriptPanel({ projectId, doc, slides, draft, onDraftChange, onApplied }: Props) {
  const saved = composeWholeScript(slides);
  const text = draft ?? saved;
  const dirty = draft !== null && draft !== saved;
  const [preview, setPreview] = useState<{ slides: string[]; method: SplitMethod } | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const split = async () => {
    setWorking(true);
    setError(null);
    try {
      const pageTexts = doc ? await getPageTexts(doc) : slides.map(() => "");
      setPreview(splitWholeScript(text, pageTexts.slice(0, slides.length)));
    } finally {
      setWorking(false);
    }
  };

  const apply = async () => {
    if (!preview) return;
    setWorking(true);
    setError(null);
    try {
      await saveAllSlideScripts(projectId, preview.slides);
      onApplied(preview.slides);
    } catch {
      setError("저장하지 못했어요. 브라우저 저장 공간을 확인한 뒤 다시 시도해 주세요. 기존 대본은 그대로예요.");
      setWorking(false);
    }
  };

  const editSlide = (i: number, value: string) =>
    setPreview((p) => (p ? { ...p, slides: p.slides.map((s, j) => (j === i ? value : s)) } : p));

  if (preview) {
    return (
      <div className={styles.panel}>
        <div className={styles.body}>
          <p className={styles.method}>{METHOD_TEXT[preview.method]} 적용 전에 장마다 고칠 수 있어요.</p>
          <p className={styles.warn}>적용하면 슬라이드별 대본이 아래 내용으로 바뀌어요.</p>
          <ol className={styles.previewList}>
            {preview.slides.map((s, i) => (
              <li key={i} className={styles.previewItem}>
                <span className={styles.previewNo}>{i + 1}</span>
                <textarea
                  className={styles.previewInput}
                  value={s}
                  onChange={(e) => editSlide(i, e.target.value)}
                  placeholder="연결된 대본 없음"
                  aria-label={`${i + 1}번 슬라이드 대본`}
                  rows={Math.min(8, Math.max(2, s.split("\n").length + 1))}
                />
              </li>
            ))}
          </ol>
        </div>
        {error && <p className={styles.error}>{error}</p>}
        <footer className={styles.footer}>
          <Button variant="ghost" onClick={() => setPreview(null)} disabled={working}>
            다시 편집
          </Button>
          <Button variant="primary" onClick={apply} disabled={working}>
            {working ? "적용 중…" : "대본에 적용"}
          </Button>
        </footer>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.body}>
        <textarea
          className={styles.rawInput}
          value={text}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder={PLACEHOLDER}
          aria-label="전체 대본"
        />
      </div>
      <footer className={styles.footer}>
        <span className={styles.status}>{dirty ? "아직 적용하지 않았어요" : ""}</span>
        {dirty && (
          <Button variant="ghost" onClick={() => onDraftChange(null)} disabled={working}>
            되돌리기
          </Button>
        )}
        <Button variant="primary" onClick={split} disabled={!dirty || !text.trim() || working}>
          {working ? "나누는 중…" : "슬라이드에 나누기"}
        </Button>
      </footer>
    </div>
  );
}
