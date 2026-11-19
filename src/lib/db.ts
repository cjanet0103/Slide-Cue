import Dexie, { type EntityTable } from "dexie";

/**
 * All presentation data lives only in this browser (PRD §4.5).
 * Schema changes: add a new db.version(n) block; never edit an existing one.
 */

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  pageCount: number;
  currentScriptVersionId: string;
  /** First-page preview as a JPEG data URL (not indexed). */
  thumbnail?: string;
  /** Slide headings the presenter typed; empty/missing = use the PDF's own text. */
  slideTitles?: string[];
}

export interface PdfFile {
  projectId: string;
  blob: Blob;
}

export interface ScriptVersion {
  id: string;
  projectId: string;
  createdAt: number;
  /** Set once a run has used this version; later edits create a new version. */
  locked: boolean;
  /** Raw script text per slide, index 0 = page 1. */
  slides: string[];
}

class SlideCueDB extends Dexie {
  projects!: EntityTable<Project, "id">;
  pdfs!: EntityTable<PdfFile, "projectId">;
  scriptVersions!: EntityTable<ScriptVersion, "id">;

  constructor() {
    super("slidecue");
    this.version(1).stores({
      projects: "id, updatedAt",
      pdfs: "projectId",
      scriptVersions: "id, projectId",
    });
  }
}

export const db = new SlideCueDB();

export function newId(): string {
  return crypto.randomUUID();
}

export async function createProject(
  name: string,
  pdf: Blob,
  pageCount: number,
  thumbnail?: string,
): Promise<Project> {
  const now = Date.now();
  const version: ScriptVersion = {
    id: newId(),
    projectId: "",
    createdAt: now,
    locked: false,
    slides: Array.from({ length: pageCount }, () => ""),
  };
  const project: Project = {
    id: newId(),
    name,
    createdAt: now,
    updatedAt: now,
    pageCount,
    currentScriptVersionId: version.id,
    thumbnail,
  };
  version.projectId = project.id;
  await db.transaction("rw", db.projects, db.pdfs, db.scriptVersions, async () => {
    await db.projects.add(project);
    await db.pdfs.add({ projectId: project.id, blob: pdf });
    await db.scriptVersions.add(version);
  });
  return project;
}

/**
 * Saves one slide's script into the project's current version.
 * If that version is locked (already used by a run), copies it into a new
 * version first so past runs keep the script they used (PRD §4.1).
 */
export function saveSlideScript(projectId: string, slideIndex: number, text: string): Promise<void> {
  return updateScripts(projectId, (slides) => {
    slides[slideIndex] = text;
  });
}

/** Saves a presenter-chosen heading for one slide; "" goes back to the automatic one. */
export async function saveSlideTitle(projectId: string, slideIndex: number, title: string): Promise<void> {
  await db.transaction("rw", db.projects, async () => {
    const project = await db.projects.get(projectId);
    if (!project) throw new Error("project not found");
    const titles = Array.from({ length: project.pageCount }, (_, i) => project.slideTitles?.[i] ?? "");
    titles[slideIndex] = title.trim();
    await db.projects.update(projectId, { slideTitles: titles });
  });
}

/** Replaces every slide's script at once (used by "paste the whole script"). */
export function saveAllSlideScripts(projectId: string, texts: string[]): Promise<void> {
  return updateScripts(projectId, (slides) => {
    texts.forEach((t, i) => {
      if (i < slides.length) slides[i] = t;
    });
  });
}

async function updateScripts(projectId: string, edit: (slides: string[]) => void): Promise<void> {
  await db.transaction("rw", db.projects, db.scriptVersions, async () => {
    const project = await db.projects.get(projectId);
    if (!project) throw new Error("project not found");
    const current = await db.scriptVersions.get(project.currentScriptVersionId);
    if (!current) throw new Error("script version not found");

    const slides = [...current.slides];
    edit(slides);
    const now = Date.now();

    if (current.locked) {
      const next: ScriptVersion = { id: newId(), projectId, createdAt: now, locked: false, slides };
      await db.scriptVersions.add(next);
      await db.projects.update(projectId, { currentScriptVersionId: next.id, updatedAt: now });
    } else {
      await db.scriptVersions.update(current.id, { slides });
      await db.projects.update(projectId, { updatedAt: now });
    }
  });
}
