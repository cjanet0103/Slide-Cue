import type { Metadata } from "next";
import { Suspense } from "react";
import { PresenterApp } from "@/components/present/PresenterApp";

export const metadata: Metadata = {
  title: "발표자 화면 · SlideCue",
  robots: { index: false, follow: false },
};

export default function PresentPage() {
  return (
    <Suspense>
      <PresenterApp />
    </Suspense>
  );
}
