import type { Metadata } from "next";
import { Suspense } from "react";
import { AudienceScreen } from "@/components/audience/AudienceScreen";

// Screen 3 (PRD): the current slide only, for the projector. noindex comes from /app's layout.
export const metadata: Metadata = {
  title: "청중 화면 · SlideCue",
};

export default function AudiencePage() {
  return (
    <Suspense>
      <AudienceScreen />
    </Suspense>
  );
}
