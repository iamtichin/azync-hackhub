import { Suspense } from "react";
import { SubmissionSuccess } from "@/components/submission-success";

export default function SubmissionSuccessPage() {
  return (
    <Suspense
      fallback={
        <main className="workspace-loading">Loading submission proof…</main>
      }
    >
      <SubmissionSuccess />
    </Suspense>
  );
}
