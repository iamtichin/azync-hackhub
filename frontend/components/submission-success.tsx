"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Copy,
  FileCheck2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, apiErrorMessage } from "@/lib/api";
import type { Submission } from "@/lib/types";
import { useAuth } from "./auth-provider";

const POLL_INTERVAL_MS = 5000;
const MAX_POLLS = 12;

function mintIsSettled(item: Submission) {
  return (
    item.mintStatus === "FAILED" ||
    item.status === "nft_failed" ||
    (item.mintStatus === "CONFIRMED" &&
      Boolean(item.transactionSignature && item.nftAssetId))
  );
}

export function SubmissionSuccess() {
  const id = useSearchParams().get("id");
  const auth = useAuth();
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pollingEnded, setPollingEnded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const scopeRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    const scope = `${auth.sessionVersion}:${auth.user?.id ?? "anonymous"}:${id ?? ""}`;
    const sameScope = scopeRef.current === scope;
    scopeRef.current = scope;
    if (!sameScope) setSubmission(null);
    setError(null);
    setPollingEnded(false);
    setLoading(Boolean(id && auth.user) && (!sameScope || !submission));
    setRefreshing(Boolean(id && auth.user) && sameScope && Boolean(submission));
    if (!id || !auth.user) {
      return;
    }
    const load = async () => {
      try {
        const next = await api.submissions.get(id);
        if (cancelled) return;
        setSubmission(next);
        setError(null);
        if (!mintIsSettled(next)) {
          if (polls < MAX_POLLS) {
            polls += 1;
            timer = setTimeout(() => void load(), POLL_INTERVAL_MS);
          } else setPollingEnded(true);
        }
      } catch (reason) {
        if (!cancelled) setError(apiErrorMessage(reason));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id, auth.user, auth.sessionVersion, refreshKey]);

  async function copySignature() {
    if (!submission?.transactionSignature) return;
    await navigator.clipboard.writeText(submission.transactionSignature);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  if (loading || auth.loading)
    return (
      <main className="workspace-loading">Verifying submission proof…</main>
    );
  if (!auth.user)
    return (
      <main className="centered-state">
        <strong>Sign-in required</strong>
        <p>Sign in to view this submission proof.</p>
        <Link className="button secondary" href="/submit">
          Go back
        </Link>
      </main>
    );
  if (!submission)
    return (
      <main className="centered-state">
        <strong>Could not read the submission</strong>
        <p>{error || "Missing submission ID."}</p>
        <button
          className="button secondary"
          type="button"
          onClick={() => setRefreshKey((value) => value + 1)}
        >
          Reload
        </button>
      </main>
    );

  const confirmed =
    submission.mintStatus === "CONFIRMED" &&
    Boolean(submission.transactionSignature && submission.nftAssetId);
  const cluster = submission.solanaTransaction?.network;
  const mintMessage = confirmed
    ? "The backend reports a confirmed mint. Verify the transaction and asset on Explorer."
    : submission.mintStatus === "FAILED"
      ? "The mint has not succeeded. The submission is still recorded."
      : submission.mintStatus === "RECONCILIATION_REQUIRED" ||
          submission.status === "mint_pending_reconciliation"
        ? "The transaction outcome is unknown. The backend is reconciling it and will not send another mint yet."
        : "The submission is recorded. Its credential is waiting to be minted or confirmed.";

  return (
    <main className="proof-page">
      <section className="proof-heading">
        <div className="proof-check">
          <Check size={24} />
        </div>
        <p className="eyebrow">Submission recorded</p>
        <h1>{submission.projectName}</h1>
        <p>{mintMessage}</p>
      </section>
      <section className="proof-ledger">
        <header>
          <FileCheck2 size={20} />
          <div>
            <span>Submission ID</span>
            <code>{submission.id}</code>
          </div>
          <span className={`status-label ${confirmed ? "active" : ""}`}>
            {submission.mintStatus || "PENDING"}
          </span>
        </header>
        <dl>
          <div>
            <dt>Transaction signature</dt>
            <dd>
              <code>
                {submission.transactionSignature || "Waiting for mint"}
              </code>
              {submission.transactionSignature && (
                <button
                  className="icon-button"
                  onClick={copySignature}
                  title="Copy signature"
                  aria-label="Copy transaction signature"
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              )}
            </dd>
          </div>
          <div>
            <dt>Compressed NFT asset ID (not transaction signature)</dt>
            <dd>
              <code>{submission.nftAssetId || "Waiting for confirmation"}</code>
            </dd>
          </div>
          <div>
            <dt>Saved recipient</dt>
            <dd>
              <code>{submission.walletAddress || "No data"}</code>
            </dd>
          </div>
          <div>
            <dt>Cluster</dt>
            <dd>
              <code>{cluster || "No proof data"}</code>
            </dd>
          </div>
        </dl>
        {error && (
          <p className="notice danger" role="alert">
            Could not update the proof: {error}
          </p>
        )}
        {refreshing && (
          <p className="panel-note" role="status">
            Loading the latest proof status…
          </p>
        )}
        {pollingEnded && !mintIsSettled(submission) && (
          <p className="notice warning" role="status">
            Automatic updates have paused. Reload to check the mint.
          </p>
        )}
        <footer>
          {submission.explorerUrl && submission.transactionSignature ? (
            <a
              className="button secondary"
              href={submission.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              View transaction on Explorer <ArrowUpRight size={15} />
            </a>
          ) : (
            <span className="muted">
              The transaction link appears after the backend records a
              signature.
            </span>
          )}
          <button
            className="button secondary"
            type="button"
            disabled={refreshing}
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            Reload proof
          </button>
          <Link
            className="button primary"
            href={`/submissions?submission=${submission.id}`}
          >
            View evidence brief <ArrowRight size={16} />
          </Link>
        </footer>
      </section>
    </main>
  );
}
