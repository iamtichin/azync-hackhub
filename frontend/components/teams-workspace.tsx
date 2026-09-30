"use client";

import Link from "next/link";
import { ArrowRight, Plus, UsersRound } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { api, apiErrorMessage } from "@/lib/api";
import type { Hackathon, Team } from "@/lib/types";

export function TeamsWorkspace() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [hackathons, setHackathons] = useState<Hackathon[]>([]);
  const [name, setName] = useState("");
  const [hackathonId, setHackathonId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const [memberships, events] = await Promise.all([
        api.teams.mine(),
        api.hackathons.list(),
      ]);
      setTeams(memberships);
      setHackathons(events);
      setHackathonId((value) => value || events[0]?.id || "");
    } catch (reason) {
      setError(apiErrorMessage(reason));
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    try {
      setSaving(true);
      setError(null);
      await api.teams.create({ name, hackathonId });
      setName("");
      await load();
    } catch (reason) {
      setError(apiErrorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="page-shell ops-page">
      <header className="ops-heading">
        <div>
          <p className="eyebrow">Team operations</p>
          <h1>Team workspace</h1>
          <p>
            Create a team and manage members, the repository, and the execution
            plan.
          </p>
        </div>
      </header>
      {error && (
        <div className="notice danger" role="alert">
          {error}
        </div>
      )}
      <div className="workspace-columns wide-left">
        <section className="ops-panel">
          <header>
            <div>
              <p className="eyebrow">Memberships</p>
              <h2>My teams</h2>
            </div>
            <span className="count-badge">{teams.length}</span>
          </header>
          <div className="data-rows">
            {teams.length === 0 && (
              <p className="panel-empty">
                No teams yet. Create your first team on the right.
              </p>
            )}
            {teams.map((team) => (
              <Link
                className="data-row"
                href={`/teams/${team.id}`}
                key={team.id}
              >
                <span className="row-icon">
                  <UsersRound size={16} />
                </span>
                <span>
                  <strong>{team.name}</strong>
                  <small>
                    {team.role} · {team.submissions?.length ?? 0} submission
                  </small>
                </span>
                <ArrowRight size={15} />
              </Link>
            ))}
          </div>
        </section>
        <section className="ops-panel form-panel">
          <header>
            <div>
              <p className="eyebrow">New team</p>
              <h2>Open a new workspace</h2>
            </div>
            <Plus size={18} />
          </header>
          <form className="compact-form" onSubmit={create}>
            <label>
              <span>Team name</span>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Example: Delta Builders"
              />
            </label>
            <label>
              <span>Hackathon</span>
              <select
                required
                value={hackathonId}
                onChange={(e) => setHackathonId(e.target.value)}
              >
                <option value="">Select hackathon</option>
                {hackathons.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button primary"
              disabled={saving || !name.trim() || !hackathonId}
            >
              {saving ? "Creating…" : "Create team"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
