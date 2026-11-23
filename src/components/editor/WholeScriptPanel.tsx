"use client";

import { useState } from "react";
import { saveAllSlideScripts } from "@/lib/db";
import { getPageTexts, type PDFDocumentProxy } from "@/lib/pdf";
import { splitWholeScript, type SplitMethod } from "@/lib/scriptAlign";
import { Button } from "@/components/ui/Button";
import styles from "./WholeScriptPanel.module.css";

const PLACEHOLDER = [
  "대본 전체를 붙여 넣으세요. 붙여 넣으면 바로 슬라이드별로 나눠요.",
  "",
  "슬라이드 구분은 번호([1], 1번)나 / 로 표시할 수 있어요.",
  "구분이 없으면 슬라이드 글자와 대조해 자동으로 나눠 드려요.",
].join("\n");

interface Props {
  projectId: string;
  doc: PDFDocumentProxy | null;
  /** The current per-slide script (to restore if the split is undone). */
  slides: string[];
  /** Text in the paste box, kept while switching views; null = empty. */
  draft: string | null;
  onDraftChange: (text: string | null) => void;
  /** Split and saved: `previous` is the script before, for 되돌리기. */
  onSplit: (result: { previous: string[]; slides: string[]; method: SplitMethod }) => void;
}

/**
 * 전체 붙여넣기: one box for the whole talk. Pasting into the empty box splits it
 * at once (typed text uses 슬라이드별로 나누기); the split is saved on this device
 * and the view switches back to the slides (with undo).
 */
export function WholeScriptPanel({ projectId, doc, slides, draft, onDraftChange, onSplit }: Props) {
  const text = draft ?? "";
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const split = async (source: string = text) => {
    setWorking(true);
    setError(null);
    try {
      const pageTexts = doc ? await getPageTexts(doc) : slides.map(() => "");
      const result = splitWholeScript(source, pageTexts.slice(0, slides.length));
      await saveAllSlideScripts(projectId, result.slides);
      onSplit({ previous: slides, slides: result.slides, method: result.method });
    } catch {
      setError("저장하지 못했어요. 브라우저 저장 공간을 확인한 뒤 다시 시도해 주세요. 기존 대본은 그대로예요.");
      setWorking(false);
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.body}>
        <textarea
          className={styles.rawInput}
          value={text}
          onChange={(e) => onDraftChange(e.target.value || null)}
          onPaste={(e) => {
            // Pasting the script into the empty box splits it right away.
            const pasted = e.clipboardData.getData("text");
            if (text.trim() || !pasted.trim() || working) return;
            e.preventDefault();
            onDraftChange(pasted);
            void split(pasted);
          }}
          placeholder={PLACEHOLDER}
          aria-label="전체 대본"
          autoFocus
        />
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <footer className={styles.footer}>
        <Button variant="primary" onClick={() => split()} disabled={!text.trim() || working}>
          {working ? "나누는 중…" : "슬라이드별로 나누기"}
        </Button>
      </footer>
    </div>
  );
}
