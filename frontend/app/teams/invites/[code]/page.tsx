import { InviteRedemption } from "@/components/invite-redemption";
export default async function InvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <InviteRedemption code={code} />;
}
