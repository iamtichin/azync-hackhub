import { AuthGate } from "@/components/auth-gate";
import { SubmissionsWorkspace } from "@/components/submissions-workspace";
export default function SubmissionsPage() {
  return (
    <AuthGate>
      <SubmissionsWorkspace />
    </AuthGate>
  );
}
