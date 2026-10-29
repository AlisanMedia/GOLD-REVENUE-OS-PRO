import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { FakePolatTransport } from "../../packages/domain/src/polat-response";
vi.mock("server-only", () => ({}));
import { runCampaignFixtureCycle } from "../../apps/web/src/lib/polat/campaign-runtime";

const connection = process.env.CAMPAIGN_DISPOSABLE_DB_URL;
const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
const tenant = (n: number) => `61b02000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const campaign = (n: number) => `61b09000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const allowed = new Set(["campaign_schedule_v1", "campaign_claim_fixture_v1", "campaign_context_fixture_v1", "campaign_prepare_fixture_v1", "campaign_dispatch_fixture_v1", "campaign_finish_fixture_v1", "campaign_hold_fixture_v1"]);
function sql(text: string) {
  return execFileSync("psql", [connection!, "-X", "-Atq", "-v", "ON_ERROR_STOP=1"], { input: text, encoding: "utf8", timeout: 15000, maxBuffer: 2 * 1024 * 1024 }).trim();
}
const query = (text: string) => JSON.parse(sql(text)) as unknown;
const client = () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
  if (!allowed.has(name)) throw Error("CAMPAIGN_TEST_RPC_DENIED");
  const parameters = Object.entries(args).map(([key, value]) => {
    if (!/^[a-z_]+$/u.test(key)) throw Error("CAMPAIGN_TEST_ARGUMENT_INVALID");
    return key + "=>" + (typeof value === "number" ? String(value) : quote(String(value)));
  }).join(",");
  return { data: query(`begin;set local role service_role;select to_jsonb(public.${name}(${parameters}));commit;`), error: null };
} });
function setup(n: number, text = "How much is membership?") {
  const helpers = readFileSync("supabase/tests/helpers/campaign_fixtures.sql", "utf8").replace("\\ir polat_inbound_fixtures.sql", () => readFileSync("supabase/tests/helpers/polat_inbound_fixtures.sql", "utf8"));
  sql(`begin;${helpers}select pg_temp.campaign_setup(${n});select public.ingest_telegram_message('${tenant(n)}','campaign-e2e-${n}','2','710000${n}','710000${n}',null,'Synthetic',null,${quote(text)},null,clock_timestamp());commit;`);
}
function retire(n: number) {
  sql(`update private.sales_campaigns set state='STOPPED'where tenant_id='${tenant(n)}';update private.polat_runtime_profiles set enabled=false where tenant_id='${tenant(n)}';update private.polat_conversation_controls set enabled=false where tenant_id='${tenant(n)}';update public.tenants set status='suspended'where id='${tenant(n)}';`);
}
function cycle(n: number, transport: FakePolatTransport, db = client()) {
  return runCampaignFixtureCycle({ db, tenantId: tenant(n), campaignId: campaign(n), workerId: `campaign_worker_${n}`, transport });
}

