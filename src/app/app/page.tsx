import { Suspense } from "react";
import { EditorApp } from "@/components/editor/EditorApp";

export default function AppPage() {
  return (
    <Suspense>
      <EditorApp />
    </Suspense>
  );
}
