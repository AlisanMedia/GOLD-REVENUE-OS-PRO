// Explicit owner-authorized, single-send provider acceptance. Never part of default CI.
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { test, vi } from "vitest";
vi.mock("server-only", () => ({})); // Node harness boundary only; DB, worker and transport are real.
import { createSupabaseAdminClient } from "../../apps/web/src/lib/supabase/admin";
import { drainEscalations } from "../../apps/web/src/lib/escalations/service";
import { ManagerTelegramNotifier } from "../../apps/web/src/lib/escalations/notification-adapter";

const enabled = process.env.PHASE12_REAL_TELEGRAM_ACCEPTANCE === "owner-single-alert";
(enabled ? test : test.skip)("one real private manager alert with case/receipt/audit reconciliation", async () => {
  const tenant = "24760616-5e9c-4f36-8790-5a48a8ab1212";
  const chatId = "-5537216841", botId = "8915334711", ownerId = 6890052501;
  const checks: string[] = [];
  const evidence: Record<string, unknown> = {
    status: "FAILED", mode: "real Telegram provider; unchanged accepted application worker",
    application_sha: process.env.VALIDATED_SHA, acceptance_sha: process.env.GITHUB_SHA,
    run_id: process.env.GITHUB_RUN_ID, discovery_run: "38904943774", tenant_id: tenant,
    human_read_confirmed: false, application_deployment: false, database_migration: false,
  };
  const check = (name: string, ok: unknown) => { if (!ok) throw Error(name); checks.push(name); };
  const db = createSupabaseAdminClient();
  const rpc = async (client: typeof db, name: string, args: Record<string, unknown>) => {
    const result = await client.rpc(name, args).abortSignal(AbortSignal.timeout(15000)).retry(false);
    if (result.error) throw Error("RPC_" + name.toUpperCase() + "_FAILED");
    return result.data;
  };
  const transport = globalThis.fetch;
  let sends = 0, created = false, userId: string | undefined, manager: typeof db | undefined;
  const call = async (method: string, body: Record<string, unknown> = {}) => {
    const r = await transport(`https://api.telegram.org/bot${process.env.ESCALATION_TELEGRAM_BOT_TOKEN}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(12000),
    });
    const data = await r.json();
    if (!r.ok || !data.ok) throw Error("PREFLIGHT_" + method.toUpperCase() + "_FAILED");
    return data.result;
  };
  const count = async (table: string, filter?: [string, string]) => {
    let query = db.from(table).select("*", { count: "exact", head: true });
    if (filter) query = query.eq(...filter);
    const r = await query;
    if (r.error || r.count === null) throw Error("SAFETY_COUNT_FAILED");
    return r.count;
  };
  const snapshot = async () => {
    const [payments, paid, subscriptions, access, imports, outbound, tenants, conversations] = await Promise.all([
      count("domain_events", ["event_type", "payment.confirmed"]), count("customers", ["state", "PAID"]),
      count("subscriptions", ["mode", "live"]), count("channel_access", ["mode", "live"]),
      count("import_batches"), count("messages", ["direction", "outbound"]),
      db.from("tenants").select("id,status,outbound_messaging_enabled").neq("id", tenant).order("id"),
      db.from("conversations").select("id,runtime_mode,human_takeover,automatic_replies_enabled").neq("tenant_id", tenant).order("id"),
    ]);
    if (tenants.error || conversations.error) throw Error("SAFETY_SCOPE_READ_FAILED");
    return { payments, paid, subscriptions, access, imports, outbound,
      other_controls_sha256: createHash("sha256").update(JSON.stringify([tenants.data, conversations.data])).digest("hex") };
  };
  const save = () => {
    evidence.checks = checks; evidence.send_message_requests = sends;
    writeFileSync(process.env.PHASE12_EVIDENCE_FILE!, JSON.stringify(evidence, null, 2), { mode: 0o600 });
  };
  let failure: string | undefined;
  try {
    check("APPROVED_SCOPE", process.env.APPROVED_ADMIN_CHAT === chatId && process.env.ESCALATION_TELEGRAM_BOT_TOKEN &&
      process.env.NEXT_PUBLIC_SUPABASE_URL === "https://xqvwkghpmezcpgugetqc.supabase.co" &&
      process.env.NEXT_PUBLIC_APP_URL === "https://gold-revenue-os-staging.vercel.app" && !process.env.TELEGRAM_STAGING_TENANT_ID);
    const me = await call("getMe");
    check("EXACT_OPERATIONS_BOT", me.is_bot && String(me.id) === botId && me.username === "gold_revenue_os_ops_bot");
    const webhook = await call("getWebhookInfo");
    check("NO_WEBHOOK_NO_COMPETING_REPOSITORY_CONSUMER", !webhook.url);
    const updates = await call("getUpdates", { limit: 20, timeout: 0 }); // No offset, consumer or webhook mutation.
    const command = updates.find((u: { message?: { from?: { id: number }; chat?: { id: number }; text?: string } }) =>
      u.message?.from?.id === ownerId && String(u.message?.chat?.id) === chatId && u.message?.text?.trim() === "/chatid@gold_revenue_os_ops_bot");
    check("EXACT_OWNER_COMMAND_AND_DESTINATION", command);
    const chat = await call("getChat", { chat_id: chatId });
    const member = await call("getChatMember", { chat_id: chatId, user_id: Number(botId) });
    check("PRIVATE_ADMIN_GROUP_SEPARATE_FROM_VIP", String(chat.id) === chatId && ["group", "supergroup"].includes(chat.type) && !chat.username && chatId !== String(-1003944824067));
    check("BOT_MEMBERSHIP_AND_SEND_PERMISSION", String(member.user?.id) === botId &&
      (["creator", "administrator"].includes(member.status) || member.status === "member" && chat.permissions?.can_send_messages === true ||
        member.status === "restricted" && member.is_member && member.can_send_messages));
    evidence.preflight = { bot_id: botId, bot_username: me.username, chat_id: chatId, chat_type: chat.type,
      chat_title: chat.title, bot_membership: member.status, can_send_messages: true, owner_id: ownerId,
      command_message_id: command.message.message_id, update_id: command.update_id, webhook_configured: false,
      updates_inspected: updates.length, updates_acknowledged: false, separate_from_vip: true };
    if (process.env.PHASE12_READ_ONLY_DIAGNOSTIC === "true") {
      const trace: unknown[] = [];
      const diagnostic = new ManagerTelegramNotifier({ tenantId: tenant, chatId, botId,
        botToken: process.env.ESCALATION_TELEGRAM_BOT_TOKEN!, appOrigin: process.env.NEXT_PUBLIC_APP_URL! }, async (input, init) => {
        const method = String(input).split("/").at(-1);
        if (method === "sendMessage") { trace.push({ method, blocked_before_network: true }); throw Error("DIAGNOSTIC_NO_SEND"); }
        try {
          const r = await transport(input, init), d = await r.clone().json();
          trace.push({ method, http_status: r.status, ok: d.ok, id_type: typeof d.result?.id,
            id: d.result?.id, is_bot: d.result?.is_bot, chat_type: d.result?.type,
            username_type: typeof d.result?.username, username_is_null: d.result?.username === null });
          return r;
        } catch (error) { trace.push({ method, failure_name: error instanceof Error ? error.name : "unknown" }); throw Error("DIAGNOSTIC_PREFLIGHT_FAILED"); }
      });
      try {
        evidence.diagnostic_receipt = await diagnostic.send({ id: tenant, tenant_id: tenant, case_id: tenant, lease_token: tenant,
          attempt: 1, chat_id: chatId, bot_id: botId, severity: "HIGH", category: "refund_request", customer_id: null, waiting_seconds: 0 });
      } catch (error) { evidence.diagnostic_exception = { name: error instanceof Error ? error.name : "unknown",
        code: error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message) ? error.message : "VALIDATION_FAILED" }; }
      evidence.diagnostic_trace = trace; evidence.status = "READ_ONLY_DIAGNOSTIC"; return;
    }
    evidence.safety_before = await snapshot();
    const exists = await db.from("tenants").select("id").eq("id", tenant).maybeSingle();
    check("FIXTURE_HAS_NEVER_BEEN_USED_NO_RESEND", !exists.error && !exists.data);
    const inserted = await db.from("tenants").insert({ id: tenant, name: "TEST ONLY Phase 12 final provider acceptance", slug: "phase12-sandbox-final-notification-20261016" });
    check("ISOLATED_FIXTURE_CREATED", !inserted.error); created = true;
    await rpc(db, "configure_phase12_escalation", { target_tenant_id: tenant, enabled_value: true, approval_value: "Owner single synthetic alert; discovery 38904943774; staging only" });
    const source = await rpc(db, "ingest_telegram_message", { target_tenant_id: tenant,
      provider_update_id_value: "phase12:owner-final-manager-notification:20261016", provider_message_id_value: "test:phase12:final",
      provider_chat_id_value: "test:phase12:final-notification", provider_user_id_value: "test:phase12:final-notification",
      username_value: null, first_name_value: "TEST ONLY", last_name_value: null,
      content_value: "TEST ONLY synthetic escalation: I want a refund.", reply_to_provider_message_id_value: null, occurred_at_value: new Date().toISOString() });
    const c = await db.from("escalation_cases").select("*").eq("tenant_id", tenant).single();
    check("SYNTHETIC_HIGH_REFUND_CASE", !c.error && c.data.category === "refund_request" && c.data.severity === "HIGH" && c.data.source_message_id === source.message_id);
    const caseId = c.data.id;
    evidence.case_id = caseId; evidence.conversation_id = source.conversation_id;
    const blocked = await db.from("escalation_notifications").select("id,status,attempts").eq("case_id", caseId).single();
    check("MISSING_DESTINATION_VISIBLE_BLOCKED", !blocked.error && blocked.data.status === "BLOCKED" && blocked.data.attempts === 0);
    check("MISSING_DESTINATION_NOT_CLAIMABLE", await rpc(db, "escalation_claim_notification", { target_tenant_id: tenant }) === null);
    await rpc(db, "configure_phase12_escalation", { target_tenant_id: tenant, enabled_value: true,
      approval_value: "Owner verified exact admin group; discovery 38904943774; one staging alert", chat_value: chatId, bot_value: botId });
    process.env.ESCALATION_NOTIFICATION_TENANT_ID = tenant;
    process.env.ESCALATION_TELEGRAM_CHAT_ID = chatId; process.env.ESCALATION_TELEGRAM_BOT_ID = botId;
    // Observe real provider responses without replacing transport or fabricating receipts. Second sends are denied before network.
    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.hostname !== "api.telegram.org" || !url.pathname.endsWith("/sendMessage")) return transport(input, init);
      const body = JSON.parse(String(init?.body));
      check("SINGLE_SEND_EXACT_ALLOWLIST_AND_SYNTHETIC_PAYLOAD", sends === 0 && String(body.chat_id) === chatId &&
        body.text.startsWith("PHASE 12 STAGING TEST\nHIGH · refund_request\n") &&
        body.text.includes("No payment or access action performed.") &&
        body.text.includes("https://gold-revenue-os-staging.vercel.app/admin/attention/" + caseId));
      sends++; save(); // Preserve attempted send even if the provider response is ambiguous; never blindly retry.
      const response = await transport(input, init);
      const acknowledgment = await response.clone().json();
      evidence.provider = { http_status: response.status, ok: acknowledgment.ok === true,
        chat_id: acknowledgment.result?.chat?.id?.toString(), message_id: acknowledgment.result?.message_id?.toString(),
        acknowledged_at: new Date().toISOString(), human_read_confirmed: false };
      save(); return response;
    };
    await drainEscalations({ tenantId: tenant, conversationId: source.conversation_id });
    const sent = await db.from("escalation_notifications").select("*").eq("case_id", caseId).single();
    check("SINGLE_SENT_NOTIFICATION", !sent.error && sent.data.status === "SENT" && sent.data.attempts === 1 &&
      sent.data.destination_chat_id === chatId && sent.data.destination_bot_id === botId && /^[1-9][0-9]*$/u.test(sent.data.provider_message_id));
    const provider = evidence.provider as { http_status: number; ok: boolean; chat_id: string; message_id: string };
    check("ACTUAL_PROVIDER_ACK_EQUALS_RECORDED_RECEIPT", provider.http_status === 200 && provider.ok && provider.chat_id === chatId && provider.message_id === sent.data.provider_message_id);
    evidence.notification = { id: sent.data.id, status: sent.data.status, attempts: sent.data.attempts, sent_at: sent.data.sent_at,
      provider_message_id: sent.data.provider_message_id, destination_chat_id: chatId, destination_bot_id: botId };
    const [attempts, history, audit] = await Promise.all([
      db.from("escalation_notification_attempts").select("id,notification_id,attempt,result,provider_status,provider_message_id,destination_chat_id,destination_bot_id").eq("notification_id", sent.data.id),
      db.from("escalation_history").select("id,case_id,action,details").eq("case_id", caseId).eq("action", "notification_sent"),
      db.from("audit_logs").select("id,entity_id,action,after_data").eq("tenant_id", tenant).eq("entity_id", caseId).eq("action", "escalation.notification_sent"),
    ]);
    check("ONE_IMMUTABLE_ATTEMPT_AND_LINKED_AUDIT", !attempts.error && !history.error && !audit.error && attempts.data.length === 1 && history.data.length === 1 && audit.data.length === 1 &&
      attempts.data[0]!.result === "SENT" && attempts.data[0]!.provider_status === 200 && attempts.data[0]!.provider_message_id === provider.message_id &&
      attempts.data[0]!.destination_chat_id === chatId && attempts.data[0]!.destination_bot_id === botId &&
      history.data[0]!.details.notification_id === sent.data.id && history.data[0]!.details.provider_message_id === provider.message_id &&
      audit.data[0]!.after_data.notification_id === sent.data.id && audit.data[0]!.after_data.provider_message_id === provider.message_id);
    evidence.receipts = { attempts: attempts.data, history: history.data, audit: audit.data };
    await drainEscalations({ tenantId: tenant, conversationId: source.conversation_id });
    check("SECOND_WORKER_PASS_SENDS_NOTHING", sends === 1);
    check("SENT_JOB_CANNOT_BE_RECLAIMED", await rpc(db, "escalation_claim_notification", { target_tenant_id: tenant }) === null);
    const password = randomBytes(30).toString("base64url") + "Aa1!";
    const auth = await db.auth.admin.createUser({ email: "phase12-final-notification-manager@example.test", password, email_confirm: true });
    check("SYNTHETIC_MANAGER_CREATED", !auth.error && auth.data.user); userId = auth.data.user!.id;
    const membership = await db.from("tenant_members").insert({ tenant_id: tenant, user_id: userId, role: "manager", status: "active" });
    check("ISOLATED_MANAGER_MEMBERSHIP", !membership.error);
    manager = createSupabaseAdminClient();
    const login = await manager.auth.signInWithPassword({ email: auth.data.user!.email!, password });
    check("AUTHENTICATED_MANAGER", !login.error);
    await rpc(manager, "admin_escalation_action", { target_tenant_id: tenant, target_case_id: caseId, expected_revision: c.data.revision,
      action_value: "resolve", note_value: "TEST ONLY synthetic case reviewed. Exactly one manager alert acknowledged by provider. No refund, payment or access action performed." });
    const finalCase = await db.from("escalation_cases").select("id,status,resolved_at,revision").eq("id", caseId).single();
    const finalJob = await db.from("escalation_notifications").select("id,status,attempts").eq("case_id", caseId).single();
    const conv = await db.from("conversations").select("human_takeover,automatic_replies_enabled").eq("id", source.conversation_id).single();
    check("CASE_RESOLVED_SENT_RECEIPT_PRESERVED_AI_HELD", !finalCase.error && !finalJob.error && !conv.error && finalCase.data.status === "RESOLVED" &&
      finalJob.data.status === "SENT" && finalJob.data.attempts === 1 && conv.data.human_takeover && !conv.data.automatic_replies_enabled);
    evidence.final_case = finalCase.data; evidence.final_queue = finalJob.data;
    evidence.safety_after = await snapshot();
    check("NO_FINANCIAL_ACCESS_IMPORT_CUSTOMER_OUTBOUND_OR_OTHER_CONTROL_CHANGE", JSON.stringify(evidence.safety_before) === JSON.stringify(evidence.safety_after));
    evidence.status = "PASS";
  } catch (error) {
    failure = error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message) ? error.message : "ACCEPTANCE_UNAVAILABLE";
    evidence.failure = failure;
  } finally {
    globalThis.fetch = transport;
    try {
      if (manager) await manager.auth.signOut();
      if (userId) {
        const member = await db.from("tenant_members").update({ status: "disabled" }).eq("tenant_id", tenant).eq("user_id", userId);
        if (member.error) throw Error("CLEANUP_MEMBER_FAILED");
      }
      if (created) {
        await rpc(db, "configure_phase12_escalation", { target_tenant_id: tenant, enabled_value: false,
          approval_value: "Single real manager notification acceptance finished; allowlist retained disabled", chat_value: chatId, bot_value: botId });
        const suspended = await db.from("tenants").update({ status: "suspended", outbound_messaging_enabled: false }).eq("id", tenant);
        if (suspended.error) throw Error("CLEANUP_TENANT_FAILED");
      }
      evidence.cleanup = { completed: true, fixture_created: created, tenant_suspended: created, tenant_outbound: false,
        notification_control_enabled: false, exact_staging_allowlist_retained: created, test_manager_disabled: Boolean(userId), production_configuration_changed: false };
    } catch { evidence.cleanup = { completed: false }; evidence.status = "FAILED"; failure ??= "CLEANUP_FAILED"; }
    save();
  }
  if (failure) throw Error(failure);
}, 120000);
