"use client";

import { useEffect, useSyncExternalStore } from "react";
import { db, type Project } from "@/lib/db";
import { openPdf, renderThumbnail } from "@/lib/pdf";
import { Button } from "@/components/ui/Button";
import { FileIcon, PlusIcon } from "@/components/ui/Icons";
import styles from "./Library.module.css";

const NOTICE_KEY = "slidecue.storageNoticeDismissed";
const listeners = new Set<() => void>();

function readDismissed(): boolean {
  try {
    return localStorage.getItem(NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function dismiss() {
  try {
    localStorage.setItem(NOTICE_KEY, "1");
  } catch {
    // Storage blocked: the notice shows again next time.
  }
  listeners.forEach((cb) => cb());
}

const dateFmt = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
const formatDate = (t: number) => dateFmt.format(t).replace(/\.\s?/g, "-").replace(/-$/, "");

/**
 * Project cover = the PDF's first slide. Projects saved without one (older
 * uploads, or a failed render) get it generated once from the stored PDF.
 */
function Cover({ project }: { project: Project }) {
  const { id, thumbnail } = project;

  useEffect(() => {
    if (thumbnail) return;
    let cancelled = false;
    (async () => {
      const file = await db.pdfs.get(id);
      if (!file || cancelled) return;
      const doc = await openPdf(file.blob);
      try {
        const cover = await renderThumbnail(doc);
        if (cover && !cancelled) await db.projects.update(id, { thumbnail: cover });
      } finally {
        await doc.destroy();
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id, thumbnail]);

  return (
    <span className={styles.cover}>
      {thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element -- local data URL, not optimizable
        <img src={thumbnail} alt="" />
      ) : (
        <FileIcon width={32} height={32} />
      )}
    </span>
  );
}

interface Props {
  projects: Project[];
  busy: boolean;
  onNew: () => void;
  onOpen: (id: string) => void;
}

export function Library({ projects, busy, onNew, onOpen }: Props) {
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => true);

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <h1 className={styles.heading}>내 발표</h1>
      </header>

      <div className={styles.body}>
        {projects.length > 0 && !dismissed && (
          <div className={styles.notice} role="note">
            <p>
              발표 자료와 대본은 <strong>이 브라우저에만</strong> 저장돼요. 같은 브라우저에서 다시 열 수 있고,
              브라우저의 사이트 데이터를 지우면 함께 사라질 수 있어요.
            </p>
            <Button variant="ghost" onClick={dismiss}>
              확인
            </Button>
          </div>
        )}

        <ul className={styles.grid}>
          <li>
            <button type="button" className={styles.newCard} onClick={onNew} disabled={busy}>
              <PlusIcon width={28} height={28} />
              <span>{busy ? "PDF 여는 중…" : "새로 만들기"}</span>
            </button>
          </li>
          {projects.map((p) => (
            <li key={p.id}>
              <button type="button" className={styles.card} onClick={() => onOpen(p.id)}>
                <Cover project={p} />
                <span className={styles.cardName}>{p.name}</span>
                <span className={styles.cardMeta}>
                  <span className={styles.badge}>PDF</span> {p.pageCount}장 · {formatDate(p.updatedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {projects.length === 0 && (
          <p className={styles.hint}>
            발표 PDF를 올리고 장마다 대본을 붙여 넣어 시작하세요. PowerPoint 자료는 PDF로 내보내 가져오세요.
          </p>
        )}
      </div>
    </div>
  );
}
