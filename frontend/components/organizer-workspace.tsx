"use client";

import {
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  Plus,
  Scale,
  Trash2,
  Trophy,
  UserCheck,
} from "lucide-react";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  API_URL,
  api,
  apiErrorMessage,
  type HackathonPayload,
} from "@/lib/api";
import { useHackathonRealtime } from "@/lib/use-realtime";
import type {
  Hackathon,
  HackathonRule,
  JudgeAssignment,
  Leaderboard,
  OrganizerSubmissionPage,
  RubricCriterion,
  Team,
} from "@/lib/types";
import { useAuth } from "./auth-provider";

function localDate(daysFromNow: number) {
  const value = new Date(Date.now() + daysFromNow * 86400000);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 16);
}

export function OrganizerWorkspace() {
  const auth = useAuth();
  const [events, setEvents] = useState<Hackathon[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [judges, setJudges] = useState<JudgeAssignment[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [leaderboard, setLeaderboard] = useState<Leaderboard | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [boardLoading, setBoardLoading] = useState(false);
  const [submissionPage, setSubmissionPage] =
    useState<OrganizerSubmissionPage | null>(null);
  const [submissionSearch, setSubmissionSearch] = useState("");
  const [submissionTrackId, setSubmissionTrackId] = useState("");
  const [submissionStatus, setSubmissionStatus] = useState("");
  const scopeRequest = useRef(0);
  const boardRequest = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState(localDate(0));
  const [endDate, setEndDate] = useState(localDate(7));
  const [ruleName, setRuleName] = useState("Original work");
  const [ruleDescription, setRuleDescription] = useState(
    "Submission must represent work completed for this event.",
  );
  const [rubricName, setRubricName] = useState("Technical quality");
  const [rubricDescription, setRubricDescription] = useState(
    "Implementation quality, reliability and engineering decisions.",
  );
  const [weight, setWeight] = useState(1);
  const [judgeId, setJudgeId] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const selected = events.find((item) => item.id === selectedId) || null;
  const organized = useMemo(
    () => events.filter((item) => item.organizerId === auth.user?.id),
    [events, auth.user?.id],
  );

  const loadEvents = useCallback(async () => {
    try {
      const rows = await api.hackathons.mine();
      setEvents(rows);
      setSelectedId(
        (current) =>
          current ||
          new URLSearchParams(window.location.search).get("hackathon") ||
          rows.find((item) => item.organizerId === auth.user?.id)?.id ||
          "",
      );
    } catch (reason) {
      setError(apiErrorMessage(reason));
    }
  }, [auth.user?.id]);
  const loadScope = useCallback(async () => {
    if (!selectedId) return;
    const requestId = ++scopeRequest.current;
    const event = events.find((item) => item.id === selectedId);
    const isOrganizer = event?.organizerId === auth.user?.id;
    setSubmissionPage(null);
    const [registered, judgeRows, submissions] = await Promise.allSettled([
      api.hackathons.teams(selectedId),
      isOrganizer ? api.hackathons.judges(selectedId) : Promise.resolve([]),
      isOrganizer
        ? api.hackathons.organizerSubmissions(selectedId, {
            search: submissionSearch,
            trackId: submissionTrackId || undefined,
            status: submissionStatus || undefined,
          })
        : Promise.resolve(null),
    ]);
    if (requestId !== scopeRequest.current) return;
    setTeams(registered.status === "fulfilled" ? registered.value : []);
    setJudges(judgeRows.status === "fulfilled" ? judgeRows.value : []);
    setSubmissionPage(
      submissions.status === "fulfilled" ? submissions.value : null,
    );
    const failure = [registered, judgeRows, submissions].find(
      (result) => result.status === "rejected",
    );
    setError(
      failure?.status === "rejected" ? apiErrorMessage(failure.reason) : null,
    );
  }, [
    selectedId,
    events,
    auth.user?.id,
    auth.sessionVersion,
    submissionSearch,
    submissionTrackId,
    submissionStatus,
  ]);
  const refreshBoard = useCallback(async () => {
    if (!selectedId) return;
    const requestId = ++boardRequest.current;
    setBoardLoading(true);
    try {
      const latest = await api.hackathons.leaderboard(selectedId);
      if (requestId === boardRequest.current) {
        setLeaderboard(latest);
        setBoardError(null);
      }
    } catch (reason) {
      if (requestId === boardRequest.current)
        setBoardError(apiErrorMessage(reason));
    } finally {
      if (requestId === boardRequest.current) setBoardLoading(false);
    }
  }, [selectedId, auth.sessionVersion]);
  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);
  useEffect(() => {
    void loadScope();
    return () => {
      scopeRequest.current += 1;
    };
  }, [loadScope]);
  useEffect(() => {
    setLeaderboard(null);
    setBoardError(null);
    void refreshBoard();
    return () => {
      boardRequest.current += 1;
    };
  }, [refreshBoard]);
  useHackathonRealtime(selectedId || null, refreshBoard);

  async function run(operation: () => Promise<unknown>, success: string) {
    try {
      setBusy(true);
      setError(null);
      setNotice(null);
      await operation();
      setNotice(success);
      await loadEvents();
      await loadScope();
      await refreshBoard();
    } catch (reason) {
      setError(apiErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  async function chooseWinner(submissionId: string, label: string) {
    if (
      !selected ||
      !confirm(
        `Select “${label}” as the winner and issue the winner cNFT? This decision cannot be changed to another submission.`,
      )
    )
      return;
    try {
      setBusy(true);
      setError(null);
      setNotice(null);
      const award = await api.hackathons.selectWinner(
        selected.id,
        submissionId,
      );
      setNotice(
        award.status === "confirmed"
          ? "The winner has been selected and the winner cNFT is confirmed on Solana."
          : `The winner has been recorded. The certificate is ${award.status}; it can be retried without changing the decision.`,
      );
      await loadScope();
    } catch (reason) {
      setError(apiErrorMessage(reason));
      await loadScope();
    } finally {
      setBusy(false);
    }
  }

  async function retryWinnerCertificate() {
    if (!selected) return;
    try {
      setBusy(true);
      setError(null);
      const award = await api.hackathons.retryWinnerCertificate(selected.id);
      setNotice(
        award.status === "confirmed"
          ? "The winner cNFT is confirmed on Solana."
          : `The certificate is currently ${award.status}.`,
      );
      await loadScope();
    } catch (reason) {
      setError(apiErrorMessage(reason));
      await loadScope();
    } finally {
      setBusy(false);
    }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    const payload: HackathonPayload = {
      name,
      startDate: new Date(startDate).toISOString(),
      endDate: new Date(endDate).toISOString(),
      rules: [],
      rubric: [],
    };
    try {
      setBusy(true);
      const created = await api.hackathons.create(payload);
      setName("");
      setSelectedId(created.id);
      setShowCreate(false);
      setNotice("The hackathon has been created.");
      await loadEvents();
    } catch (reason) {
      setError(apiErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  function addRule() {
    if (!selected || !ruleName.trim()) return;
    const rule: HackathonRule = {
      id: `rule-${Date.now()}`,
      name: ruleName.trim(),
      description: ruleDescription.trim(),
    };
    void run(
      () =>
        api.hackathons.update(selected.id, {
          rules: [...(selected.rules || []), rule],
        }),
      "The rules have been versioned.",
    );
  }
  function addRubric() {
    if (!selected || !rubricName.trim()) return;
    const criterion: RubricCriterion = {
      id: `rubric-${Date.now()}`,
      name: rubricName.trim(),
      description: rubricDescription.trim(),
      weight,
      minScore: 0,
      maxScore: 10,
    };
    void run(
      () =>
        api.hackathons.update(selected.id, {
          rubric: [...(selected.rubric || []), criterion],
        }),
      "The rubric has been versioned.",
    );
  }

  return (
    <main className="page-shell ops-page">
      <header className="ops-heading">
        <div>
          <p className="eyebrow">Organizer console</p>
          <h1>Manage hackathons</h1>
          <p>
            Criteria, registrations, judges, and progress on one control
            surface.
          </p>
        </div>
        <div className="heading-actions">
          {organized.length > 0 && (
            <select
              className="heading-select"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {organized.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          )}
          <button
            className="button primary"
            type="button"
            onClick={() => setShowCreate((value) => !value)}
          >
            <CalendarPlus size={15} /> New hackathon
          </button>
        </div>
      </header>
      {error && (
        <div className="notice danger" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice success">
          <CheckCircle2 size={16} />
          {notice}
        </div>
      )}
      {(!selected || showCreate) && (
        <section className="ops-panel form-panel standalone">
          <header>
            <div>
              <p className="eyebrow">New event</p>
              <h2>
                {selected
                  ? "Create another hackathon"
                  : "Create your first hackathon"}
              </h2>
            </div>
            <CalendarPlus size={18} />
          </header>
          <form className="compact-form" onSubmit={create}>
            <label>
              <span>Hackathon name</span>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="field-pair">
              <label>
                <span>Starts</span>
                <input
                  type="datetime-local"
                  required
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </label>
              <label>
                <span>Ends</span>
                <input
                  type="datetime-local"
                  required
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </label>
            </div>
            <button className="button primary" disabled={busy}>
              Create hackathon
            </button>
          </form>
        </section>
      )}
      {selected && (
        <>
          <section className="ops-panel">
            <header>
              <div>
                <p className="eyebrow">Publication & tracks</p>
                <h2>{selected.isPublished ? "Published" : "Draft"}</h2>
              </div>
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      api.hackathons.update(selected.id, {
                        isPublished: !selected.isPublished,
                      }),
                    selected.isPublished
                      ? "The hackathon has been unpublished."
                      : "The hackathon has been published.",
                  )
                }
              >
                {selected.isPublished ? "Unpublish" : "Publish"}
              </button>
            </header>
            <div className="data-rows">
              {selected.tracks?.map((track) => (
                <div className="data-row organizer-track-row" key={track.id}>
                  <span>
                    <strong>{track.name}</strong>
                    <small>{track.description || "No description"}</small>
                  </span>
                  <div className="row-actions">
                    <button
                      aria-label={`Edit track ${track.name}`}
                      className="bare-button"
                      type="button"
                      onClick={() => {
                        const name = prompt("Track name", track.name);
                        const description = prompt(
                          "Track description",
                          track.description || "",
                        );
                        if (name?.trim() && description !== null)
                          void run(
                            () =>
                              api.hackathons.updateTrack(
                                selected.id,
                                track.id,
                                { name: name.trim(), description },
                              ),
                            "The track has been updated.",
                          );
                      }}
                    >
                      Edit
                    </button>
                    <button
                      aria-label={`Disable track ${track.name}`}
                      className="bare-button"
                      type="button"
                      onClick={() =>
                        void run(
                          () =>
                            api.hackathons.updateTrack(selected.id, track.id, {
                              isActive: false,
                            }),
                          "The track has been disabled.",
                        )
                      }
                    >
                      Disable
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="panel-actions">
              <button
                className="button secondary compact"
                type="button"
                onClick={() => {
                  const name = prompt("Track name");
                  if (name?.trim())
                    void run(
                      () =>
                        api.hackathons.createTrack(selected.id, {
                          name: name.trim(),
                        }),
                      "The track has been created.",
                    );
                }}
              >
                Add track
              </button>
              <button
                className="bare-button"
                type="button"
                onClick={() => {
                  const description = prompt(
                    "Description",
                    selected.description || "",
                  );
                  const coverUrl = prompt("Cover URL", selected.coverUrl || "");
                  if (description !== null && coverUrl !== null)
                    void run(
                      () =>
                        api.hackathons.update(selected.id, {
                          description,
                          coverUrl,
                        }),
                      "The event brief has been updated.",
                    );
                }}
              >
                Edit description / cover
              </button>
            </div>
          </section>
          <section className="event-control-strip">
            <div>
              <span>Rules version</span>
              <code>{selected.rulesVersion}</code>
            </div>
            <div>
              <span>Rubric version</span>
              <code>{selected.rubricVersion}</code>
            </div>
            <div>
              <span>Registered teams</span>
              <strong>{teams.length}</strong>
            </div>
            <div>
              <span>Judges</span>
              <strong>{judges.length}</strong>
            </div>
            <button
              className="bare-button"
              type="button"
              disabled={busy}
              onClick={() => {
                const nextName = prompt("Hackathon name", selected.name);
                const nextStart = prompt(
                  "Start date (ISO)",
                  selected.startDate,
                );
                const nextEnd = prompt("End date (ISO)", selected.endDate);
                if (nextName?.trim() && nextStart && nextEnd)
                  void run(
                    () =>
                      api.hackathons.update(selected.id, {
                        name: nextName.trim(),
                        startDate: new Date(nextStart).toISOString(),
                        endDate: new Date(nextEnd).toISOString(),
                      }),
                    "The hackathon has been updated.",
                  );
              }}
            >
              Edit
            </button>
            <button
              className="bare-button danger-text"
              type="button"
              disabled={busy}
              onClick={() => {
                if (confirm(`Delete “${selected.name}” and its related data?`))
                  void run(
                    () => api.hackathons.remove(selected.id),
                    "The hackathon has been deleted.",
                  );
              }}
            >
              <Trash2 size={14} /> Delete
            </button>
          </section>
          <section className="ops-panel" aria-label="Organizer submissions">
            <header>
              <div>
                <p className="eyebrow">Organizer-only</p>
                <h2>Submissions</h2>
              </div>
            </header>
            {new Date(selected.endDate) < new Date() && (
              <p className="muted organizer-submission-state">
                This event has ended; submissions are read-only.
              </p>
            )}
            {new Date(selected.endDate) >= new Date() && (
              <p className="muted organizer-submission-state">
                Winner selection opens after the submission deadline.
              </p>
            )}
            {submissionPage?.winner && (
              <section className="winner-award" aria-label="Official winner">
                <div className="winner-award-title">
                  <Trophy size={18} />
                  <div>
                    <p className="eyebrow">Official winner · human decision</p>
                    <strong>
                      {submissionPage.winner.team?.name ?? "Winning team"} ·{" "}
                      {submissionPage.winner.projectName ?? "Winning project"}
                    </strong>
                  </div>
                </div>
                <p>
                  Solana certificate:{" "}
                  <strong>{submissionPage.winner.status}</strong> · recipient{" "}
                  <code>{submissionPage.winner.recipientAddress}</code>
                </p>
                <div className="winner-award-links">
                  {submissionPage.winner.explorerUrl && (
                    <a
                      href={submissionPage.winner.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Winner certificate on Explorer
                    </a>
                  )}
                  {submissionPage.winner.metadataUri && (
                    <a
                      href={submissionPage.winner.metadataUri}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Metadata
                    </a>
                  )}
                  <a
                    href={`${API_URL}${submissionPage.winner.verifyPath}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Verify certificate
                  </a>
                  {submissionPage.winner.status !== "confirmed" && (
                    <button
                      className="button secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => void retryWinnerCertificate()}
                    >
                      Retry winner certificate
                    </button>
                  )}
                </div>
              </section>
            )}
            <div className="organizer-submission-toolbar">
              <input
                aria-label="Search submissions"
                value={submissionSearch}
                onChange={(event) => setSubmissionSearch(event.target.value)}
                placeholder="Search team or project"
              />
              <select
                aria-label="Filter submission track"
                value={submissionTrackId}
                onChange={(event) => setSubmissionTrackId(event.target.value)}
              >
                <option value="">All tracks</option>
                {selected.tracks?.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter submission status"
                value={submissionStatus}
                onChange={(event) => setSubmissionStatus(event.target.value)}
              >
                <option value="">All statuses</option>
                <option value="confirmed">Confirmed</option>
                <option value="pending_nft">Pending</option>
                <option value="nft_failed">NFT failed</option>
              </select>
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  void api.hackathons
                    .organizerSubmissionsCsv(selected.id, {
                      search: submissionSearch || undefined,
                      trackId: submissionTrackId || undefined,
                      status: submissionStatus || undefined,
                    })
                    .then((csv) => {
                      const url = URL.createObjectURL(
                        new Blob([csv], { type: "text/csv;charset=utf-8" }),
                      );
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = `${selected.id}-submissions.csv`;
                      link.click();
                      URL.revokeObjectURL(url);
                    })
                    .catch((reason) => setError(apiErrorMessage(reason)))
                }
              >
                Export CSV
              </button>
            </div>
            {!submissionPage && <p>Loading submissions…</p>}
            {submissionPage?.items.length === 0 && (
              <p>No submissions match these filters.</p>
            )}
            {submissionPage?.items.map((submission) => (
              <article
                key={submission.id}
                className={`organizer-submission-row${submission.isWinner ? " winner-row" : ""}`}
              >
                <span className="organizer-submission-copy">
                  <strong>
                    {submission.isWinner && (
                      <Trophy size={14} aria-label="Winner" />
                    )}{" "}
                    {submission.team.name} · {submission.projectName}
                  </strong>
                  <small>
                    {submission.track?.name ?? "No track"} ·{" "}
                    {new Date(submission.createdAt).toLocaleString()} ·{" "}
                    {submission.receivedStatus} / {submission.aiStatus} /{" "}
                    {submission.mintStatus}
                  </small>
                </span>
                <span className="row-actions">
                  <a href={`/submissions?submission=${submission.id}`}>
                    Project
                  </a>
                  {submission.participantBlockchainEvidenceUrl && (
                    <a
                      href={
                        submission.participantBlockchainEvidenceUrl ?? undefined
                      }
                    >
                      Evidence
                    </a>
                  )}
                  {submission.transactionSignature && (
                    <a href={`/submissions?submission=${submission.id}`}>
                      Proof
                    </a>
                  )}
                  {!submissionPage.winner &&
                    new Date(selected.endDate) < new Date() && (
                      <button
                        className="button secondary"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void chooseWinner(
                            submission.id,
                            `${submission.team.name} · ${submission.projectName}`,
                          )
                        }
                      >
                        Select winner + Solana cNFT
                      </button>
                    )}
                </span>
              </article>
            ))}
            {submissionPage?.nextCursor && (
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  const requestId = scopeRequest.current;
                  void api.hackathons
                    .organizerSubmissions(selected.id, {
                      search: submissionSearch,
                      trackId: submissionTrackId || undefined,
                      status: submissionStatus || undefined,
                      cursor: submissionPage.nextCursor ?? undefined,
                    })
                    .then((page) => {
                      if (requestId === scopeRequest.current)
                        setSubmissionPage(page);
                    })
                    .catch((reason) => {
                      if (requestId === scopeRequest.current)
                        setError(apiErrorMessage(reason));
                    });
                }}
              >
                Next page
              </button>
            )}
          </section>
          <div className="workspace-columns">
            <section className="ops-panel">
              <header>
                <div>
                  <p className="eyebrow">Criteria ledger</p>
                  <h2>Rules</h2>
                </div>
                <ClipboardList size={18} />
              </header>
              <div className="criteria-list">
                {(selected.rules || []).map((rule) => (
                  <article key={rule.id}>
                    <code>{rule.id}</code>
                    <strong>{rule.name}</strong>
                    <p>{rule.description}</p>
                    <button
                      className="bare-button danger-text"
                      type="button"
                      onClick={() =>
                        void run(
                          () =>
                            api.hackathons.update(selected.id, {
                              rules: selected.rules.filter(
                                (item) => item.id !== rule.id,
                              ),
                            }),
                          "The rule has been deleted and a new version created.",
                        )
                      }
                    >
                      <Trash2 size={12} />
                    </button>
                  </article>
                ))}
              </div>
              <div className="panel-form-grid">
                <input
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  placeholder="Rule name"
                />
                <textarea
                  value={ruleDescription}
                  onChange={(e) => setRuleDescription(e.target.value)}
                  rows={2}
                />
                <button
                  className="button secondary compact"
                  onClick={addRule}
                  disabled={busy}
                >
                  <Plus size={14} /> Add rule
                </button>
              </div>
            </section>
            <section className="ops-panel">
              <header>
                <div>
                  <p className="eyebrow">Scoring model</p>
                  <h2>Rubric</h2>
                </div>
                <Scale size={18} />
              </header>
              <div className="criteria-list">
                {(selected.rubric || []).map((item) => (
                  <article key={item.id}>
                    <code>{Math.round(item.weight * 100)}%</code>
                    <strong>{item.name}</strong>
                    <p>
                      {item.description} · {item.minScore}–{item.maxScore}
                    </p>
                    <button
                      className="bare-button danger-text"
                      type="button"
                      onClick={() =>
                        void run(
                          () =>
                            api.hackathons.update(selected.id, {
                              rubric: selected.rubric.filter(
                                (criterion) => criterion.id !== item.id,
                              ),
                            }),
                          "The criterion has been deleted and a new version created.",
                        )
                      }
                    >
                      <Trash2 size={12} />
                    </button>
                  </article>
                ))}
              </div>
              <div className="panel-form-grid">
                <input
                  value={rubricName}
                  onChange={(e) => setRubricName(e.target.value)}
                />
                <textarea
                  value={rubricDescription}
                  onChange={(e) => setRubricDescription(e.target.value)}
                  rows={2}
                />
                <label>
                  <span>Weight 0–1</span>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.1}
                    value={weight}
                    onChange={(e) => setWeight(Number(e.target.value))}
                  />
                </label>
                <button
                  className="button secondary compact"
                  onClick={addRubric}
                  disabled={busy}
                >
                  <Plus size={14} /> Add criterion
                </button>
              </div>
            </section>
          </div>
          <div className="workspace-columns">
            <section className="ops-panel">
              <header>
                <div>
                  <p className="eyebrow">Judge roster</p>
                  <h2>Assign judges</h2>
                </div>
                <UserCheck size={18} />
              </header>
              <div className="member-table">
                {judges.map((judge) => (
                  <div key={judge.userId}>
                    <span className="avatar-fallback">
                      {(judge.user.name ||
                        judge.user.githubUsername)[0].toUpperCase()}
                    </span>
                    <span>
                      <strong>
                        {judge.user.name || judge.user.githubUsername}
                      </strong>
                      <small>@{judge.user.githubUsername}</small>
                    </span>
                    <button
                      className="bare-button danger-text"
                      onClick={() =>
                        void run(
                          () =>
                            api.hackathons.removeJudge(
                              selected.id,
                              judge.userId,
                            ),
                          "The judge has been removed.",
                        )
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <form
                className="inline-form panel-bottom-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(
                    () => api.hackathons.assignJudge(selected.id, judgeId),
                    "The judge has been assigned.",
                  );
                  setJudgeId("");
                }}
              >
                <label>
                  <span>User ID</span>
                  <input
                    required
                    value={judgeId}
                    onChange={(e) => setJudgeId(e.target.value)}
                  />
                </label>
                <button className="button primary compact">Assign</button>
              </form>
            </section>
            <section className="ops-panel">
              <header>
                <div>
                  <p className="eyebrow">Registration</p>
                  <h2>Registered teams</h2>
                </div>
                <span className="count-badge">{teams.length}</span>
              </header>
              <div className="data-rows">
                {teams.map((team) => (
                  <div className="data-row" key={team.id}>
                    <span className="row-index">
                      {String(team.members?.length ?? 0).padStart(2, "0")}
                    </span>
                    <span>
                      <strong>{team.name}</strong>
                      <small>{team.members?.length ?? 0} members</small>
                    </span>
                  </div>
                ))}
              </div>
              <div className="panel-note">
                Team admins or members register from the Team Workspace.
              </div>
            </section>
          </div>
          <section className="ops-panel leaderboard-panel">
            <header>
              <div>
                <p className="eyebrow">Live operations</p>
                <h2>Task progress leaderboard</h2>
              </div>
              <span className="count-badge">
                {leaderboard?.leaderboard.length ?? 0}
              </span>
            </header>
            {boardError && (
              <p className="notice warning" role="alert">
                Could not update the leaderboard: {boardError}
                {leaderboard
                  ? " The data below is from the previous refresh."
                  : ""}
              </p>
            )}
            {boardLoading && (
              <p className="panel-note" role="status">
                Updating leaderboard…
              </p>
            )}
            {!boardLoading &&
              !boardError &&
              leaderboard?.leaderboard.length === 0 && (
                <p className="panel-note">
                  No teams are on the leaderboard yet.
                </p>
              )}
            {leaderboard?.definition && (
              <p className="panel-note" data-testid="leaderboard-definition">
                Teams are ranked by task completion percentage, with equal rates
                tied. CI is a separate signal and is not an official score.
              </p>
            )}
            <div className="leaderboard-table">
              <div className="table-head">
                <span>Rank</span>
                <span>Team</span>
                <span>Done</span>
                <span>Task progress</span>
                <span>CI signal</span>
              </div>
              {leaderboard?.leaderboard.map((entry) => (
                <div key={entry.teamId}>
                  <code>#{entry.rank}</code>
                  <strong>{entry.teamName}</strong>
                  <span>
                    {entry.progress.completedTasks}/{entry.progress.totalTasks}
                  </span>
                  <span>{entry.metrics.taskCompletionPercent}%</span>
                  <b title={entry.ci.trustLimitations.join(" ")}>
                    {entry.ci.status === "passed"
                      ? "Passed"
                      : entry.ci.status === "failed"
                        ? "Failed"
                        : entry.ci.status === "running"
                          ? "Running"
                          : "Unknown"}
                  </b>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
