"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  CheckCircle2,
  GitBranch,
  RefreshCw,
  Trash2,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, apiErrorMessage } from "@/lib/api";
import { useTeamRealtime } from "@/lib/use-realtime";
import type { Hackathon, Team, TeamMember } from "@/lib/types";
import { useAuth } from "./auth-provider";
import { PlanningBoard } from "./planning-board";
import { startRouteTransition } from "@/lib/route-navigation";

type Tab = "overview" | "planning" | "github";

export function TeamDetailWorkspace({ teamId }: { teamId: string }) {
  const router = useRouter();
  const auth = useAuth();
  const [team, setTeam] = useState<Team | null>(null);
  const [hackathon, setHackathon] = useState<Hackathon | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [memberId, setMemberId] = useState("");
  const [memberRole, setMemberRole] = useState<"admin" | "member">("member");
  const [collaborator, setCollaborator] = useState("");
  const [topics, setTopics] = useState("hackathon,azync");
  const [invites, setInvites] = useState<
    Array<{ id: string; code: string; expiresAt: string }>
  >([]);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const [detail, roster] = await Promise.all([
        api.teams.get(teamId),
        api.teams.members(teamId),
      ]);
      // The roster is required by planning. Commit it before optional admin
      // invite loading, which is allowed to fail independently.
      setTeam(detail);
      setMembers(roster);
      setTeamName(detail.name);
      setWalletAddress(detail.walletAddress || "");
      setHackathon(await api.hackathons.get(detail.hackathonId));

      if (
        !roster.some(
          (member) =>
            member.userId === auth.user?.id && member.role === "admin",
        )
      ) {
        setInvites([]);
        setInviteError(null);
        return;
      }
      try {
        setInvites(await api.teams.invites(teamId));
        setInviteError(null);
      } catch (reason) {
        setInvites([]);
        setInviteError(apiErrorMessage(reason));
      }
    } catch (reason) {
      setError(apiErrorMessage(reason));
    }
  }, [teamId, auth.user?.id]);
  useEffect(() => {
    void load();
  }, [load]);
  useTeamRealtime(teamId, load);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const myMembership = members.find((item) => item.userId === auth.user?.id);
  const isAdmin = myMembership?.role === "admin";
  const registered = Boolean(
    team?.registrations?.some((item) => item.hackathonId === team.hackathonId),
  );
  const remainingMs = hackathon
    ? new Date(hackathon.endDate).getTime() - now
    : 0;
  const ended = Boolean(hackathon && remainingMs <= 0);
  const countdown = ended
    ? "Ended"
    : `${Math.floor(remainingMs / 86_400_000)}d ${Math.floor((remainingMs % 86_400_000) / 3_600_000)}h ${Math.floor((remainingMs % 3_600_000) / 60_000)}m remaining`;

  async function run(operation: () => Promise<unknown>, success: string) {
    try {
      setBusy(true);
      setError(null);
      setNotice(null);
      await operation();
      setNotice(success);
      await load();
    } catch (reason) {
      setError(apiErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  async function addMember(event: FormEvent) {
    event.preventDefault();
    await run(
      () => api.teams.addMember(teamId, memberId, memberRole),
      "The member has been added.",
    );
    setMemberId("");
  }
  async function addCollaborator(event: FormEvent) {
    event.preventDefault();
    await run(
      () => api.github.addCollaborator(teamId, collaborator, "push"),
      "The GitHub collaborator invitation has been sent.",
    );
    setCollaborator("");
  }
  async function deleteTeam() {
    try {
      setBusy(true);
      setError(null);
      await api.teams.remove(teamId);
      startRouteTransition("/teams");
      router.replace("/teams");
    } catch (reason) {
      setError(apiErrorMessage(reason));
      setBusy(false);
    }
  }

  if (!team)
    return (
      <main className="centered-state">
        <span className="activity-dot" />
        <strong>Loading team…</strong>
        {error && <p>{error}</p>}
      </main>
    );
  return (
    <main className="page-shell ops-page team-page">
      <header className="ops-heading team-heading">
        <div>
          <p className="eyebrow">
            Team workspace · {myMembership?.role || "member"}
          </p>
          <h1>{team.name}</h1>
          <p className="mono">{team.id}</p>
        </div>
        <div className="heading-actions">
          <button
            className="button secondary"
            type="button"
            disabled={busy || registered}
            onClick={() =>
              void run(
                () => api.hackathons.register(team.hackathonId, team.id),
                "The team has been registered for the hackathon.",
              )
            }
          >
            {registered
              ? "Registered for hackathon"
              : "Register team for hackathon"}
          </button>
          <Link className="button secondary" href={`/submit?team=${team.id}`}>
            Submit project
          </Link>
          {team.repository && (
            <a
              className="button primary"
              href={team.repository.url}
              target="_blank"
              rel="noreferrer"
            >
              Repository <ArrowUpRight size={15} />
            </a>
          )}
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
      {hackathon && (
        <div className={`deadline-banner ${ended ? "ended" : ""}`}>
          <span>
            <strong>{hackathon.name}</strong>
            <small>
              {new Date(hackathon.startDate).toLocaleDateString("en-US")} →{" "}
              {new Date(hackathon.endDate).toLocaleString("en-US")}
            </small>
          </span>
          <b>{countdown}</b>
        </div>
      )}
      <nav className="tab-bar" aria-label="Team sections">
        {(["overview", "planning", "github"] as Tab[]).map((item) => (
          <button
            type="button"
            className={tab === item ? "active" : ""}
            onClick={() => setTab(item)}
            key={item}
          >
            {item === "overview"
              ? "Member"
              : item === "planning"
                ? "Planning Canvas"
                : "GitHub & Webhook"}
          </button>
        ))}
      </nav>
      {tab === "overview" && (
        <div className="workspace-columns wide-left">
          <section className="ops-panel">
            <header>
              <div>
                <p className="eyebrow">Roster</p>
                <h2>Members</h2>
              </div>
              <span className="count-badge">{members.length}</span>
            </header>
            <div className="member-table">
              {members.map((member) => (
                <div key={member.userId}>
                  <span className="avatar-fallback">
                    {(member.user.name || member.user.githubUsername)
                      .slice(0, 1)
                      .toUpperCase()}
                  </span>
                  <span>
                    <strong>
                      {member.user.name || member.user.githubUsername}
                    </strong>
                    <small>@{member.user.githubUsername}</small>
                  </span>
                  <code>{member.role}</code>
                  {(isAdmin || member.userId === auth.user?.id) && (
                    <button
                      type="button"
                      className="bare-button danger-text"
                      disabled={busy}
                      onClick={() => {
                        if (
                          confirm(
                            `Remove ${member.user.githubUsername} from the team?`,
                          )
                        )
                          void run(
                            () => api.teams.removeMember(teamId, member.userId),
                            "The roster has been updated.",
                          );
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
          <div className="side-stack">
            <section className="ops-panel form-panel">
              <header>
                <div>
                  <p className="eyebrow">Admin action</p>
                  <h2>Add member</h2>
                </div>
                <UserPlus size={18} />
              </header>
              <form className="compact-form" onSubmit={addMember}>
                <label>
                  <span>User ID</span>
                  <input
                    required
                    value={memberId}
                    onChange={(e) => setMemberId(e.target.value)}
                    placeholder="ID from the user profile"
                  />
                </label>
                <label>
                  <span>Role</span>
                  <select
                    value={memberRole}
                    onChange={(e) =>
                      setMemberRole(e.target.value as "admin" | "member")
                    }
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
                <button className="button primary" disabled={!isAdmin || busy}>
                  {isAdmin ? "Add to team" : "Admin only"}
                </button>
              </form>
              <div className="panel-note">
                <UsersRound size={15} /> Members must complete OAuth at least
                once to receive a user ID.
              </div>
            </section>
            <section className="ops-panel form-panel">
              <header>
                <div>
                  <p className="eyebrow">Team settings</p>
                  <h2>Identity & wallet</h2>
                </div>
              </header>
              <form
                className="compact-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(
                    () =>
                      api.teams.update(teamId, {
                        name: teamName,
                        walletAddress: walletAddress || undefined,
                      }),
                    "The team has been updated.",
                  );
                }}
              >
                <label>
                  <span>Team name</span>
                  <input
                    required
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                  />
                </label>
                <label>
                  <span>Default wallet</span>
                  <input
                    value={walletAddress}
                    onChange={(e) => setWalletAddress(e.target.value)}
                  />
                </label>
                <button
                  className="button secondary"
                  disabled={!isAdmin || busy}
                >
                  Save changes
                </button>
                <button
                  type="button"
                  className="bare-button danger-text"
                  disabled={!isAdmin || busy}
                  onClick={() => {
                    if (confirm(`Permanently delete team “${team.name}”?`))
                      void deleteTeam();
                  }}
                >
                  <Trash2 size={14} /> Delete team
                </button>
              </form>
            </section>
          </div>
        </div>
      )}
      {tab === "planning" && (
        <PlanningBoard
          teamId={teamId}
          members={members}
          deadline={hackathon?.endDate}
        />
      )}
      {tab === "github" && (
        <div className="workspace-columns wide-left">
          <section className="ops-panel repo-panel">
            <header>
              <div>
                <p className="eyebrow">Repository state</p>
                <h2>{team.repository?.fullName || "No repository yet"}</h2>
              </div>
              <GitBranch size={18} />
            </header>
            {team.repository ? (
              <dl className="detail-ledger">
                <div>
                  <dt>Provisioning</dt>
                  <dd data-testid="repository-provisioning-status">
                    {team.repository.provisioningStatus || "READY"}
                  </dd>
                </div>
                <div>
                  <dt>Visibility</dt>
                  <dd>
                    {team.repository.isPrivate === false
                      ? "attention"
                      : "private"}
                  </dd>
                </div>
                <div>
                  <dt>Webhook</dt>
                  <dd>
                    <span
                      className={`status-label ${team.repository.webhookConfigured ? "active" : ""}`}
                    >
                      {team.repository.webhookConfigured
                        ? "configured"
                        : "attention"}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Last commit</dt>
                  <dd>
                    <code>
                      {team.repository.lastCommitSha?.slice(0, 12) || "—"}
                    </code>
                  </dd>
                </div>
                <div>
                  <dt>Last push</dt>
                  <dd>
                    {team.repository.lastPushAt
                      ? new Date(team.repository.lastPushAt).toLocaleString(
                          "en-US",
                        )
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Workflow</dt>
                  <dd>
                    {team.repository.lastCommitSha &&
                    team.repository.workflowRuns?.[0]?.headSha !==
                      team.repository.lastCommitSha
                      ? "No CI run for the current commit"
                      : `${team.repository.lastWorkflowStatus || "—"} / ${team.repository.lastWorkflowConclusion || "—"}`}
                  </dd>
                </div>
              </dl>
            ) : (
              <div className="action-block">
                <p>
                  Start Building creates a private repository in the
                  organization, invites team members, and configures the
                  webhook.
                </p>
                <label>
                  <span>Topics, separated by commas</span>
                  <input
                    value={topics}
                    onChange={(e) => setTopics(e.target.value)}
                  />
                </label>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () =>
                        api.github.createRepository(
                          teamId,
                          `Repository for ${team.name}`,
                          topics
                            .split(",")
                            .map((v) => v.trim())
                            .filter(Boolean),
                        ),
                      "The repository has been created.",
                    )
                  }
                >
                  Start building
                </button>
              </div>
            )}
            {team.repository && (
              <div className="panel-actions">
                <button
                  className="button secondary"
                  disabled={!isAdmin || busy}
                  onClick={() =>
                    void run(
                      () => api.github.setupWebhook(teamId),
                      "The webhook has been reconfigured.",
                    )
                  }
                >
                  <RefreshCw size={15} /> Retry webhook
                </button>
              </div>
            )}
          </section>
          <section className="ops-panel form-panel">
            <header>
              <div>
                <p className="eyebrow">Repository access</p>
                <h2>Add collaborator</h2>
              </div>
              <UserPlus size={18} />
            </header>
            <form className="compact-form" onSubmit={addCollaborator}>
              <label>
                <span>GitHub username</span>
                <input
                  required
                  value={collaborator}
                  onChange={(e) => setCollaborator(e.target.value)}
                  placeholder="octocat"
                />
              </label>
              <button
                className="button primary"
                disabled={!isAdmin || !team.repository || busy}
              >
                Send invitation
              </button>
            </form>
            {isAdmin && (
              <div className="panel-actions">
                {team.repository && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => api.github.syncCollaborators(teamId),
                        "GitHub permissions have been synchronized with the team and judges.",
                      )
                    }
                  >
                    <RefreshCw size={15} /> Sync GitHub permissions
                  </button>
                )}
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const invite = await api.teams.createInvite(teamId, 24);
                      await navigator.clipboard?.writeText(
                        `${window.location.origin}/teams/invites/${invite.code}`,
                      );
                    }, "A 24-hour invitation link has been created and copied.")
                  }
                >
                  Create and copy 24h invite
                </button>
                {invites.map((invite) => (
                  <div key={invite.id}>
                    <code>{invite.expiresAt}</code>
                    <button
                      className="bare-button danger-text"
                      onClick={() =>
                        void run(
                          () => api.teams.revokeInvite(teamId, invite.id),
                          "The invitation has been revoked.",
                        )
                      }
                    >
                      Revoke
                    </button>
                  </div>
                ))}
                {inviteError && (
                  <div className="notice danger" role="alert">
                    Could not load active invitations: {inviteError}
                  </div>
                )}
              </div>
            )}
            {team.repository?.webhookError && (
              <div className="notice danger">
                {team.repository.webhookError}
              </div>
            )}
            {team.repository?.provisioningError && (
              <div
                className="notice danger"
                role="alert"
                data-testid="repository-provisioning-error"
              >
                {team.repository.provisioningError}
              </div>
            )}
            {team.repository?.collaborators &&
              team.repository.collaborators.length > 0 && (
                <ul
                  className="detail-ledger"
                  data-testid="repository-collaborators"
                >
                  {team.repository.collaborators.map((entry) => (
                    <li key={entry.username}>
                      <code>{entry.username}</code> — {entry.permission}:{" "}
                      {entry.status}
                      {entry.error ? ` (${entry.error})` : ""}
                    </li>
                  ))}
                </ul>
              )}
          </section>
        </div>
      )}
    </main>
  );
}
