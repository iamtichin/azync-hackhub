import { AuthGate } from "@/components/auth-gate";
import { TeamsWorkspace } from "@/components/teams-workspace";

export default function TeamsPage() {
  return (
    <AuthGate>
      <TeamsWorkspace />
    </AuthGate>
  );
}
