import type { PDFDocumentProxy } from "pdfjs-dist";

export type { PDFDocumentProxy };

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;

/** Loads PDF.js only when an app screen needs it (PRD §4.5). */
function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

/** Opens a PDF from a Blob. The bytes stay in the browser. */
export async function openPdf(blob: Blob): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await blob.arrayBuffer());
  return pdfjs.getDocument({ data }).promise;
}

/** Renders page 1 to a small JPEG data URL for list cards. */
export async function renderThumbnail(doc: PDFDocumentProxy, width = 480): Promise<string | undefined> {
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    // "print" intent renders without waiting for animation frames, so covers
    // are made even when the tab is in the background.
    await page.render({ canvas, viewport, intent: "print" }).promise;
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return undefined;
  }
}

/**
 * Renders one page (1-based) into a canvas, sized to cssWidth.
 * Fits the page inside the box (CSS pixels). Draws offscreen first, then copies,
 * so the previous slide stays visible until the next one is ready.
 * Returns false if aborted.
 */
export async function renderPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  box: { width: number; height: number },
  signal?: AbortSignal,
): Promise<boolean> {
  const page = await doc.getPage(pageNumber);
  if (signal?.aborted) return false;
  const base = page.getViewport({ scale: 1 });
  const cssScale = Math.min(box.width / base.width, box.height / base.height);
  const dpr = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: cssScale * dpr });

  const offscreen = document.createElement("canvas");
  offscreen.width = Math.floor(viewport.width);
  offscreen.height = Math.floor(viewport.height);
  const task = page.render({ canvas: offscreen, viewport });
  const onAbort = () => task.cancel();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    await task.promise;
  } catch (err) {
    if ((err as { name?: string })?.name === "RenderingCancelledException") return false;
    throw err;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  if (signal?.aborted) return false;

  canvas.width = offscreen.width;
  canvas.height = offscreen.height;
  canvas.style.width = `${Math.floor(base.width * cssScale)}px`;
  canvas.style.height = `${Math.floor(base.height * cssScale)}px`;
  canvas.getContext("2d")?.drawImage(offscreen, 0, 0);
  return true;
}

/**
 * A short heading per page: the first line of text on the slide (usually its title).
 * Empty string when the page has no usable text (e.g. an image-only slide).
 */
export async function getPageTitles(doc: PDFDocumentProxy, maxLength = 40): Promise<string[]> {
  const titles: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    try {
      const content = await (await doc.getPage(n)).getTextContent();
      const first = content.items
        .map((item) => ("str" in item ? item.str.trim() : ""))
        .find((s) => s.length >= 2);
      titles.push(first && first.length <= maxLength ? first : "");
    } catch {
      titles.push("");
    }
  }
  return titles;
}

/** Plain text of every page, used to match a pasted script to slides. */
export async function getPageTexts(doc: PDFDocumentProxy): Promise<string[]> {
  const texts: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    try {
      const content = await (await doc.getPage(n)).getTextContent();
      texts.push(
        content.items.map((item) => ("str" in item ? item.str : "")).join(" "),
      );
    } catch {
      texts.push("");
    }
  }
  return texts;
}
