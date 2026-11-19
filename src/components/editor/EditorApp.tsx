"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { createProject, db } from "@/lib/db";
import { FileIcon, FolderIcon, PlusIcon, SidebarIcon } from "@/components/ui/Icons";
import { Library } from "./Library";
import { Workspace } from "./Workspace";
import { ProjectInfoDialog } from "./ProjectInfoDialog";
import styles from "./Shell.module.css";

export function EditorApp() {
  const router = useRouter();
  const params = useSearchParams();
  const [creating, setCreating] = useState(false);
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

  const openPicker = () => setCreating(true);

  return (
    <div className={`${styles.shell} ${collapsed ? styles.collapsed : ""}`}>
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
          <button type="button" className={styles.navItem} onClick={openPicker} title="새 발표">
            <PlusIcon />
            <span className={styles.label}>새 발표</span>
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
        {projects === undefined ? null : openId ? (
          <Workspace key={openId} projectId={openId} initialRunId={params.get("run")} onBack={goLibrary} />
        ) : (
          <Library projects={projects} onNew={openPicker} onOpen={openProject} />
        )}
      </main>

      {creating && (
        <ProjectInfoDialog
          mode="create"
          onClose={() => setCreating(false)}
          onSubmit={async (info, pdf) => {
            if (!pdf) return;
            const project = await createProject(info, pdf.file, pdf.pageCount, pdf.thumbnail);
            setCreating(false);
            openProject(project.id);
          }}
        />
      )}
    </div>
  );
}
