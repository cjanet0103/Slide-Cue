"use client";

import { useEffect, useState } from "react";
import { getPageTitles, type PDFDocumentProxy } from "@/lib/pdf";

/**
 * Heading for each slide: the presenter's own title if set, else the first
 * line of text on the slide, else "" (callers show "슬라이드 N").
 */
export function useSlideTitles(doc: PDFDocumentProxy | null, custom: string[] | undefined): string[] {
  const [fromPdf, setFromPdf] = useState<string[]>([]);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    getPageTitles(doc)
      .then((t) => {
        if (!cancelled) setFromPdf(t);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [doc]);

  const count = Math.max(fromPdf.length, custom?.length ?? 0);
  return Array.from({ length: count }, (_, i) => custom?.[i] || fromPdf[i] || "");
}

export const slideLabel = (titles: string[], index: number) => titles[index] || `슬라이드 ${index + 1}`;
