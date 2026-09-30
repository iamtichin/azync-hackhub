import { AuthGate } from "@/components/auth-gate";
import { TeamDetailWorkspace } from "@/components/team-detail-workspace";

export default async function TeamPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AuthGate>
      <TeamDetailWorkspace teamId={id} />
    </AuthGate>
  );
}
