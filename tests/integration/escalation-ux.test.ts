import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createElement } from "../../apps/web/node_modules/react";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server";
import { availableEscalationActions, caseStage, conversationAutomationLabel, escalationControlError, notificationHelp, notificationLabel, operatorDate } from "../../apps/web/src/lib/escalations/presentation";
import { manualReplyResult } from "../../apps/web/src/lib/escalations/manual-reply";
import { hasAdminCapability } from "../../apps/web/src/lib/admin/permissions";
import type { EscalationCase, EscalationReadModel } from "../../apps/web/src/lib/escalations/admin";
import { managerNotificationText } from "../../packages/domain/src/escalations";

const mocks = vi.hoisted(() => ({ requireCapability: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/server", () => ({ requireAdminCapability: mocks.requireCapability }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/escalations/presentation", async () => import("../../apps/web/src/lib/escalations/presentation"));
vi.mock("@/app/admin/attention/actions", () => ({ controlEscalation: async () => ({ kind: "idle", message: "" }) }));
import { controlEscalation } from "../../apps/web/src/app/admin/attention/actions";
import { setAutomaticReplies } from "../../apps/web/src/app/admin/conversations/[id]/actions";
import { EscalationCaseView, EscalationQueue } from "../../apps/web/src/components/escalation-views";

const userId = "12000000-0000-4000-8000-000000000010";
const c: EscalationCase = {
  id: "12000000-0000-4000-8000-000000000003", conversation_id: "12000000-0000-4000-8000-000000000004", customer_id: null,
  category: "refund_request", severity: "HIGH", status: "OPEN", source_message_id: "12000000-0000-4000-8000-000000000005",
  assigned_to: null, revision: 1, created_at: "2026-10-16T12:00:00Z", waiting_seconds: 960, acknowledged_at: null, first_response_at: null,
  resolved_at: null, resolution_note: null, returned_to_ai_at: null,
  notification: { status: "BLOCKED", attempts: 0, provider_message_id: null, last_error: "DESTINATION_NOT_CONFIGURED", sent_at: null },
};
const data = (overrides: Partial<EscalationCase> = {}): EscalationReadModel => ({ cases: [{ ...c, ...(overrides.status === "IN_PROGRESS" ? { acknowledged_at: "2026-10-16T12:16:00Z" } : {}), ...overrides }],
  evidence: [{ id: c.source_message_id, message_id: c.source_message_id, category: c.category, source_kind: "inbound", source_id: c.source_message_id, created_at: c.created_at }],
  history: [...(overrides.status === "IN_PROGRESS" ? [{ id: 2, action: "takeover", actor_id: userId, details: {}, created_at: "2026-10-16T12:16:00Z" }] : []), { id: 1, action: "created", actor_id: null, details: {}, created_at: c.created_at }], managers: [{ id: userId, role: "manager" }] });
const render = (overrides: Partial<EscalationCase> = {}, canManage = true) => renderToStaticMarkup(createElement(EscalationCaseView, {
  data: data(overrides), userId, canManage, conversation: { runtime_mode: "HUMAN_TAKEOVER", automatic_replies_enabled: false },
}));
beforeEach(() => { vi.clearAllMocks(); mocks.requireCapability.mockResolvedValue({ tenantId: "server-owned-tenant", userId }); mocks.rpc.mockResolvedValue({ data: 2, error: null }); });

describe("Turkish Phase 12 operator workflow", () => {
  it("labels Phase14 survey evidence and links identified feedback without changing takeover controls",()=>{const model=data({customer_id:userId});model.evidence=model.evidence.map(e=>({...e,source_kind:"survey"}));const html=renderToStaticMarkup(createElement(EscalationCaseView,{data:model,userId,canManage:true,conversation:{runtime_mode:"HUMAN_TAKEOVER",automatic_replies_enabled:false}}));expect(html).toContain("Anket geri bildirimi");expect(html).toContain(`/admin/feedback?customer=${userId}`);expect(html).not.toContain("Yanıt kalite değerlendirmesi");});

  it.each(["super_admin", "manager", "support", "analyst", "readonly"] as const)("shows only %s role actions", role => {
    const allowed = hasAdminCapability(role, "escalations.manage");
    const html = render({}, allowed);
    expect(html.includes("Vakayı Üstlen")).toBe(allowed);
    expect(html.includes("name=\"action\" value=\"resolve\"")).toBe(false);
    expect(html.includes("name=\"action\" value=\"return\"")).toBe(false);
  });
  it("requires actual ownership and state before showing the customer composer", () => {
    expect(render()).not.toContain("Write a short, professional reply in English");
    expect(render({ status: "IN_PROGRESS", assigned_to: userId })).toContain("Write a short, professional reply in English");
    expect(render({ status: "IN_PROGRESS", assigned_to: "another-manager" })).not.toContain("Write a short, professional reply in English");
    expect(render({ status: "IN_PROGRESS", assigned_to: userId }, false)).not.toContain("Write a short, professional reply in English");
    expect(render({ status: "IN_PROGRESS", assigned_to: userId })).toContain('lang="en"');
  });
  it("separates resolution from guarded return and hides completed actions", () => {
    expect(availableEscalationActions({ ...c, status: "RESOLVED" }, userId, true)).toEqual(["return"]);
    expect(availableEscalationActions({ ...c, status: "RESOLVED", returned_to_ai_at: c.created_at }, userId, true)).toEqual([]);
    const html = render({ status: "RESOLVED" });
    expect(html).toContain("onaylıyorum"); expect(html).toContain("Eski taslaklar yeniden gönderilmez"); expect(html).not.toContain("Çözüldü Olarak İşaretle");
    expect(render({ status: "IN_PROGRESS", assigned_to: userId })).toContain('name="note" required=""');
  });
  it("does not infer takeover or current AI activity from assignment or case return", () => {
    expect(caseStage({ ...c, assigned_to: userId })).toBe("Yönetici Atandı");
    expect(conversationAutomationLabel(null)).toBe("Görüşme durumu doğrulanamadı");
    expect(conversationAutomationLabel({ runtime_mode: "AI_ACTIVE", automatic_replies_enabled: false })).toBe("Otomatik müşteri yanıtları kapalı");
    expect(notificationHelp("SENT")).toContain("okuduğu doğrulanmadı"); expect(notificationLabel("BLOCKED")).toBe("Hedef bekleniyor");
  });
  it("keeps control RPC tenant scope, revision and truthful Turkish results", async () => {
    const form = new FormData(); form.set("case_id", c.id); form.set("revision", "1"); form.set("action", "takeover"); form.set("tenant_id", "untrusted-tenant");
    const state = await controlEscalation({ kind: "idle", message: "" }, form);
    expect(mocks.requireCapability).toHaveBeenCalledWith("escalations.manage");
    expect(mocks.rpc).toHaveBeenCalledWith("admin_escalation_action", expect.objectContaining({ target_tenant_id: "server-owned-tenant", expected_revision: 1, action_value: "takeover" }));
    expect(state.kind).toBe("success");
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT409" } });
    const denied = await controlEscalation(state, form); expect(denied.kind).toBe("error"); expect(denied.message).toBe(escalationControlError("PT409"));
  });
  it("denies invalid/empty resolution and unauthorized actions before database mutation", async () => {
    const form = new FormData(); form.set("case_id", c.id); form.set("revision", "1"); form.set("action", "resolve");
    expect((await controlEscalation({ kind: "idle", message: "" }, form)).kind).toBe("error"); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.requireCapability.mockRejectedValueOnce(Error("AUTH_DENIED"));
    await expect(controlEscalation({ kind: "idle", message: "" }, form)).rejects.toThrow("AUTH_DENIED"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("keeps automatic-reply changes scoped and translates backend denials without claiming success", async () => {
    const form = new FormData(); form.set("conversation_id", c.conversation_id); form.set("enabled", "false");
    expect((await setAutomaticReplies({ kind: "idle", message: "" }, form)).kind).toBe("success");
    expect(mocks.requireCapability).toHaveBeenCalledWith("messaging.send");
    expect(mocks.rpc).toHaveBeenCalledWith("set_conversation_automatic_replies", expect.objectContaining({ target_tenant_id: "server-owned-tenant", target_conversation_id: c.conversation_id, enabled_value: false }));
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    expect((await setAutomaticReplies({ kind: "idle", message: "" }, form)).kind).toBe("error");
    expect(notificationLabel("toString")).toBe("Bildirim gerekmiyor");
    expect(typeof manualReplyResult(false, { error: "constructor" })).toBe("string");
  });
  it("never reports queued/unknown/manual failure as delivered", () => {
    expect(manualReplyResult(true, { status: "retry_scheduled" })).toContain("Teslim henüz doğrulanmadı");
    expect(manualReplyResult(true, {})).toContain("teslimi doğrulanamadı");
    expect(manualReplyResult(false, { error: "OUTBOUND_NOT_ALLOWED" })).toContain("gönderimi kapalı");
    expect(manualReplyResult(true, { status: "sent" })).toContain("Müşterinin okuduğu doğrulanmadı");
    expect(operatorDate("2026-10-16T12:00:00Z")).toContain("UTC");
  });
  it("renders truthful secondary technical evidence and optionally exports safe actual-component previews", () => {
    const html = render({ status: "IN_PROGRESS", assigned_to: userId });
    expect(html).toContain("Teknik kayıtlar ve teslim kanıtı"); expect(html).toContain("Kaynak kanıtları"); expect(html).toContain("1</span>İnceleme Bekliyor");
    const directory = process.env.PHASE12_UX_PREVIEW_DIR;
    if (!directory) return;
    mkdirSync(directory, { recursive: true });
    const css = readFileSync("apps/web/src/app/globals.css", "utf8").replace('@import "tailwindcss";', "");
    const write = (name: string, body: string) => writeFileSync(`${directory}/${name}.html`, `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gold Revenue OS · Sentetik UX Önizlemesi</title><style>${css}</style></head><body><p style="padding:12px 20px;color:#959ca8">Yerel sentetik önizleme · Gerçek müşteri veya Telegram işlemi yok</p>${body}</body></html>`);
    write("case", html); write("queue", `<main class="admin-main case-workspace"><p class="eyebrow">GOLD REVENUE OS</p><h1>İnceleme Merkezi</h1>${renderToStaticMarkup(createElement(EscalationQueue, { cases: [c, { ...c, id: "12000000-0000-4000-8000-000000000006", severity: "CRITICAL", category: "security_issue" }], userId }))}</main>`);
    write("readonly", render({}, false)); write("return", render({ status: "RESOLVED", resolved_at: c.created_at, resolution_note: "TEST · Kanıtlar incelendi. Ödeme veya erişim işlemi yapılmadı." }));
    const notification = managerNotificationText({ id: c.id, tenant_id: c.id, case_id: c.id, lease_token: c.id, attempt: 1, chat_id: "12345", bot_id: "99999", severity: "HIGH", category: "refund_request", customer_id: null, waiting_seconds: 960 }, "https://gold-revenue-os-staging.vercel.app");
    writeFileSync(`${directory}/notification.txt`, notification);
    write("notification", `<main class="admin-main case-workspace"><h1>Yönetici bildirimi</h1><pre class="case-panel" style="white-space:pre-wrap;line-height:1.7">${notification.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</pre></main>`);
  });
});
