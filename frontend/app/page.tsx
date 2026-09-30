"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays, GitCommit, Scale } from "lucide-react";
import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "@/lib/api";
import type { Hackathon } from "@/lib/types";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function HomePage() {
  const [hackathons, setHackathons] = useState<Hackathon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.hackathons
      .list()
      .then(setHackathons)
      .catch((reason) => setError(apiErrorMessage(reason)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="page-shell">
      <section className="home-intro">
        <div>
          <p className="eyebrow">Hackathon operations</p>
          <h1>One place to build, prove, and review projects.</h1>
          <p className="lede">
            Track real progress, preserve evidence from GitHub and Solana, and
            give judges an analysis they can verify.
          </p>
        </div>
        <div className="intro-actions">
          <Link className="button primary" href="/judge">
            Open Judge workspace <ArrowRight size={17} />
          </Link>
          <Link className="button secondary" href="/submit">
            Submit project
          </Link>
        </div>
      </section>

      <section className="process-strip" aria-label="Product flow">
        <div>
          <GitCommit size={18} />
          <span>
            <strong>Repository</strong>Revision and CI activity
          </span>
        </div>
        <div>
          <Scale size={18} />
          <span>
            <strong>Evidence brief</strong>Claims linked to sources
          </span>
        </div>
        <div>
          <CalendarDays size={18} />
          <span>
            <strong>Human decision</strong>AI assists; judges decide
          </span>
        </div>
      </section>

      <section className="section-heading">
        <div>
          <p className="eyebrow">In progress</p>
          <h2>Hackathons</h2>
        </div>
        <span className="muted">Live data from the backend</span>
      </section>

      {loading && (
        <div className="state-line" role="status">
          Syncing hackathons…
        </div>
      )}
      {error && (
        <div className="notice danger" role="alert">
          {error}
        </div>
      )}
      {!loading && !error && hackathons.length === 0 && (
        <div className="empty-state">
          <strong>No active hackathons yet</strong>
          <p>
            New hackathons will appear here after an organizer publishes them.
          </p>
        </div>
      )}
      <div className="event-list">
        {hackathons.map((hackathon) => (
          <article className="event-row" key={hackathon.id}>
            <div className="event-date">
              <span>{new Date(hackathon.endDate).getDate()}</span>
              <small>
                {new Intl.DateTimeFormat("en-US", { month: "short" }).format(
                  new Date(hackathon.endDate),
                )}
              </small>
            </div>
            <div className="event-main">
              <span className="status-label active">Accepting submissions</span>
              <h3>{hackathon.name}</h3>
              <p>Ends {formatDate(hackathon.endDate)}</p>
            </div>
            <dl className="event-stats">
              <div>
                <dt>Teams</dt>
                <dd>{hackathon._count?.registrations ?? "—"}</dd>
              </div>
              <div>
                <dt>Submission</dt>
                <dd>{hackathon._count?.submissions ?? "—"}</dd>
              </div>
            </dl>
            <Link className="text-link" href={`/hackathons/${hackathon.id}`}>
              View hackathon <ArrowRight size={15} />
            </Link>
          </article>
        ))}
      </div>
    </main>
  );
}
