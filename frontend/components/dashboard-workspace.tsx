"use client";

import Link from "next/link";
import {
  ArrowRight,
  Bot,
  CalendarRange,
  GitBranch,
  ListChecks,
  UsersRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "@/lib/api";
import type { Hackathon, Team } from "@/lib/types";
import { useAuth } from "./auth-provider";

export function DashboardWorkspace() {
  const auth = useAuth();
  const [hackathons, setHackathons] = useState<Hackathon[]>([]);
  const [organized, setOrganized] = useState<Hackathon[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [solana, setSolana] = useState<{
    status?: string;
    network?: string;
    authority?: { sufficientForFees?: boolean };
    merkleTree?: { exists?: boolean };
  } | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.hackathons.list(true),
      api.hackathons.mine(),
      api.teams.mine(),
    ])
      .then(([events, ownedEvents, memberships]) => {
        if (!active) return;
        setHackathons(events);
        setOrganized(ownedEvents);
        setTeams(memberships);
      })
      .catch((reason) => {
        if (active) setError(apiErrorMessage(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    api.solana
      .health()
      .then((chain) => {
        if (active) setSolana(chain as typeof solana);
      })
      .catch(() => {
        if (active) setSolana(null);
      });

    return () => {
      active = false;
    };
  }, []);

  const active = hackathons.filter(
    (item) => new Date(item.endDate) >= new Date(),
  );

  if (loading)
    return (
      <main className="centered-state">
        <span className="activity-dot" />
        <strong>Preparing your workspace…</strong>
      </main>
    );
  return (
    <main className="page-shell ops-page">
      <header className="ops-heading">
        <div>
          <p className="eyebrow">Operations overview</p>
          <h1>Welcome, {auth.user?.name || auth.user?.githubUsername}</h1>
          <p>All your roles on one operating surface.</p>
        </div>
        <Link className="button primary" href="/teams/new">
          Create team <ArrowRight size={16} />
        </Link>
      </header>
      {error && <div className="notice danger">{error}</div>}
      <section className="metric-grid">
        <div>
          <CalendarRange size={18} />
          <span>Open hackathons</span>
          <strong>{active.length}</strong>
        </div>
        <div>
          <UsersRound size={18} />
          <span>My teams</span>
          <strong>{teams.length}</strong>
        </div>
        <div>
          <ListChecks size={18} />
          <span>Organizer scope</span>
          <strong>{organized.length}</strong>
        </div>
        <div>
          <Bot size={18} />
          <span>Solana {solana?.network || "devnet"}</span>
          <strong>
            {solana?.status === "ok" &&
            solana.authority?.sufficientForFees &&
            solana.merkleTree?.exists
              ? "Ready"
              : "Check"}
          </strong>
        </div>
      </section>
      <div className="workspace-columns">
        <section className="ops-panel">
          <header>
            <div>
              <p className="eyebrow">My teams</p>
              <h2>Active workspaces</h2>
            </div>
            <Link className="text-link" href="/teams">
              View all <ArrowRight size={14} />
            </Link>
          </header>
          <div className="data-rows">
            {teams.length === 0 && (
              <p className="panel-empty">You have not joined a team yet.</p>
            )}
            {teams.map((team) => (
              <Link
                href={`/teams/${team.id}`}
                className="data-row"
                key={team.id}
              >
                <span className="row-icon">
                  <GitBranch size={16} />
                </span>
                <span>
                  <strong>{team.name}</strong>
                  <small>
                    {team.role || "member"} · {team.submissions?.length ?? 0}{" "}
                    submission
                  </small>
                </span>
                <ArrowRight size={15} />
              </Link>
            ))}
          </div>
        </section>
        <section className="ops-panel">
          <header>
            <div>
              <p className="eyebrow">Organizer</p>
              <h2>Hackathons you manage</h2>
            </div>
            <Link className="text-link" href="/organizer">
              Manage <ArrowRight size={14} />
            </Link>
          </header>
          <div className="data-rows">
            {organized.length === 0 && (
              <p className="panel-empty">
                This account does not organize any hackathons yet.
              </p>
            )}
            {organized.map((item) => (
              <Link
                href={`/organizer?hackathon=${item.id}`}
                className="data-row"
                key={item.id}
              >
                <span className="row-index">
                  {String(item._count?.registrations ?? 0).padStart(2, "0")}
                </span>
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {item._count?.submissions ?? 0} submission · rules{" "}
                    {item.rulesVersion}
                  </small>
                </span>
                <ArrowRight size={15} />
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
