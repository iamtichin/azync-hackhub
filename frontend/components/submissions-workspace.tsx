"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, ExternalLink, RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, apiErrorMessage } from "@/lib/api";
import { analysisSummary } from "@/lib/analysis";
import type { Submission, Team } from "@/lib/types";
import { MarkdownContent } from "./markdown-content";

export function SubmissionsWorkspace() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [details, setDetails] = useState<Record<string, Submission>>({});
  const loadingIds = useRef(new Set<string>());
  const failedIds = useRef(new Set<string>());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const targetId = searchParams.get("submission");
  const target = targetId ? details[targetId] : null;
  const brief = useMemo(
    () =>
      analysisSummary(
        target?.aiStatus === "COMPLETED" ? target.aiAnalysis?.output : null,
      ),
    [target],
  );
  useEffect(() => {
    api.teams
      .mine()
      .then(setTeams)
      .catch((reason) => setError(apiErrorMessage(reason)));
  }, []);
  useEffect(() => {
    if (
      !targetId ||
      details[targetId] ||
      loadingIds.current.has(targetId) ||
      failedIds.current.has(targetId)
    )
      return;
    loadingIds.current.add(targetId);
    api.submissions
      .get(targetId)
      .then((item) =>
        setDetails((current) => ({ ...current, [item.id]: item })),
      )
      .catch((reason) => {
        failedIds.current.add(targetId);
        setError(apiErrorMessage(reason));
      })
      .finally(() => loadingIds.current.delete(targetId));
  }, [targetId, details]);
  const refs = useMemo(() => {
    const memberRefs = teams.flatMap((team) =>
      (team.submissions || []).map((submission) => ({ ...submission, team })),
    );
    const target = targetId ? details[targetId] : null;
    const targetRef = target
      ? {
          id: target.id,
          projectName: target.projectName,
          status: target.status,
          team: {
            id: target.team?.id ?? target.teamId,
            name: target.team?.name ?? "Authorized team",
          },
        }
      : null;
    return targetRef && !memberRefs.some((item) => item.id === targetRef.id)
      ? [...memberRefs, targetRef]
      : memberRefs;
  }, [teams, targetId, details]);
  useEffect(() => {
    const missing = refs.filter(
      (item) =>
        !details[item.id] &&
        !loadingIds.current.has(item.id) &&
        !failedIds.current.has(item.id),
    );
    missing.forEach((item) => loadingIds.current.add(item.id));
    if (missing.length === 0) return;

    void Promise.allSettled(
      missing.map((item) => api.submissions.get(item.id)),
    ).then((results) => {
      const loaded = results.filter(
        (result): result is PromiseFulfilledResult<Submission> =>
          result.status === "fulfilled",
      );
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          failedIds.current.add(missing[index].id);
          setError(apiErrorMessage(result.reason));
        }
      });
      if (loaded.length)
        setDetails((current) =>
          Object.assign(
            {},
            current,
            ...loaded.map((result) => ({ [result.value.id]: result.value })),
          ),
        );
      missing.forEach((item) => loadingIds.current.delete(item.id));
    });
  }, [refs, details]);
  async function run(id: string, operation: () => Promise<unknown>) {
    try {
      setBusy(id);
      setError(null);
      await operation();
      const row = await api.submissions.get(id);
      setDetails((current) => ({ ...current, [id]: row }));
    } catch (reason) {
      setError(apiErrorMessage(reason));
    } finally {
      setBusy(null);
    }
  }
  return (
    <main className="page-shell ops-page">
      <header className="ops-heading">
        <div>
          <p className="eyebrow">Submission ledger</p>
          <h1>Team submissions</h1>
          <p>Track NFT proof and evidence analysis status.</p>
        </div>
        <Link className="button primary" href="/submit">
          Submit project <ArrowRight size={15} />
        </Link>
      </header>
      {error && <div className="notice danger">{error}</div>}
      <section className="ops-panel">
        <div className="submission-table">
          <div className="table-head">
            <span>Project</span>
            <span>Team</span>
            <span>Submission</span>
            <span>AI</span>
            <span>Solana</span>
            <span>Evidence</span>
            <span>Actions</span>
          </div>
          {refs.map((ref) => {
            const item = details[ref.id];
            return (
              <div key={ref.id}>
                <span>
                  <strong>{item?.projectName || ref.projectName}</strong>
                  <small className="mono">{ref.id.slice(0, 12)}</small>
                </span>
                <span>{ref.team.name}</span>
                <span
                  data-testid={`submission-status-${ref.id}`}
                  className={`status-label ${item?.status === "confirmed" ? "active" : ""}`}
                >
                  {item?.receivedStatus || item?.status || ref.status}
                </span>
                <span data-testid={`submission-ai-status-${ref.id}`}>
                  {item?.aiStatus || (item ? "NOT_QUEUED" : "loading")}
                </span>
                <span>
                  {item?.explorerUrl ? (
                    <a href={item.explorerUrl} target="_blank" rel="noreferrer">
                      Explorer <ExternalLink size={12} />
                    </a>
                  ) : (
                    "—"
                  )}
                </span>
                <span>
                  {item?.participantBlockchainEvidenceUrl ? (
                    <a
                      href={item.participantBlockchainEvidenceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Evidence <ExternalLink size={12} />
                    </a>
                  ) : (
                    "—"
                  )}
                </span>
                <span className="row-actions">
                  <button
                    className="bare-button"
                    disabled={busy === ref.id}
                    onClick={() =>
                      void run(ref.id, () =>
                        api.submissions.refreshAnalysis(ref.id),
                      )
                    }
                  >
                    <RefreshCw size={14} /> AI
                  </button>
                  {item?.status === "nft_failed" &&
                    teams.some((team) => team.id === item.teamId) && (
                      <button
                        className="bare-button"
                        disabled={busy === ref.id}
                        onClick={() =>
                          void run(ref.id, () =>
                            api.submissions.retryMint(ref.id),
                          )
                        }
                      >
                        <RotateCcw size={14} /> Mint
                      </button>
                    )}
                </span>
              </div>
            );
          })}
          {refs.length === 0 && (
            <p className="panel-empty">
              Your teams have not submitted any projects yet.
            </p>
          )}
        </div>
      </section>
      {target && (
        <section
          className="ops-panel submission-detail-card"
          aria-label="Project detail and evidence brief"
        >
          <header>
            <div>
              <p className="eyebrow">Project detail</p>
              <h2>{target.projectName}</h2>
            </div>
            <div
              className="submission-detail-statuses"
              aria-label="Submission status"
            >
              <span>{target.receivedStatus || target.status}</span>
              <span>{target.aiStatus || "NOT_QUEUED"}</span>
              <span>{target.mintStatus || "NOT_MINTED"}</span>
            </div>
          </header>
          <div className="submission-detail-body">
            <section className="submission-detail-section">
              <div className="detail-section-heading">
                <span>01</span>
                <h3>Project overview</h3>
              </div>
              <MarkdownContent content={target.description} />
              <nav
                className="submission-artifact-links"
                aria-label="Project artifacts"
              >
                <a href={target.githubUrl} target="_blank" rel="noreferrer">
                  <span>Repository</span>
                  <small>Review source and revision</small>
                  <ExternalLink size={14} />
                </a>
                <a href={target.demoUrl} target="_blank" rel="noreferrer">
                  <span>Demo</span>
                  <small>Open the submitted walkthrough</small>
                  <ExternalLink size={14} />
                </a>
              </nav>
            </section>

            <section className="submission-detail-section">
              <div className="detail-section-heading">
                <span>02</span>
                <h3>Evidence brief</h3>
              </div>
              {target.aiStatus === "COMPLETED" && target.aiAnalysis ? (
                <MarkdownContent content={brief.summary} />
              ) : (
                <p className="muted">
                  Analysis is not complete; no verified evidence brief is
                  available yet.
                </p>
              )}
              {target.aiStatus === "COMPLETED" && target.aiAnalysis && (
                <footer className="analysis-attribution">
                  <strong>AI advisory</strong>
                  <span>
                    {target.aiAnalysis.resolvedModel || "unknown model"}
                  </span>
                  <time dateTime={target.aiAnalysis.createdAt}>
                    {new Date(target.aiAnalysis.createdAt).toLocaleString()}
                  </time>
                </footer>
              )}
            </section>

            <section className="submission-detail-section">
              <div className="detail-section-heading">
                <span>03</span>
                <h3>Solana proof</h3>
              </div>
              <dl className="submission-proof-grid">
                <div>
                  <dt>Mint status</dt>
                  <dd>
                    <span
                      className={`status-label ${target.mintStatus === "CONFIRMED" ? "active" : ""}`}
                    >
                      {target.mintStatus || "No data"}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Cluster</dt>
                  <dd>
                    <code>
                      {target.solanaTransaction?.network || "No data"}
                    </code>
                  </dd>
                </div>
                <div className="proof-wide">
                  <dt>Recipient</dt>
                  <dd>
                    <code>{target.walletAddress || "No data"}</code>
                  </dd>
                </div>
                <div className="proof-wide">
                  <dt>Asset ID</dt>
                  <dd>
                    <code>{target.nftAssetId || "Unavailable"}</code>
                  </dd>
                </div>
                <div className="proof-wide">
                  <dt>Transaction signature</dt>
                  <dd>
                    <code>{target.transactionSignature || "Unavailable"}</code>
                  </dd>
                </div>
              </dl>
              {target.explorerUrl && (
                <div className="submission-proof-actions">
                  <a
                    className="button secondary"
                    href={target.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Verify on Solana Explorer <ExternalLink size={13} />
                  </a>
                </div>
              )}
            </section>
          </div>
        </section>
      )}
    </main>
  );
}
