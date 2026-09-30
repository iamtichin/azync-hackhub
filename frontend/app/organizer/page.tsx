import { AuthGate } from "@/components/auth-gate";
import { OrganizerWorkspace } from "@/components/organizer-workspace";

export default function OrganizerPage() {
  return (
    <AuthGate title="Sign in with an organizer account">
      <OrganizerWorkspace />
    </AuthGate>
  );
}