describe.runIf(Boolean(connection))("campaign policy through native Polat QA, actual PG17 and fake transport", () => {
  beforeAll(() => {
    const url = new URL(connection!);
    if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || !url.port || !/^\/(?:postgres|goldcampaign_[a-z0-9_]+)$/u.test(url.pathname)) throw Error("CAMPAIGN_DISPOSABLE_PG17_ONLY");
    expect(query("select to_jsonb(current_setting('server_version_num')::int/10000)")).toBe(17);
  });
  it("batch -> ACTIVE -> approved price -> fake ACK; restart cannot replay completed work", async () => {
    const n = 9961; setup(n); const transport = new FakePolatTransport(["ACK"]);
    try {
      const result = await cycle(n, transport);
      expect(result.state).toBe("AI_RESPONDED");
      expect(result.delivery).toBe("FAKE_ACKNOWLEDGED");
      expect(transport.effects).toHaveLength(1);
      expect(query(`select to_jsonb(w.state)from private.polat_inbound_work w join private.campaign_jobs x on x.tenant_id=w.tenant_id and x.source_message_id=w.message_id where x.tenant_id='${tenant(n)}'`)).toBe("AI_RESPONDED");
      expect((await cycle(n, new FakePolatTransport(["ACK"]))).state).toBe("EMPTY");
      expect(query(`select to_jsonb(attempts)from private.sales_campaigns where id='${campaign(n)}'`)).toBe(1);
      expect(query(`select to_jsonb(count(*))from public.messages where tenant_id='${tenant(n)}'and direction='outbound'`)).toBe(0);
      expect(query(`select to_jsonb(count(*))from private.verified_payment_receipts where tenant_id='${tenant(n)}'`)).toBe(0);
      // A later real synthetic inbound preserves only the preceding acknowledged output.
      sql(`update public.scheduled_jobs set completed_at=clock_timestamp()-interval '2 minutes',locked_at=clock_timestamp()-interval '2 minutes'where tenant_id='${tenant(n)}'and status='completed';select public.ingest_telegram_message('${tenant(n)}','campaign-context-followup-${n}','3','710000${n}','710000${n}',null,'Synthetic',null,'Thanks',null,clock_timestamp());`);
      const snapshots: unknown[] = [], base = client();
      const withHistory = { rpc: async (name: string, args: Record<string, unknown>) => { const value = await base.rpc(name, args); if (name === "campaign_context_fixture_v1") snapshots.push(value.data); return value; } };
      const follow = await cycle(n, new FakePolatTransport(["ACK"]), withHistory);
      expect(follow.state).toBe("AI_RESPONDED");
      expect(snapshots).toHaveLength(1);
      expect(JSON.stringify(snapshots[0])).toContain("FAKE_ACKNOWLEDGED");
      expect(JSON.stringify(snapshots[0])).toContain("10.00 USD");
    } finally { retire(n); }
  }, 30000);
  it("UNKNOWN after an effect pauses, retains liability and survives a new transport/process", async () => {
    const n = 9962; setup(n); const transport = new FakePolatTransport(["UNKNOWN_AFTER_EFFECT"]);
    try {
      expect((await cycle(n, transport)).state).toBe("DELIVERY_UNKNOWN");
      expect(transport.effects).toHaveLength(1);
      const restarted = new FakePolatTransport(["ACK"]);
      expect((await cycle(n, restarted)).state).toBe("HELD");
      expect(restarted.effects).toHaveLength(0);
      expect(query(`select jsonb_build_object('state',state,'attempts',attempts,'liability',reserved_liability::text)from private.sales_campaigns where id='${campaign(n)}'`)).toEqual({ state: "PAUSED", attempts: 1, liability: "0.010000" });
    } finally { retire(n); }
  }, 30000);
  it.each(["OPT_OUT", "PAUSE", "HUMAN"])("%s committed after preparation fences the actual fake dispatch", async reason => {
    const n = reason === "OPT_OUT" ? 9963 : reason === "PAUSE" ? 9964 : 9965; setup(n);
    const base = client(), transport = new FakePolatTransport(["ACK"]);
    const raced = { rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "campaign_dispatch_fixture_v1") {
        if (reason === "OPT_OUT") sql(`select public.ingest_telegram_message('${tenant(n)}','campaign-opt-out-race-${n}','3','710000${n}','710000${n}',null,'Synthetic',null,'Do not contact me again',null,clock_timestamp());`);
        else if (reason === "PAUSE") sql(`update private.sales_campaigns set state='PAUSED',revision=revision+1 where id='${campaign(n)}';`);
        else sql(`update public.conversations set runtime_mode='HUMAN_TAKEOVER',human_takeover=true where tenant_id='${tenant(n)}';`);
      }
      return base.rpc(name, args);
    } };
    try {
      const result = await cycle(n, transport, raced);
      // Preserve the native ownership/generation result, including a real handoff obligation.
      expect(result.state).toBe(reason === "PAUSE" ? "BLOCKED_WITH_REASON" : "HUMAN_HANDOFF_PENDING");
      expect(query(`select to_jsonb(w.state)from private.polat_inbound_work w join private.campaign_jobs x on x.tenant_id=w.tenant_id and x.source_message_id=w.message_id where x.tenant_id='${tenant(n)}'`)).toBe(result.state);
      expect(transport.effects).toHaveLength(0);
      expect(query(`select to_jsonb(attempts)from private.sales_campaigns where id='${campaign(n)}'`)).toBe(1);
    } finally { retire(n); }
  }, 30000);
  it("an unverified payment claim reaches the existing QA hold, never a receipt/access success", async () => {
    const n = 9966; setup(n, "I paid. Is my payment verified?"); const transport = new FakePolatTransport(["ACK"]);
    try {
      expect((await cycle(n, transport)).state).toBe("HUMAN_HANDOFF_PENDING");
      expect(transport.effects).toHaveLength(0);
      expect(query(`select to_jsonb(count(*))from public.subscriptions where tenant_id='${tenant(n)}'`)).toBe(0);
      expect(query(`select to_jsonb(count(*))from public.scheduled_jobs where tenant_id='${tenant(n)}'and status='dead_letter'and last_error_code='QA_HOLD'`)).toBe(1);
    } finally { retire(n); }
  }, 30000);
});
