import "server-only";
import { z } from "zod";
import { polatRuntimeContextSchema, polatSalesInputSchema, type PolatResponseCommand } from "@gold-revenue-os/contracts";
import { FakePolatTransport, runPolatResponseFixture, type PolatFixtureResponseStore } from "@gold-revenue-os/domain";

type CampaignDatabase = { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { code?: string } | null }> };
const reservation = z.strictObject({ state: z.literal("RESERVED"), job_id: z.uuid(), lease_token: z.uuid(), conversation_id: z.uuid(), source_message_id: z.uuid(),
  source_hash: z.string().regex(/^[a-f0-9]{64}$/u), generation: z.string().regex(/^[1-9][0-9]*$/u) });

/** No route, cron, credential loader, or real transport. Reuses the accepted model/profile/QA engine. */
export async function runCampaignFixtureCycle(input: { db: CampaignDatabase; tenantId: string; campaignId: string; workerId: string; transport: FakePolatTransport }) {
  if (!(input.transport instanceof FakePolatTransport)) throw Error("CAMPAIGN_FAKE_TRANSPORT_REQUIRED");
  const tenant = z.uuid().parse(input.tenantId), campaign = z.uuid().parse(input.campaignId);
  async function rpc(name: string, args: Record<string, unknown>) {
    const result = await input.db.rpc(name, { target_tenant_id: tenant, ...args });
    if (result.error) throw Error("CAMPAIGN_RPC:" + (result.error.code ?? "UNAVAILABLE"));
    return result.data;
  }
  await rpc("campaign_schedule_v1", { campaign_id_value: campaign, limit_value: 25 });
  const raw = await rpc("campaign_claim_fixture_v1", { campaign_id_value: campaign, worker_id_value: input.workerId });
  const claim = reservation.safeParse(raw);
  if (!claim.success) return { state: z.object({ state: z.string().max(40) }).parse(raw).state, delivery: "NOT_SENT", financial_authority: "NONE" } as const;
  const job = claim.data, scope = { job_id_value: job.job_id, lease_token_value: job.lease_token };
  const prepared = z.strictObject({ context: polatRuntimeContextSchema, sales: polatSalesInputSchema }).parse(await rpc("campaign_context_fixture_v1", scope));
  const conversation = prepared.context.input;
  if (conversation.tenant_id !== tenant || conversation.conversation_id !== job.conversation_id || conversation.source_message_id !== job.source_message_id) throw Error("CAMPAIGN_SOURCE_SCOPE");
  function bind(command: PolatResponseCommand) {
    if (command.tenant_id !== tenant || command.operation_id !== job.job_id || command.conversation_id !== job.conversation_id
      || command.message_id !== job.source_message_id || command.generation !== job.generation || command.source_hash !== job.source_hash) throw Error("CAMPAIGN_COMMAND_SCOPE");
  }
  const store: PolatFixtureResponseStore = {
    mode: "SYNTHETIC",
    prepare: async command => { bind(command); return rpc("campaign_prepare_fixture_v1", { ...scope, body_hash_value: command.body_hash }); },
    canDispatch: async command => { bind(command); return await rpc("campaign_dispatch_fixture_v1", scope) === true; },
    record: async receipt => rpc("campaign_finish_fixture_v1", { ...scope, receipt_value: JSON.stringify(receipt) }),
    hold: async value => {
      if (value.tenant_id !== tenant || value.message_id !== job.source_message_id || value.generation !== job.generation) throw Error("CAMPAIGN_HOLD_SCOPE");
      return rpc("campaign_hold_fixture_v1", { ...scope, reason_value: value.reason });
    },
  };
  return runPolatResponseFixture({ input: conversation, sales: prepared.sales, operationId: job.job_id, generation: job.generation, store, transport: input.transport });
}
