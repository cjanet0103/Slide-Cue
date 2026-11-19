import type { Metadata } from "next";

// Personal workspace: excluded from search via noindex (PRD §4.5), not via robots.txt.
export const metadata: Metadata = {
  title: "내 발표 · SlideCue",
  robots: { index: false, follow: false },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return children;
}
