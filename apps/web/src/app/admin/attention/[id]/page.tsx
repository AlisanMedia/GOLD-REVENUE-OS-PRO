import { notFound } from "next/navigation";
import { z } from "zod";
import { escalationList } from "@/lib/escalations/admin";
import { hasAdminCapability } from "@/lib/admin/permissions";
import { getConversationDetail } from "@/lib/messaging/server";
import { EscalationCaseView } from "@/components/escalation-views";

export default async function EscalationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await escalationList(id);
  const c = data.cases[0];
  if (!c) notFound();
  const conversation = await getConversationDetail(c.conversation_id);
  return <EscalationCaseView data={data} userId={data.context.userId} canManage={hasAdminCapability(data.context.role, "escalations.manage")} conversation={conversation}/>;
}
