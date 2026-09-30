import { HackathonDetail } from "@/components/hackathon-detail";

export default async function HackathonPage({
  params,
}: PageProps<"/hackathons/[id]">) {
  const { id } = await params;
  return <HackathonDetail id={id} />;
}
