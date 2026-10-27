import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { disposablePolatDatabase, polatSqlClient } from "../helpers/polat-local-database";
const fixture = vi.hoisted(() => ({ client: null as ReturnType<typeof polatSqlClient> | null, botKey: "", founder: "", representative: "", connection: "", metadataCalls: 0, sendCalls: 0, permission: true, unknown: false }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => { if (!fixture.client) throw Error("DISPOSABLE_POSTGRES_REQUIRED"); return fixture.client; } }));
import { dispatchPrivateBetaMessage } from "../../apps/web/src/lib/polat/private-beta-runtime";
const connection = process.env.POLAT_BETA_BUSINESS_DB_URL;
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const id = (n: number, kind: string) => `9b00${kind}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = "a".repeat(40);

describe.runIf(Boolean(connection))("actual BUSINESS server dispatcher + disposable PG17 + fake provider reads/ACK", () => {
  let db: ReturnType<typeof disposablePolatDatabase>;
  const created = new Set<string>();
  const base = Number(process.env.POLAT_BETA_BUSINESS_CASE_SEED ?? "15000");
  beforeAll(() => {
    db = disposablePolatDatabase(connection!); expect(db.query("select to_jsonb(current_setting('server_version_num')::int/10000)")).toBe(17);
    const original = polatSqlClient(db);
    // Extend only this explicit test transport allowlist. It still invokes real
    // service-role PostgreSQL; no production grant or PostgREST mock is introduced.
    fixture.client = { ...original, rpc: async (name, args) => {
      if (name !== "private_beta_business_transport_hold_v1") return original.rpc(name, args);
      const strings = ["target_tenant_id", "program_id_value", "target_message_id"].map(key => String(args[key]));
      if (strings.some(value => !/^[a-f0-9-]{36}$/u.test(value)) || !["PERMISSION_READ_UNVERIFIED", "SCOPE_CHANGED"].includes(String(args.reason_value))) throw Error("BUSINESS_TEST_RPC_SCOPE_INVALID");
      try { return { data: db.query(`begin;set local role service_role;select public.private_beta_business_transport_hold_v1(${strings.map(quote).join(",")},${quote(String(args.reason_value))});commit;`), error: null }; }
      catch { return { data: null, error: { code: "BUSINESS_TEST_RPC_ERROR" } }; }
    } };
    vi.stubEnv("POLAT_UAT_RELEASE_SHA", sha); vi.stubEnv("VERCEL_GIT_COMMIT_SHA", sha);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
      if (options?.method !== "POST" || options.redirect !== "error") throw Error("OFFLINE_BUSINESS_BOUNDARY_ONLY");
      const body = JSON.parse(String(options.body)) as Record<string, unknown>;
      if (url === `https://api.telegram.org/bot${fixture.botKey}/getBusinessConnection`) {
        fixture.metadataCalls++; if (body.business_connection_id !== fixture.connection) throw Error("OFFLINE_BUSINESS_CONNECTION_MISMATCH");
        return Response.json({ ok: true, result: { id: fixture.connection, user: { id: Number(fixture.representative), is_bot: false }, is_enabled: true, rights: { can_reply: fixture.permission } } });
      }
      if (url !== `https://api.telegram.org/bot${fixture.botKey}/sendMessage` || body.business_connection_id !== fixture.connection || body.chat_id !== fixture.founder) throw Error("OFFLINE_BUSINESS_SEND_SCOPE_INVALID");
      fixture.sendCalls++; if (fixture.unknown) throw Error("SYNTHETIC_POSSIBLE_REMOTE_EFFECT_ONLY");
      return Response.json({ ok: true, result: { message_id: 900 + fixture.sendCalls, chat: { id: Number(fixture.founder), type: "private" }, business_connection_id: fixture.connection, text: body.text } });
    }));
  });
  afterAll(() => {
    for (const tenant of created) db.execute(`do $$begin if exists(select 1 from public.tenants where id='${tenant}'and slug like 'private-beta-fixture-%'and status='active')then update public.tenants set status='suspended'where id='${tenant}';insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values('${tenant}','SYSTEM','private_beta.fixture_retired','tenants','${tenant}','{"mode":"OFFLINE_BUSINESS_FIXTURE","financial_authority":"NONE"}');end if;end;$$;`);
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
  });
  function setup(n: number) {
    if (!Number.isSafeInteger(n) || n < 1) throw Error("BUSINESS_TEST_SEED_INVALID");
    const tenant = id(n, "2000"), program = id(n, "3000"), bot = String(7000000 + n), key = bot + ":OFFLINE_BUSINESS_BRIDGE_FIXTURE_ONLY";
    const proof = { version: 1, bot_id: bot, source_hash: "d".repeat(64), observed_at: new Date().toISOString(), api_environment: "production", credential_sha256: createHash("sha256").update(key).digest("hex") };
    const helper = readFileSync(new URL("../../supabase/tests/helpers/private_beta_uat_fixtures.sql", import.meta.url), "utf8") + "\n" + readFileSync(new URL("../../supabase/tests/helpers/private_beta_business_fixtures.sql", import.meta.url), "utf8");
    db.execute(`begin;${helper}\nselect pg_temp.beta_setup(${n});select private.private_beta_bot_control_record('${tenant}','${program}',${quote(JSON.stringify(proof))});select pg_temp.beta_auth(${n});select public.admin_private_beta_business_configure_v1('${tenant}','${program}',pg_temp.business_config(${n})::text,1);insert into business_cases(n)values(${n});select pg_temp.business_seal(${n});select pg_temp.business_enroll(${n});select pg_temp.beta_auth(${n});update public.conversations set runtime_mode='HUMAN_TAKEOVER',human_takeover=true,automatic_replies_enabled=false where tenant_id='${tenant}';select public.admin_private_beta_queue_manual_v1('${tenant}',(select conversation_id from private.private_beta_participants where program_id='${program}'),'An invented human support response.','business-bridge-${n}','${id(n, "7000")}');commit;`);
    created.add(tenant);
    const scope = db.query(`select jsonb_build_object('conversation',a.conversation_id,'message',m.id)from private.private_beta_participants a join public.messages m on m.tenant_id=a.tenant_id and m.conversation_id=a.conversation_id where a.program_id='${program}'and m.idempotency_key='private-beta-human:business-bridge-${n}'`) as { conversation: string; message: string };
    fixture.botKey = key; fixture.founder = String(5000000 + n); fixture.representative = String(9000000 + n); fixture.connection = "fixture-business-" + n; fixture.metadataCalls = 0; fixture.sendCalls = 0; fixture.permission = true; fixture.unknown = false; vi.stubEnv("POLAT_UAT_TELEGRAM_BOT_TOKEN", key);
    return { tenant, program, ...scope };
  }
  it("dispatches one real SQL-owned manual obligation with exact Business ACK and no replayed effect", async () => {
    const s = setup(base + 1); expect(await dispatchPrivateBetaMessage(s.tenant, s.program, s.message)).toEqual({ status: "sent", message_id: s.message }); expect(fixture.sendCalls).toBe(1);
    expect(db.query(`select jsonb_build_object('status',status,'provider_id',provider_message_id,'acknowledged',provider_acknowledged_at is not null)from public.messages where id='${s.message}'`)).toEqual({ status: "sent", provider_id: "901", acknowledged: true });
    expect(await dispatchPrivateBetaMessage(s.tenant, s.program, s.message)).toEqual({ status: "blocked", message_id: s.message }); expect(fixture.sendCalls).toBe(1); expect(fixture.metadataCalls).toBe(2);
    expect(db.query(`select to_jsonb(count(*))from public.message_delivery_attempts where message_id='${s.message}'`)).toBe(1);
  });
  it("missing current permission becomes sticky review before any actual send claim", async () => {
    const s = setup(base + 2); fixture.permission = false;
    expect(await dispatchPrivateBetaMessage(s.tenant, s.program, s.message)).toEqual({ status: "blocked", message_id: s.message }); expect(fixture.sendCalls).toBe(0); expect(fixture.metadataCalls).toBe(1);
    expect(db.query(`select jsonb_build_object('restricted',b.restricted,'ownership',c.runtime_mode,'message_status',m.status,'reason',b.restriction_reason)from private.private_beta_business_controls b join public.conversations c on c.tenant_id=b.tenant_id join public.messages m on m.conversation_id=c.id where m.id='${s.message}'`)).toEqual({ restricted: true, ownership: "PAUSED", message_status: "blocked", reason: "PERMISSION_READ_UNVERIFIED" });
    expect(db.query(`select to_jsonb(count(*))from public.message_delivery_attempts where message_id='${s.message}'`)).toBe(0);
  });
  it("an unknown remote send is immutable uncertainty and is not blindly resent", async () => {
    const s = setup(base + 3); fixture.unknown = true;
    expect(await dispatchPrivateBetaMessage(s.tenant, s.program, s.message)).toEqual({ status: "unknown", message_id: s.message }); expect(fixture.sendCalls).toBe(1);
    expect(db.query(`select jsonb_build_object('status',status,'error',failure_code,'provider_id',provider_message_id)from public.messages where id='${s.message}'`)).toEqual({ status: "failed", error: "TELEGRAM_DELIVERY_UNCERTAIN", provider_id: null });
    expect(await dispatchPrivateBetaMessage(s.tenant, s.program, s.message)).toEqual({ status: "blocked", message_id: s.message }); expect(fixture.sendCalls).toBe(1);
    expect(db.query(`select to_jsonb(count(*))from private.verified_payment_receipts where tenant_id='${s.tenant}'`)).toBe(0);
  });
});
