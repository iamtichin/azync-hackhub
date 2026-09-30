"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleAlert,
  FileSearch,
  GitBranch,
  History,
  MessageSquareText,
  Plus,
  RefreshCw,
  Send,
} from "lucide-react";
import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "./auth-provider";
import { MarkdownContent } from "./markdown-content";
import { analysisSummary, asRecord } from "@/lib/analysis";
import { api, apiErrorMessage } from "@/lib/api";
import type {
  AiAnalysisStatus,
  ChatMessage,
  ChatSession,
  GhostSuggestions,
  Hackathon,
  Submission,
} from "@/lib/types";

function formatTime(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function concernText(value: unknown) {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  return typeof record.description === "string"
    ? record.description
    : typeof record.title === "string"
      ? record.title
      : JSON.stringify(value);
}

function evidenceLabel(type: string) {
  const labels: Record<string, string> = {
    GITHUB_REPOSITORY: "Repository snapshot",
    GITHUB_FILE: "Source file",
    GITHUB_TEST_SIGNAL: "Test / CI signal",
    DEMO_URL: "Demo / walkthrough",
    SOLANA_TRANSACTION: "Azync credential transaction",
    SOLANA_ACCOUNT: "Solana evidence",
  };
  return labels[type] ?? type;
}

function safeEvidenceHref(reference?: string | null) {
  if (!reference) return null;
  try {
    const url = new URL(reference);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function JudgeWorkspace() {
  const search = useSearchParams();
  const router = useRouter();
  const auth = useAuth();
  const [hackathons, setHackathons] = useState<Hackathon[]>([]);
  const [hackathonId, setHackathonId] = useState(search.get("hackathon") || "");
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [submissionId, setSubmissionId] = useState(
    search.get("submission") || "",
  );
  const [analysisStatus, setAnalysisStatus] = useState<AiAnalysisStatus | null>(
    null,
  );
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [suggestions, setSuggestions] = useState<GhostSuggestions | null>(null);
  const [question, setQuestion] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingSubmission, setLoadingSubmission] = useState(false);
  const [loadingChat, setLoadingChat] = useState(false);
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messageLog = useRef<HTMLDivElement>(null);
  const suggestionRequest = useRef(0);
  const usedGhosts = useRef(new Set<string>());
  const sessionVersionRef = useRef(auth.sessionVersion);
  sessionVersionRef.current = auth.sessionVersion;

  const selectedHackathon =
    hackathons.find((item) => item.id === hackathonId) ?? null;
  const selectedSubmission =
    submissions.find((item) => item.id === submissionId) ?? null;
  // A submission list can contain an older completed analysis while a newer
  // analysis is queued, retrying, or failed. Never call that old output
  // "verified" for the current evidence request.
  const hasCompletedAnalysis =
    auth.user &&
    analysisStatus?.status === "completed" &&
    Boolean(analysisStatus.results?.output);
  const rawAnalysis = hasCompletedAnalysis
    ? (analysisStatus?.results?.output ?? null)
    : null;
  const brief = useMemo(() => analysisSummary(rawAnalysis), [rawAnalysis]);
  const uncertaintyCount = useMemo(() => {
    const analysis = asRecord(rawAnalysis);
    const requirements = Array.isArray(analysis.requirements)
      ? analysis.requirements
      : [];
    return requirements.filter((item) => asRecord(item).status === "UNCERTAIN")
      .length;
  }, [rawAnalysis]);

  useEffect(() => {
    api.hackathons
      .list()
      .then((items) => {
        setHackathons(items);
        setHackathonId((current) => current || items[0]?.id || "");
      })
      .catch((reason) => setError(apiErrorMessage(reason)))
      .finally(() => setLoadingList(false));
  }, []);

  useEffect(() => {
    if (!hackathonId || !auth.user) {
      setSubmissions([]);
      setLoadingSubmission(false);
      return;
    }
    const requestVersion = auth.sessionVersion;
    let cancelled = false;
    setLoadingSubmission(true);
    setError(null);
    api.hackathons
      .submissions(hackathonId)
      .then((items) => {
        if (cancelled || requestVersion !== sessionVersionRef.current) return;
        setSubmissions(items);
        setSubmissionId((current) =>
          items.some((item) => item.id === current)
            ? current
            : items[0]?.id || "",
        );
      })
      .catch((reason) => {
        if (!cancelled && requestVersion === sessionVersionRef.current) {
          setError(apiErrorMessage(reason));
        }
      })
      .finally(() => {
        if (!cancelled && requestVersion === sessionVersionRef.current) {
          setLoadingSubmission(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hackathonId, auth.user, auth.sessionVersion]);

  useEffect(() => {
    // Do not replace the route with an empty query while the competition list
    // is still loading. Under slow navigation that transient replace can race
    // the subsequent submission fetch and leave the rail empty.
    if (!auth.user || loadingList || (!hackathonId && !submissionId)) return;
    const params = new URLSearchParams();
    if (hackathonId) params.set("hackathon", hackathonId);
    if (submissionId) params.set("submission", submissionId);
    router.replace(`/judge?${params.toString()}`, { scroll: false });
  }, [hackathonId, submissionId, loadingList, router, auth.user]);

  useEffect(() => {
    setAnalysisStatus(null);
    setSessions([]);
    setSessionId("");
    setMessages([]);
    setSuggestions(null);
    usedGhosts.current.clear();
    suggestionRequest.current += 1;
    if (!submissionId || !auth.user) return;
    const requestVersion = auth.sessionVersion;
    let cancelled = false;
    setLoadingChat(true);
    Promise.all([
      api.submissions.analysis(submissionId),
      api.chat.sessions(submissionId),
      api.chat.suggestions(submissionId, ""),
    ])
      .then(([analysis, chatSessions, ghost]) => {
        if (cancelled || requestVersion !== sessionVersionRef.current) return;
        setAnalysisStatus(analysis);
        setSessions(chatSessions);
        setSessionId(chatSessions[0]?.id || "");
        setSuggestions(ghost);
      })
      .catch((reason) => {
        if (!cancelled && requestVersion === sessionVersionRef.current) {
          setError(apiErrorMessage(reason));
        }
      })
      .finally(() => {
        if (!cancelled && requestVersion === sessionVersionRef.current) {
          setLoadingChat(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [submissionId, auth.user, auth.sessionVersion]);

  useEffect(() => {
    if (!submissionId || !sessionId || !auth.user) {
      setMessages([]);
      return;
    }
    const requestVersion = auth.sessionVersion;
    let cancelled = false;
    api.chat
      .messages(submissionId, sessionId)
      .then((items) => {
        if (!cancelled && requestVersion === sessionVersionRef.current) {
          setMessages(items);
        }
      })
      .catch((reason) => {
        if (!cancelled && requestVersion === sessionVersionRef.current) {
          setError(apiErrorMessage(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [submissionId, sessionId, auth.user, auth.sessionVersion]);

  useEffect(() => {
    if (
      !submissionId ||
      !auth.user ||
      !analysisStatus ||
      !["queued", "processing", "retrying"].includes(analysisStatus.status)
    ) {
      return;
    }
    const requestVersion = auth.sessionVersion;
    let cancelled = false;
    const timer = window.setInterval(() => {
      api.submissions
        .analysis(submissionId)
        .then(async (next) => {
          if (cancelled || requestVersion !== sessionVersionRef.current) return;
          setAnalysisStatus(next);
          if (next.status === "completed") {
            const ghost = await api.chat.suggestions(submissionId, question);
            if (!cancelled && requestVersion === sessionVersionRef.current) {
              setSuggestions(ghost);
            }
          }
        })
        .catch(() => undefined);
    }, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [submissionId, auth.user, analysisStatus, auth.sessionVersion]);

  useEffect(() => {
    if (!submissionId || !auth.user) return;
    const requestVersion = auth.sessionVersion;
    const requestId = ++suggestionRequest.current;
    if (!question) {
      setSuggestions((current) => {
        if (!current || current.suggestion || current.candidates.length === 0)
          return current;
        const suggestion =
          current.candidates.find((item) => !usedGhosts.current.has(item)) ??
          null;
        return suggestion
          ? { ...current, suggestion, completion: suggestion }
          : current;
      });
      return;
    }
    const timer = window.setTimeout(() => {
      api.chat
        .suggestions(submissionId, question)
        .then((next) => {
          if (
            requestId === suggestionRequest.current &&
            requestVersion === sessionVersionRef.current
          ) {
            setSuggestions(next);
          }
        })
        .catch(() => undefined);
    }, 220);
    return () => {
      window.clearTimeout(timer);
      suggestionRequest.current += 1;
    };
  }, [submissionId, question, auth.user, auth.sessionVersion]);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const log = messageLog.current;
      if (log) log.scrollTop = log.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, sending, sessionId]);

  async function createSession() {
    if (!submissionId) return;
    const requestVersion = auth.sessionVersion;
    try {
      setLoadingChat(true);
      const session = await api.chat.createSession(
        submissionId,
        `Review ${selectedSubmission?.projectName || "submission"}`,
      );
      if (requestVersion !== sessionVersionRef.current) return;
      setSessions((current) => [session, ...current]);
      setSessionId(session.id);
      setMessages([]);
    } catch (reason) {
      if (requestVersion === sessionVersionRef.current) {
        setError(apiErrorMessage(reason));
      }
    } finally {
      if (requestVersion === sessionVersionRef.current) setLoadingChat(false);
    }
  }

  async function sendQuestion(event: FormEvent) {
    event.preventDefault();
    const content = question.trim();
    if (!content || !submissionId || sending) return;
    const requestVersion = auth.sessionVersion;
    let activeSession = sessionId;
    try {
      setSending(true);
      setError(null);
      suggestionRequest.current += 1;
      if (suggestions?.candidates.includes(content))
        usedGhosts.current.add(content);
      setQuestion("");
      setSuggestions((current) => {
        if (!current) return null;
        let next =
          current.candidates.find((item) => !usedGhosts.current.has(item)) ??
          null;
        if (!next) {
          usedGhosts.current.clear();
          if (current.candidates.includes(content))
            usedGhosts.current.add(content);
          next = current.candidates.find((item) => item !== content) ?? null;
        }
        return { ...current, suggestion: next, completion: next };
      });
      if (!activeSession) {
        const created = await api.chat.createSession(
          submissionId,
          `Review ${selectedSubmission?.projectName || "submission"}`,
        );
        if (requestVersion !== sessionVersionRef.current) return;
        setSessions((current) => [created, ...current]);
        setSessionId(created.id);
        activeSession = created.id;
      }
      const response = await api.chat.send(
        submissionId,
        activeSession,
        content,
      );
      if (requestVersion !== sessionVersionRef.current) return;
      setMessages((current) => {
        // Creating the first session also triggers the history-loading effect.
        // That request can finish while this send is in flight, so merge by the
        // persisted message id instead of rendering the same user message twice.
        const merged = [
          ...current,
          response.userMessage,
          ...(response.assistantMessage ? [response.assistantMessage] : []),
        ];
        return Array.from(
          new Map(merged.map((message) => [message.id, message])).values(),
        );
      });
      const persistedCount = response.assistantMessage ? 2 : 1;
      setSessions((current) =>
        current.map((session) =>
          session.id === activeSession
            ? {
                ...session,
                _count: {
                  messages: (session._count?.messages ?? 0) + persistedCount,
                },
              }
            : session,
        ),
      );
      if (response.error) setError(response.error.message);
      if (response.contextAdvanced) {
        setError(
          "The repository context just changed. This answer uses the latest evidence version.",
        );
      }
    } catch (reason) {
      if (requestVersion !== sessionVersionRef.current) return;
      setQuestion(content);
      setError(apiErrorMessage(reason));
    } finally {
      if (requestVersion === sessionVersionRef.current) setSending(false);
    }
  }

  function handleQuestionKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Tab" && suggestions?.suggestion) {
      event.preventDefault();
      setQuestion(suggestions.suggestion);
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  async function refreshAnalysis() {
    if (!submissionId) return;
    const requestVersion = auth.sessionVersion;
    try {
      setRefreshing(true);
      setError(null);
      await api.submissions.refreshAnalysis(submissionId);
      const next = await api.submissions.analysis(submissionId);
      if (requestVersion !== sessionVersionRef.current) return;
      setAnalysisStatus(next);
    } catch (reason) {
      if (requestVersion === sessionVersionRef.current) {
        setError(apiErrorMessage(reason));
      }
    } finally {
      if (requestVersion === sessionVersionRef.current) setRefreshing(false);
    }
  }

  const analysisState =
    analysisStatus?.status ?? (loadingChat ? "loading" : "not queued");
  const analysisFailure = analysisStatus?.status === "failed";

  return (
    <>
      <main className="judge-workspace">
        <aside className="submission-rail">
          <div className="rail-heading">
            <p className="eyebrow">Competition</p>
            <label className="select-wrap">
              <span className="sr-only">Select hackathon</span>
              <select
                value={hackathonId}
                onChange={(e) => setHackathonId(e.target.value)}
              >
                {hackathons.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={15} aria-hidden="true" />
            </label>
            {selectedHackathon && (
              <p className="rail-meta">
                Ends {formatTime(selectedHackathon.endDate)}
              </p>
            )}
          </div>
          <div className="rail-section-label">
            <span>Submissions</span>
            <span>{submissions.length}</span>
          </div>
          <div
            className="submission-list"
            aria-busy={loadingSubmission || loadingList}
          >
            {(loadingSubmission || loadingList) && (
              <p className="rail-empty">Loading submissions…</p>
            )}
            {!loadingSubmission && submissions.length === 0 && (
              <p className="rail-empty">
                There are no submissions in this hackathon yet.
              </p>
            )}
            {submissions.map((submission, index) => (
              <button
                type="button"
                key={submission.id}
                className={`submission-item ${submission.id === submissionId ? "selected" : ""}`}
                onClick={() => setSubmissionId(submission.id)}
              >
                <span className="submission-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>
                  <strong>{submission.projectName}</strong>
                  <small>{submission.team?.name || "Unknown team"}</small>
                </span>
                <span
                  className={`status-dot ${submission.aiAnalyses?.length ? "ready" : ""}`}
                />
              </button>
            ))}
          </div>
        </aside>

        <section className="brief-pane">
          {!selectedSubmission ? (
            <div className="pane-empty">
              <FileSearch size={24} />
              <strong>Select a submission to begin</strong>
            </div>
          ) : (
            <>
              <header className="brief-header">
                <div>
                  <p className="eyebrow">Evidence brief</p>
                  <h1>{selectedSubmission.projectName}</h1>
                  <p>
                    {selectedSubmission.team?.name} · submitted{" "}
                    {formatTime(selectedSubmission.createdAt)}
                  </p>
                </div>
                <div className="brief-actions">
                  <a
                    className="button secondary compact"
                    href={selectedSubmission.githubUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <GitBranch size={15} /> Repository{" "}
                    <ArrowUpRight size={13} />
                  </a>
                  <button
                    className="button secondary compact"
                    type="button"
                    onClick={refreshAnalysis}
                    disabled={refreshing || !auth.user}
                  >
                    <RefreshCw size={15} className={refreshing ? "spin" : ""} />
                    {refreshing ? "Refreshing" : "Refresh evidence"}
                  </button>
                </div>
              </header>

              {!auth.user && !auth.loading && (
                <div className="notice warning">
                  <CircleAlert size={18} /> Sign in with an assigned judge
                  account to open the analysis and private chat.
                </div>
              )}
              {error && (
                <div className="notice danger" role="alert">
                  {error}
                </div>
              )}

              <div className="context-ledger">
                <div>
                  <span>Analysis</span>
                  <strong>{analysisState}</strong>
                </div>
                <div>
                  <span>Context version</span>
                  <strong className="mono">
                    v{suggestions?.contextVersion ?? "—"}
                  </strong>
                </div>
                <div>
                  <span>Rules</span>
                  <strong className="mono">
                    {selectedHackathon?.rulesVersion || "—"}
                  </strong>
                </div>
                <div>
                  <span>Rubric</span>
                  <strong className="mono">
                    {selectedHackathon?.rubricVersion || "—"}
                  </strong>
                </div>
              </div>

              <div className="notice advisory" role="status">
                <CircleAlert size={18} />
                <span>
                  <strong>AI advisory only.</strong> Human judges own every
                  score and final decision.{" "}
                  {uncertaintyCount > 0
                    ? `${uncertaintyCount} requirement${uncertaintyCount === 1 ? " is" : "s are"} uncertain and needs review against linked evidence.`
                    : " Review linked evidence before recording any external score."}
                </span>
              </div>

              {analysisFailure && (
                <div className="notice warning" role="status">
                  <CircleAlert size={18} />
                  <span>
                    Evidence analysis failed
                    {analysisStatus?.error?.message
                      ? `: ${analysisStatus.error.message}`
                      : "."}{" "}
                    The prior brief is hidden. Use the evidence refresh control
                    to retry the current advisory analysis.
                  </span>
                </div>
              )}

              <article className="brief-document">
                <section>
                  <div className="document-label">
                    <span>01</span>
                    <h2>Project claim</h2>
                  </div>
                  <MarkdownContent content={selectedSubmission.description} />
                </section>
                <section>
                  <div className="document-label">
                    <span>02</span>
                    <h2>
                      {hasCompletedAnalysis
                        ? "Verified summary"
                        : "Evidence analysis pending"}
                    </h2>
                  </div>
                  {hasCompletedAnalysis ? (
                    <MarkdownContent content={brief.summary} />
                  ) : (
                    <p className="muted">
                      {analysisFailure
                        ? "No current verified brief is available. Retry the analysis before relying on AI advisory."
                        : "The current evidence analysis is not complete. A prior analysis is not shown as verified."}
                    </p>
                  )}
                  {hasCompletedAnalysis && brief.confidence !== null && (
                    <div className="confidence-line">
                      <span>Confidence</span>
                      <div>
                        <i
                          style={{
                            width: `${Math.min(100, brief.confidence <= 1 ? brief.confidence * 100 : brief.confidence)}%`,
                          }}
                        />
                      </div>
                      <strong>
                        {brief.confidence <= 1
                          ? Math.round(brief.confidence * 100)
                          : Math.round(brief.confidence)}
                        %
                      </strong>
                    </div>
                  )}
                </section>
                <section className="two-column-findings">
                  <div>
                    <div className="document-label">
                      <span>03</span>
                      <h2>Strengths</h2>
                    </div>
                    {brief.strengths.length ? (
                      <ul className="finding-list good">
                        {brief.strengths.map((item) => (
                          <li key={item}>
                            <Check size={15} />
                            <MarkdownContent
                              content={item}
                              className="compact"
                            />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted">
                        No strengths have been confirmed by evidence.
                      </p>
                    )}
                  </div>
                  <div>
                    <div className="document-label">
                      <span>04</span>
                      <h2>Open concerns</h2>
                    </div>
                    {brief.concerns.length ? (
                      <ul className="finding-list concern">
                        {brief.concerns.map((item, index) => (
                          <li key={`${concernText(item)}-${index}`}>
                            <CircleAlert size={15} />
                            <MarkdownContent
                              content={concernText(item)}
                              className="compact"
                            />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted">There are no open concerns.</p>
                    )}
                  </div>
                </section>
                <section>
                  <div className="document-label">
                    <span>05</span>
                    <h2>Evidence links supplied</h2>
                  </div>
                  <div className="reference-table">
                    <a
                      href={selectedSubmission.githubUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span>GitHub</span>
                      <code>{selectedSubmission.githubUrl}</code>
                      <ArrowUpRight size={14} />
                    </a>
                    <a
                      href={selectedSubmission.demoUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span>Demo</span>
                      <code>{selectedSubmission.demoUrl}</code>
                      <ArrowUpRight size={14} />
                    </a>
                  </div>
                </section>
                <section>
                  <div className="document-label">
                    <span>06</span>
                    <h2>Human scoring rubric</h2>
                  </div>
                  {selectedHackathon?.rubric?.length ? (
                    <ul className="finding-list">
                      {selectedHackathon.rubric.map((criterion) => (
                        <li key={criterion.id}>
                          <strong>{criterion.name}</strong>
                          <span>
                            {criterion.description} · weight {criterion.weight}{" "}
                            · range {criterion.minScore}–{criterion.maxScore}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">
                      No organizer rubric is available for this event.
                    </p>
                  )}
                </section>
              </article>
            </>
          )}
        </section>

        <aside className="inquiry-pane">
          <header className="inquiry-header">
            <div>
              <p className="eyebrow">Judge inquiry</p>
              <h2>Ask about the evidence</h2>
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={createSession}
              disabled={!auth.user || !submissionId}
              title="Create new session"
              aria-label="Create new chat session"
            >
              <Plus size={18} />
            </button>
          </header>
          {sessions.length > 0 && (
            <label className="session-select">
              <History size={15} />
              <span className="sr-only">Chat session</span>
              <select
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
              >
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.title || "Untitled session"} ·{" "}
                    {session._count?.messages ?? 0}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div
            className="message-log"
            ref={messageLog}
            aria-live="polite"
            aria-busy={sending || loadingChat}
          >
            {!auth.user ? (
              <div className="chat-empty">
                <MessageSquareText size={22} />
                <strong>Chat is isolated by judge</strong>
                <p>Sign in to access your own encrypted history.</p>
              </div>
            ) : !submissionId ? (
              <div className="chat-empty">
                <MessageSquareText size={22} />
                <strong>No submission is available for discussion</strong>
                <p>
                  Judge chat is attached to each submission. When a team
                  submits, select it in the left column to begin.
                </p>
              </div>
            ) : messages.length === 0 ? (
              <div className="chat-empty">
                <MessageSquareText size={22} />
                <strong>Start with a specific question</strong>
                <p>
                  AI answers only within the hackathon, rubric, and evidence of
                  the selected submission.
                </p>
              </div>
            ) : (
              messages.map((message) => (
                <article
                  className={`message ${message.role.toLowerCase()}`}
                  key={message.id}
                >
                  <div className="message-meta">
                    <strong>
                      {message.role === "USER"
                        ? "You"
                        : message.model === "local-evidence-fallback"
                          ? "Azync evidence"
                          : "Azync analysis"}
                    </strong>
                    <span>
                      context v{message.contextVersion} ·{" "}
                      {formatTime(message.createdAt)}
                    </span>
                  </div>
                  <MarkdownContent
                    content={message.content}
                    className="chat-markdown"
                  />
                  {message.evidenceLinks &&
                    message.evidenceLinks.length > 0 && (
                      <div className="evidence-tags">
                        {message.evidenceLinks.map((link) => {
                          if (!link.evidence) return null;
                          const href = safeEvidenceHref(
                            link.evidence.reference,
                          );
                          const label = `${evidenceLabel(link.evidence.type)} · ${link.evidence.status}`;
                          return href ? (
                            <a
                              key={link.evidence.id}
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {label} <ArrowUpRight size={11} />
                            </a>
                          ) : (
                            <span key={link.evidence.id}>{label}</span>
                          );
                        })}
                      </div>
                    )}
                </article>
              ))
            )}
            {sending && (
              <div className="analysis-progress">
                <span />
                <p>Checking the question against the evidence snapshot…</p>
              </div>
            )}
          </div>
          <form className="inquiry-composer" onSubmit={sendQuestion}>
            <label htmlFor="judge-question">Question for this submission</label>
            <textarea
              id="judge-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleQuestionKeyDown}
              placeholder={
                suggestions?.suggestion ||
                "Select a submission to receive contextual suggestions"
              }
              rows={4}
              disabled={!auth.user || !submissionId || sending}
            />
            <div className="composer-footer">
              <span>
                {suggestions?.suggestion ? (
                  <>
                    <kbd>Tab</kbd> accept suggestion · <kbd>Shift Enter</kbd>{" "}
                    new line
                  </>
                ) : (
                  "Answers include provenance when evidence is available."
                )}
              </span>
              <button
                className="send-button"
                type="submit"
                disabled={!auth.user || !question.trim() || sending}
                aria-label="Send question"
              >
                <Send size={17} />
              </button>
            </div>
          </form>
        </aside>
      </main>
    </>
  );
}
