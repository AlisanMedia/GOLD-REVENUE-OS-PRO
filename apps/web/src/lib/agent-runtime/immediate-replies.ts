import "server-only";
import { runDeterministicWorker } from "@/lib/agent-runtime/worker";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { drainAutomaticReplies } from "@/lib/messaging/automatic-replies";

// Each worker invocation still claims one task. An enabled conversation may
// finish up to three sequential turns within this webhook's 120s lifetime.
// Starting another invocation before 50s leaves room for its 25s generation,
// optional 25s rewrite, persistence and send. Cron remains bounded recovery.
export async function runImmediateConversationReplies(input: {
  deploymentRef: string;
  conversation: { tenantId: string; conversationId: string };
}): Promise<void> {
  const started = Date.now();
  const { data, error } = await createSupabaseAdminClient().from("conversations")
    .select("automatic_replies_enabled,runtime_mode,human_takeover")
    .eq("tenant_id", input.conversation.tenantId).eq("id", input.conversation.conversationId).maybeSingle();
  const enabled = !error && data?.automatic_replies_enabled === true && data.runtime_mode === "AI_ACTIVE" && data.human_takeover === false;
  const limit = enabled ? 3 : 1;
  for (let index = 0; index < limit; index += 1) {
    if (index > 0 && Date.now() - started >= 50_000) break;
    const result = await runDeterministicWorker(input);
    if (result.tasksClaimed === 0) break; // Another lease holder drains its own burst.
    // Source ordering also waits for the preceding queued send. Finish that
    // deterministic delivery before attempting to claim the next source.
    if (enabled) await drainAutomaticReplies(input.conversation);
  }
}
