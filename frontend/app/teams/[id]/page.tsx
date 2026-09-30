import { AuthGate } from "@/components/auth-gate";
import { TeamDetailWorkspace } from "@/components/team-detail-workspace";

export default async function TeamPage({ params }: PageProps<"/teams/[id]">) {
  const { id } = await params;
  return (
    <AuthGate>
      <TeamDetailWorkspace teamId={id} />
    </AuthGate>
  );
}
