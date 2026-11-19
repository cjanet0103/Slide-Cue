"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/db";
import { openPdf, type PDFDocumentProxy } from "@/lib/pdf";

type State = { doc: PDFDocumentProxy | null; error: boolean };

/** Opens the stored PDF for a project. Remount (key by projectId) to switch projects. */
export function usePdfDocument(projectId: string): State {
  const [state, setState] = useState<State>({ doc: null, error: false });

  useEffect(() => {
    let cancelled = false;
    let opened: PDFDocumentProxy | null = null;
    db.pdfs
      .get(projectId)
      .then((file) => {
        if (!file) throw new Error("pdf missing");
        return openPdf(file.blob);
      })
      .then((doc) => {
        opened = doc;
        if (cancelled) doc.destroy();
        else setState({ doc, error: false });
      })
      .catch(() => {
        if (!cancelled) setState({ doc: null, error: true });
      });
    return () => {
      cancelled = true;
      opened?.destroy();
    };
  }, [projectId]);

  return state;
}
