"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "./auth-gate";
import { api, apiErrorMessage } from "@/lib/api";

function InviteJoin({ code }: { code: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function join() {
    try {
      setBusy(true);
      setError(null);
      const result = await api.teams.joinInvite(code);
      router.replace(`/teams/${result.teamId}?registration=required`);
    } catch (reason) {
      setError(apiErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="centered-state">
      <strong>Join team</strong>
      <p>
        This invitation can be used once. Joining a team does not register it
        for a hackathon.
      </p>
      <button
        className="button primary"
        disabled={busy}
        onClick={() => void join()}
      >
        {busy ? "Joining…" : "Join team"}
      </button>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}

export function InviteRedemption({ code }: { code: string }) {
  return (
    <AuthGate title="Sign in with GitHub to use this team invitation">
      <InviteJoin code={code} />
    </AuthGate>
  );
}
