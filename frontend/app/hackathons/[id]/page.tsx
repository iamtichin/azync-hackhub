import { HackathonDetail } from "@/components/hackathon-detail";

export default async function HackathonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <HackathonDetail id={id} />;
}
