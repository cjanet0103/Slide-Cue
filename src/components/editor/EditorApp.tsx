"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { createProject, db } from "@/lib/db";
import { openPdf, renderThumbnail } from "@/lib/pdf";
import { FileIcon, FolderIcon, PlusIcon, SidebarIcon } from "@/components/ui/Icons";
import { Library } from "./Library";
import { Workspace } from "./Workspace";
import styles from "./Shell.module.css";

export function EditorApp() {
  const router = useRouter();
  const params = useSearchParams();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [collapsedByUser, setCollapsedByUser] = useState<boolean | null>(null);

  const projects = useLiveQuery(() => db.projects.orderBy("updatedAt").reverse().toArray(), []);
  const requested = params.get("project");
  const openId = projects && requested && projects.some((p) => p.id === requested) ? requested : null;

  // The workspace needs room for slides + scripts, so the menu folds to icons there by default.
  const collapsed = collapsedByUser ?? openId !== null;

  const openProject = (id: string) => {
    setCollapsedByUser(null);
    router.push(`/app?project=${id}`);
  };
  const goLibrary = () => {
    setCollapsedByUser(null);
    router.push("/app");
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    setBusy(true);
    try {
      const doc = await openPdf(file);
      const pageCount = doc.numPages;
      const thumbnail = pageCount > 0 ? await renderThumbnail(doc) : undefined;
      await doc.destroy();
      if (pageCount < 1) throw new Error("empty pdf");
      const name = file.name.replace(/\.pdf$/i, "") || "새 발표";
      const project = await createProject(name, file, pageCount, thumbnail);
      openProject(project.id);
    } catch {
      setUploadError("PDF를 열 수 없어요. 한 장 이상인 PDF 파일을 다시 선택해 주세요.");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const openPicker = () => fileInput.current?.click();

  return (
    <div className={`${styles.shell} ${collapsed ? styles.collapsed : ""}`}>
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        className="visually-hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
        aria-label="발표 PDF 선택"
      />

      <aside className={styles.sidebar} aria-label="메뉴">
        <div className={styles.sidebarTop}>
          {!collapsed && (
            <Link href="/" className={styles.brand}>
              SlideCue
            </Link>
          )}
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => setCollapsedByUser(!collapsed)}
            aria-label={collapsed ? "메뉴 펼치기" : "메뉴 접기"}
            title={collapsed ? "메뉴 펼치기" : "메뉴 접기"}
          >
            <SidebarIcon />
          </button>
        </div>

        <nav className={styles.nav}>
          <button type="button" className={styles.navItem} onClick={openPicker} disabled={busy} title="새 발표">
            <PlusIcon />
            <span className={styles.label}>{busy ? "PDF 여는 중…" : "새 발표"}</span>
          </button>
          <button
            type="button"
            className={`${styles.navItem} ${openId === null ? styles.navItemActive : ""}`}
            onClick={goLibrary}
            title="내 발표"
          >
            <FolderIcon />
            <span className={styles.label}>내 발표</span>
          </button>
        </nav>

        {!collapsed && projects && projects.length > 0 && (
          <>
            <h2 className={styles.eyebrow}>발표</h2>
            <ul className={styles.fileList}>
              {projects.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`${styles.navItem} ${p.id === openId ? styles.navItemActive : ""}`}
                    onClick={() => openProject(p.id)}
                    aria-current={p.id === openId ? "page" : undefined}
                  >
                    <FileIcon />
                    <span className={styles.label}>{p.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>

      <main className={styles.content}>
        {uploadError && (
          <p className={styles.errorBar} role="alert">
            {uploadError}
          </p>
        )}
        {projects === undefined ? null : openId ? (
          <Workspace key={openId} projectId={openId} onBack={goLibrary} />
        ) : (
          <Library projects={projects} busy={busy} onNew={openPicker} onOpen={openProject} />
        )}
      </main>
    </div>
  );
}
