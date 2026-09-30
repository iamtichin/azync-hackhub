"use client";

import axios from "axios";
import { useEffect, useState } from "react";
import { API_URL, apiErrorMessage } from "@/lib/api";

type Result = {
  draftRevision: string;
  fingerprint: string;
  staleWarning: string;
  checks: Array<{
    code: string;
    status: "PASS" | "FAIL" | "UNCERTAIN";
    summary: string;
    evidence: string[];
  }>;
  advisory: {
    kind: "AI_ADVISORY";
    status: string;
    message: string;
    evidence: string[];
  };
  rateLimit: { retryAfterSeconds: number };
};
type ScopedResult = Result & { teamId: string; hackathonId: string };

export function SubmissionDraftValidator({
  teamId,
  hackathonId,
  draftRevision,
  stale,
}: {
  teamId: string;
  hackathonId: string;
  draftRevision: string | null;
  stale: boolean;
}) {
  const [result, setResult] = useState<ScopedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function validate() {
    if (!draftRevision) return;
    try {
      setBusy(true);
      setError(null);
      const token = window.sessionStorage.getItem("azync.access_token");
      const response = await axios.post<Result>(
        `${API_URL}/submission-validation/draft`,
        { teamId, hackathonId, draftRevision },
        { headers: token ? { Authorization: `Bearer ${token}` } : undefined },
      );
      setResult({ ...response.data, teamId, hackathonId });
    } catch (reason) {
      setError(apiErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    setResult(null);
    setError(null);
  }, [teamId, hackathonId, draftRevision]);
  const currentResult =
    result?.teamId === teamId &&
    result.hackathonId === hackathonId &&
    result.draftRevision === draftRevision
      ? result
      : null;
  const resultIsStale = stale || Boolean(result && !currentResult);
  return (
    <section className="notice" aria-label="Draft validator">
      <strong>Pre-submit validator</strong>
      <p>
        Mandatory local checks are evidence-based. AI advisory is separate and
        never decides a final submission.
      </p>
      {!draftRevision ? (
        <p>
          Save this draft to validate its exact revision. No wallet is required.
        </p>
      ) : (
        <>
          {resultIsStale && (
            <p role="status">
              Draft changed since validation. Save and rerun validation for the
              current revision.
            </p>
          )}
          <button
            type="button"
            className="button secondary"
            disabled={busy || stale}
            onClick={() => void validate()}
          >
            {busy ? "Validating…" : "Validate saved draft"}
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {currentResult && (
        <div>
          <p>
            <code>{currentResult.fingerprint.slice(0, 12)}</code> · rerun limit{" "}
            {currentResult.rateLimit.retryAfterSeconds}s
          </p>
          <ul>
            {currentResult.checks.map((check) => (
              <li key={check.code}>
                <strong>{check.status}</strong> {check.summary}
                <small> {check.evidence.join(" ")}</small>
              </li>
            ))}
          </ul>
          <p>
            <strong>AI advisory ({currentResult.advisory.status})</strong>:{" "}
            {currentResult.advisory.message}
          </p>
        </div>
      )}
    </section>
  );
}
