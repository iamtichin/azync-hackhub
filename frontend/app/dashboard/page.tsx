import { AuthGate } from "@/components/auth-gate";
import { DashboardWorkspace } from "@/components/dashboard-workspace";

export default function DashboardPage() {
  return (
    <AuthGate>
      <DashboardWorkspace />
    </AuthGate>
  );
}
