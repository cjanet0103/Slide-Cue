"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import { saveSlideScript } from "@/lib/db";
import { PencilIcon } from "@/components/ui/Icons";
import styles from "./Workspace.module.css";

type SaveState = "idle" | "saving" | "saved" | "error";

interface Props {
  projectId: string;
  index: number;
  initialText: string;
  /** Heading: the presenter's own, else the slide's PDF text; "" shows "슬라이드 N". */
  title: string;
  active: boolean;
  onFocusSlide: (index: number) => void;
  /** Save a new heading; "" restores the automatic one. */
  onRename: (index: number, title: string) => void;
}

const SAVE_DELAY_MS = 500;

/** One slide's script as a document section: number, heading, then the text. */
export const ScriptCard = forwardRef<HTMLLIElement, Props>(function ScriptCard(
  { projectId, index, initialText, title, active, onFocusSlide, onRename },
  ref,
) {
  const [text, setText] = useState(initialText);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; text: string } | null>(null);

  const save = (value: string) => {
    pending.current = null;
    setSaveState("saving");
    saveSlideScript(projectId, index, value)
      .then(() => setSaveState("saved"))
      .catch(() => setSaveState("error"));
  };

  const onChange = (value: string) => {
    setText(value);
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = { timer: setTimeout(() => save(value), SAVE_DELAY_MS), text: value };
  };

  // Flush an unsaved edit if the section unmounts (e.g. going back to the list).
  useEffect(() => {
    return () => {
      const p = pending.current;
      if (p) {
        clearTimeout(p.timer);
        saveSlideScript(projectId, index, p.text).catch(() => {});
      }
    };
  }, [projectId, index]);

  const slideNo = index + 1;
  const [editingTitle, setEditingTitle] = useState(false);
  // Enter/Escape end editing; the blur that follows must not save again.
  const titleDone = useRef(false);

  const startTitle = () => {
    titleDone.current = false;
    setEditingTitle(true);
  };

  const finishTitle = (value: string) => {
    if (titleDone.current) return;
    titleDone.current = true;
    setEditingTitle(false);
    if (value.trim() !== title) onRename(index, value);
  };

  return (
    <li ref={ref} className={`${styles.section} ${active ? styles.sectionActive : ""}`}>
      <span className={styles.sectionNo} aria-hidden="true">
        {String(slideNo).padStart(2, "0")}
      </span>
      <div className={styles.sectionBody}>
        <div className={styles.sectionHead}>
          {editingTitle ? (
            // Pencil appears only while editing; Enter or clicking elsewhere saves and hides it.
            <div className={styles.titleRow}>
              <input
                className={styles.sectionTitleInput}
                defaultValue={title}
                placeholder={`슬라이드 ${slideNo}`}
                autoFocus
                aria-label={`${slideNo}번 슬라이드 제목`}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={(e) => finishTitle(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") finishTitle(e.currentTarget.value);
                  if (e.key === "Escape") {
                    titleDone.current = true;
                    setEditingTitle(false);
                  }
                }}
              />
              <PencilIcon width={16} height={16} className={styles.editingPencil} />
            </div>
          ) : (
            <button
              type="button"
              className={styles.sectionTitle}
              onClick={() => onFocusSlide(index)}
              onDoubleClick={startTitle}
              title="두 번 클릭하면 제목을 바꿀 수 있어요"
            >
              {title || `슬라이드 ${slideNo}`}
            </button>
          )}
          <span className={styles.saveState} aria-live="polite">
            {saveState === "saving" && "저장 중…"}
            {saveState === "saved" && "저장됨"}
            {saveState === "error" && <span className={styles.saveError}>저장하지 못했어요</span>}
          </span>
        </div>
        <label className="visually-hidden" htmlFor={`script-${index}`}>
          {slideNo}번 슬라이드 대본
        </label>
        <textarea
          id={`script-${index}`}
          className={styles.textarea}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => onFocusSlide(index)}
          placeholder="대본을 붙여 넣으세요"
          rows={2}
        />
      </div>
    </li>
  );
});
