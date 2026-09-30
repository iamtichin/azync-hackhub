"use client";

import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  Scale,
  Trophy,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiErrorMessage } from "@/lib/api";
import { useHackathonRealtime } from "@/lib/use-realtime";
import type { Hackathon, Leaderboard, Submission, Team } from "@/lib/types";
import { useAuth } from "./auth-provider";

export function HackathonDetail({ id }: { id: string }) {
  const auth = useAuth();
  const [event, setEvent] = useState<Hackathon | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [submissionsLoading, setSubmissionsLoading] = useState(true);
  const [submissionsError, setSubmissionsError] = useState<string | null>(null);
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [boardLoading, setBoardLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const boardRequest = useRef(0);
  const detailRequest = useRef(0);

  const refreshBoard = useCallback(async () => {
    const requestId = ++boardRequest.current;
    setBoardLoading(true);
    try {
      const latest = await api.hackathons.leaderboard(id);
      if (requestId === boardRequest.current) {
        setBoard(latest);
        setBoardError(null);
      }
    } catch (reason) {
      if (requestId === boardRequest.current)
        setBoardError(apiErrorMessage(reason));
    } finally {
      if (requestId === boardRequest.current) setBoardLoading(false);
    }
  }, [id, auth.sessionVersion]);

  const load = useCallback(() => {
    const requestId = ++detailRequest.current;
    setTeamsLoading(auth.hasToken);
    setTeamsError(null);
    setSubmissionsLoading(auth.hasToken);
    setSubmissionsError(null);
    void api.hackathons
      .get(id)
      .then((detail) => {
        if (requestId !== detailRequest.current) return;
        setEvent(detail);
        setError(null);
      })
      .catch((reason) => {
        if (requestId === detailRequest.current)
          setError(apiErrorMessage(reason));
      });
    if (auth.hasToken) {
      void api.hackathons
        .teams(id)
        .then((rows) => {
          if (requestId !== detailRequest.current) return;
          setTeams(rows);
          setTeamsError(null);
        })
        .catch((reason) => {
          if (requestId === detailRequest.current)
            setTeamsError(apiErrorMessage(reason));
        })
        .finally(() => {
          if (requestId === detailRequest.current) setTeamsLoading(false);
        });
      void api.hackathons
        .submissions(id)
        .then((rows) => {
          if (requestId !== detailRequest.current) return;
          setSubmissions(rows);
          setSubmissionsError(null);
        })
        .catch((reason) => {
          if (requestId === detailRequest.current)
            setSubmissionsError(apiErrorMessage(reason));
        })
        .finally(() => {
          if (requestId === detailRequest.current) setSubmissionsLoading(false);
        });
    }
  }, [id, auth.hasToken, auth.sessionVersion]);
  useEffect(() => {
    setEvent(null);
    setError(null);
    setTeams([]);
    setSubmissions([]);
    setBoard(null);
    setBoardError(null);
    void load();
    void refreshBoard();
    return () => {
      boardRequest.current += 1;
      detailRequest.current += 1;
    };
  }, [load, refreshBoard]);
  useHackathonRealtime(id, refreshBoard);

  if (!event)
    return (
      <main className="centered-state">
        {error ? (
          <>
            <strong>Could not load this hackathon</strong>
            <p>{error}</p>
          </>
        ) : (
          <>
            <span className="activity-dot" />
            <strong>Loading hackathon…</strong>
          </>
        )}
      </main>
    );
  return (
    <main className="page-shell ops-page">
      <header className="event-hero">
        <div>
          <p className="eyebrow">Competition brief</p>
          <h1>{event.name}</h1>
          {event.description && <p>{event.description}</p>}
          <p>
            <CalendarDays size={15} />{" "}
            {new Date(event.startDate).toLocaleString("en-US")} →{" "}
            {new Date(event.endDate).toLocaleString("en-US")}
          </p>
        </div>
        <div className="heading-actions">
          <Link className="button secondary" href="/teams">
            Create team
          </Link>
          <Link
            className="button primary"
            href={`/submit?hackathon=${event.id}`}
          >
            Submit project <ArrowRight size={15} />
          </Link>
        </div>
      </header>
      <section className="metric-grid">
        <div>
          <UsersRound size={18} />
          <span>Registered teams</span>
          <strong>
            {auth.hasToken
              ? teamsLoading
                ? "…"
                : teamsError
                  ? "—"
                  : teams.length
              : (board?.leaderboard.length ?? "—")}
          </strong>
        </div>
        <div>
          <Trophy size={18} />
          <span>Submissions</span>
          <strong>
            {auth.hasToken
              ? submissionsLoading
                ? "…"
                : submissionsError
                  ? "—"
                  : submissions.length
              : "—"}
          </strong>
        </div>
        <div>
          <Scale size={18} />
          <span>Rules</span>
          <strong>{event.rules?.length ?? 0}</strong>
        </div>
        <div>
          <Scale size={18} />
          <span>Rubric criteria</span>
          <strong>{event.rubric?.length ?? 0}</strong>
        </div>
      </section>
      {auth.hasToken && teamsError && (
        <p className="notice warning" role="alert">
          Could not load teams: {teamsError}
        </p>
      )}
      {!!event.tracks?.length && (
        <section className="ops-panel">
          <header>
            <div>
              <p className="eyebrow">Tracks</p>
              <h2>Choose a focus</h2>
            </div>
          </header>
          <div className="criteria-list">
            {event.tracks.map((track) => (
              <article key={track.id}>
                <strong>{track.name}</strong>
                {track.description && <p>{track.description}</p>}
              </article>
            ))}
          </div>
        </section>
      )}
      <div className="workspace-columns">
        <section className="ops-panel">
          <header>
            <div>
              <p className="eyebrow">Eligibility</p>
              <h2>Rules</h2>
            </div>
            <code>{event.rulesVersion}</code>
          </header>
          <div className="criteria-list">
            {event.rules?.map((rule) => (
              <article key={rule.id}>
                <code>{rule.id}</code>
                <strong>{rule.name}</strong>
                <p>{rule.description}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="ops-panel">
          <header>
            <div>
              <p className="eyebrow">Evaluation</p>
              <h2>Rubric</h2>
            </div>
            <code>{event.rubricVersion}</code>
          </header>
          <div className="criteria-list">
            {event.rubric?.map((item) => (
              <article key={item.id}>
                <code>{Math.round(item.weight * 100)}%</code>
                <strong>{item.name}</strong>
                <p>
                  {item.description} · {item.minScore}–{item.maxScore}
                </p>
              </article>
            ))}
          </div>
        </section>
      </div>
      <section className="ops-panel leaderboard-panel">
        <header>
          <div>
            <p className="eyebrow">Live progress</p>
            <h2>Leaderboard</h2>
          </div>
        </header>
        {boardError && (
          <p className="notice warning" role="alert">
            Could not update the leaderboard: {boardError}
            {board ? " The data below is from the previous refresh." : ""}
          </p>
        )}
        {boardLoading && (
          <p className="panel-note" role="status">
            Updating leaderboard…
          </p>
        )}
        {!boardLoading && !boardError && board?.leaderboard.length === 0 && (
          <p className="panel-note">No teams are on the leaderboard yet.</p>
        )}
        {board?.definition && (
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
          {board?.leaderboard.map((entry) => (
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
      {auth.hasToken && (
        <section className="ops-panel">
          <header>
            <div>
              <p className="eyebrow">Entries</p>
              <h2>Submissions</h2>
            </div>
            <span className="count-badge">
              {submissionsLoading
                ? "…"
                : submissionsError
                  ? "—"
                  : submissions.length}
            </span>
          </header>
          {submissionsLoading && (
            <p className="panel-note" role="status">
              Loading submissions…
            </p>
          )}
          {submissionsError && (
            <p className="notice warning" role="alert">
              Could not load submissions: {submissionsError}
            </p>
          )}
          <div className="data-rows">
            {submissions.map((item) => (
              <div className="data-row" key={item.id}>
                <span className="row-index">
                  {item.status === "confirmed" ? "✓" : "…"}
                </span>
                <span>
                  <strong>{item.projectName}</strong>
                  <small>
                    {item.team?.name} · {item.description}
                  </small>
                </span>
                <a
                  className="text-link"
                  href={item.githubUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  GitHub
                </a>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
