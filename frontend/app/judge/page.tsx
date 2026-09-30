import { Suspense } from "react";
import { JudgeWorkspace } from "@/components/judge-workspace";

export default function JudgePage() {
  return (
    <Suspense
      fallback={
        <main className="workspace-loading">Opening the judge workspace…</main>
      }
    >
      <JudgeWorkspace />
    </Suspense>
  );
}
