import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "../../apps/web/node_modules/react";
import { renderToStaticMarkup as render } from "../../apps/web/node_modules/react-dom/server";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { AdminI18nProvider } from "../../apps/web/src/components/admin-i18n";
import { AdminWorkspaceFrame } from "../../apps/web/src/components/admin-workspace-frame";
import { PolatOperationsView } from "../../apps/web/src/components/polat-operations";
import { PolatPrivateBeta, privateBetaText } from "../../apps/web/src/components/polat-private-beta";
import { polatOperations } from "../../apps/web/src/lib/polat/admin";
import { polatSearchSchema } from "../../apps/web/src/lib/polat/read-model";
import { parsePrivateBetaCanaryResult, parsePrivateBetaBusinessScope, parsePrivateBetaBusinessDiscovery, parsePrivateBetaStarsInvoiceResult, submitPrivateBetaOwnerForm, parsePrivateBetaOperators, parsePrivateBetaWorkspace, privateBetaCursor, privateBetaNotesCursor, parsePrivateBetaNotesPage, privateBetaFeedback, privateBetaHref } from "../../apps/web/src/lib/polat/private-beta-read";
import { acceptPrivateBetaOperator, configurePrivateBeta, configurePrivateBetaBusiness, createPrivateBetaInvitation, createPrivateBetaTenant, recordPrivateBetaNote, reverifyPrivateBetaBusiness, selectPrivateBetaOpenAI } from "../../apps/web/src/app/admin/polat-operations/beta-actions";
import { messageDeliveryLabel, manualReplyResult } from "../../apps/web/src/lib/escalations/manual-reply";

const mocks = vi.hoisted(() => ({ require: vi.fn(), rpc: vi.fn(), from: vi.fn(), revalidate: vi.fn(), analytics: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/server", () => ({ requireAdminCapability: mocks.require }));
vi.mock("@/lib/admin/permissions", () => import("../../apps/web/src/lib/admin/permissions"));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("@/lib/analytics/server", () => ({ analyticsWorkspace: mocks.analytics }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/app/(auth)/login/actions", () => ({ signOut: async () => {} }));
vi.mock("@/app/admin/preferences/actions", () => ({ changeAdminLocale: async () => "SAVED" }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/polat-operations" }));

const tenant = "91cc1000-0000-4000-8000-000000000001", user = "91cc1000-0000-4000-8000-000000000002", program = "91cc1000-0000-4000-8000-000000000003", conversation = "91cc1000-0000-4000-8000-000000000004", item = "91cc1000-0000-4000-8000-000000000005";
const at = "2026-10-26T10:00:00Z";
const idle = { kind: "idle" as const, code: "IDLE" as const };
const query = () => polatSearchSchema.parse({ view: "beta" });
function fixture() { return parsePrivateBetaWorkspace({
  version: 1, mode: "PRIVATE_BETA_UAT", program: { id: program, stage: "DRAFT", generation: "1", repository_sha: null, starts_at: null, expires_at: null, retention_days: null, notice_version: "polat-private-beta-notice-v1", configuration_complete: false, account_state: "MISSING", canary_state: "NOT_STARTED", global_requests: 3, maximum_requests: 350, reserved_liability: "0.0200", currency: "USD", actual_billed_amount: null, billing_status: "UNKNOWN", founder_limit: 20, friend_limit: 30, friend_limit_count: 10, primary_operator_configured: false, backup_operator_configured: false },
  participants: [{ id: item, kind: "FOUNDER", status: "ACTIVE", conversation_id: conversation, joined_at: at, revoked_at: null, model_requests: 3, maximum_requests: 20 }],
  attempts: [{ id: item, scope: "FOUNDER", created_at: at, status: "UNKNOWN", qa: "NOT_EVALUATED", input_tokens: null, output_tokens: null, actual_billed_amount: null, billing_status: "UNKNOWN" }],
  notes: [{ id: item, conversation_id: conversation, scenario: "UAT_FIXTURE_UNKNOWN", outcome: "NOTE", note: "Synthetic UI fixture <script>not executable</script>", created_at: at, author: "OPERATOR" }], page_size: 25, has_more: false, next_cursor: null, notes_has_more: false, financial_authority: "NONE", commercial_sales: false,
}); }
function form(values: Record<string, string>) { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; }
function canaryFixture() { return { version: 1, stage: "CANARY", status: "CANARY_ACCOUNTING_RECONCILIATION_PENDING", program_id: program, attempt_id: item, request_id: conversation, repository_sha: "a".repeat(40), plan_hash: "b".repeat(64), corpus_hash: "c".repeat(64), provider: "anthropic", model: "claude-haiku-5-5", provider_response_id: "msg_OFFLINE_UI_FIXTURE", response_hash: "d".repeat(64), elapsed_ms: "12.500000", input_tokens: 37, output_tokens: 121, qa: "APPROVED", response_preview: "Hi! I'm Polat's AI assistant.", actual_billed_amount: null, actual_billed_currency: null, billing_status: "UNKNOWN_REQUIRES_INDEPENDENT_RECONCILIATION", automatic_retries: 0, telegram_messages: 0, financial_authority: "NONE", founder_testing_enabled: false }; }
beforeEach(() => {
  vi.clearAllMocks();
  mocks.require.mockResolvedValue({ tenantId: tenant, userId: user, role: "super_admin" });
  mocks.rpc.mockResolvedValue({ data: fixture(), error: null });
  mocks.from.mockImplementation(() => { const chain = { select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(), limit: vi.fn() }; for (const method of [chain.select, chain.eq, chain.in, chain.order]) method.mockReturnValue(chain); chain.limit.mockResolvedValue({ data: [{ user_id: user, role: "super_admin" }], error: null }); return chain; });
});

describe("Private beta bounded, truthful Admin evidence", () => {
  it("uses authenticated tenant context and a single bounded workspace RPC", async () => {
    const result = await polatOperations(query());
    expect(mocks.rpc).toHaveBeenCalledWith("admin_private_beta_workspace_v1", { target_tenant_id: tenant, page_size_value: 25, cursor_value: null });
    expect("beta" in result && result.beta?.program?.global_requests).toBe(3);
    expect("betaOperators" in result && result.betaOperators).toEqual([{ id: user, role: "super_admin", current: true }]);
    expect(mocks.analytics).not.toHaveBeenCalled();
  });
  it.each(["analyst", "readonly"])("denies private conversation evidence for %s without touching the database", async role => {
    mocks.require.mockResolvedValue({ tenantId: tenant, userId: user, role });
    const result = await polatOperations(query());
    expect("betaDenied" in result && result.betaDenied).toBe(true); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
  });
  it("support never receives private staff selections or configuration controls", async () => {
    mocks.require.mockResolvedValue({ tenantId: tenant, userId: user, role: "support" });
    const result = await polatOperations(query());
    expect("betaCanConfigure" in result && result.betaCanConfigure).toBe(false); expect(mocks.from).not.toHaveBeenCalled();
  });
  it("rejects unknown RPC fields before they reach client props", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...fixture(), raw_provider_secret: "PRIVATE_NOT_FOR_CLIENT" }, error: null });
    const result = await polatOperations(query()); expect("beta" in result && result.beta).toBeNull(); expect(JSON.stringify(result)).not.toContain("PRIVATE_NOT_FOR_CLIENT");
  });
  it("does not reinterpret RPC failure as an empty program", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "08006" } }); const result = await polatOperations(query());
    expect(result.error).toBe("unavailable"); expect("beta" in result && result.beta).toBeNull();
  });
  it("validates cursors including role, filter and unexpected-field boundaries", () => {
    const cursor = { v: 1, tenant, user, role: "support", size: 25, program, generation: "2", anchor: { at, id: item }, before: { at, id: item }, expires: "2026-10-26T10:30:00Z", seal: "f".repeat(64) };
    expect(privateBetaCursor(JSON.stringify(cursor))).toEqual(cursor); expect(privateBetaHref("25", cursor)).toContain("view=beta");
    expect(() => privateBetaCursor(JSON.stringify({ ...cursor, role: "analyst" }))).toThrow(); expect(() => privateBetaCursor(JSON.stringify({ ...cursor, verified: true }))).toThrow();
    expect(polatSearchSchema.safeParse({ view: "beta", tenant }).success).toBe(false);
  });
  it("notes paging uses its own bounded cursor and never sends it to the attempts RPC", async () => {
    const cursor = { v: 1, collection: "notes", tenant, user, role: "super_admin", size: 25, program, generation: "1", anchor: { at, id: item }, before: { at, id: item }, expires: "2026-10-26T10:30:00Z", seal: "f".repeat(64) };
    const notes = parsePrivateBetaNotesPage({ version: 1, program_id: program, program_generation: "1", items: fixture().notes, page_size: 25, has_more: true, next_cursor: cursor });
    mocks.rpc.mockImplementation(async name => ({ data: name === "admin_private_beta_notes_page_v1" ? notes : fixture(), error: null }));
    const result = await polatOperations(polatSearchSchema.parse({ view: "beta", beta_collection: "notes", cursor: JSON.stringify(cursor) }));
    expect("betaNotes" in result && result.betaNotes?.items).toHaveLength(1);
    expect(mocks.rpc).toHaveBeenCalledWith("admin_private_beta_workspace_v1", { target_tenant_id: tenant, page_size_value: 25, cursor_value: null });
    expect(mocks.rpc).toHaveBeenCalledWith("admin_private_beta_notes_page_v1", { target_tenant_id: tenant, page_size_value: 25, cursor_value: cursor });
    expect(() => privateBetaCursor(JSON.stringify(cursor))).toThrow(); expect(() => privateBetaNotesCursor(JSON.stringify({ ...cursor, collection: undefined }))).toThrow();
    expect(polatSearchSchema.safeParse({ view: "responses", beta_collection: "notes" }).success).toBe(false);
    const href = privateBetaHref("25", cursor, "notes"); expect(href).toContain("beta_collection=notes"); expect(href).toContain("cursor=");
  });
  it("discards stale note generations instead of exposing mixed-revision evidence", async () => {
    mocks.rpc.mockImplementation(async name => ({ data: name === "admin_private_beta_notes_page_v1" ? { version: 1, program_id: program, program_generation: "2", items: [{ ...fixture().notes[0], note: "PRIVATE_STALE_REVISION" }], page_size: 25, has_more: false, next_cursor: null } : fixture(), error: null }));
    const result = await polatOperations(polatSearchSchema.parse({ view: "beta", beta_collection: "notes" }));
    expect(result.error).toBe("cursor"); expect("betaNotes" in result && result.betaNotes).toBeNull(); expect(JSON.stringify(result)).not.toContain("PRIVATE_STALE_REVISION");
  });
  it.each(["tr-TR", "en-US"] as const)("renders bounded complete-note navigation without reusing attempt cursors in %s", locale => {
    const cursor = { v: 1, collection: "notes", tenant, user, role: "super_admin", size: 25, program, generation: "1", anchor: { at, id: item }, before: { at, id: item }, expires: "2026-10-26T10:30:00Z", seal: "f".repeat(64) };
    const notesPage = parsePrivateBetaNotesPage({ version: 1, program_id: program, program_generation: "1", items: fixture().notes, page_size: 25, has_more: true, next_cursor: cursor });
    const html = render(h(AdminI18nProvider, { locale }, h(PolatPrivateBeta, { workspace: fixture(), invalid: false, denied: false, size: "25", canConfigure: false, canNote: false, canConversation: true, operators: null, collection: "notes", notesPage })));
    expect(html).toContain(privateBetaText(locale, "nextNotes")); expect(html).toContain(privateBetaText(locale, "allNotes")); expect(html).toContain("beta_collection=notes"); expect(html).toContain("cursor="); expect(html).not.toContain("<th>Scope</th>");
  });
  it("rejects misleading budgets, redaction drift, unknown cost substitutions and invalid staff rows", () => {
    const value = fixture();
    expect(() => parsePrivateBetaWorkspace({ ...value, program: null })).toThrow();
    expect(() => parsePrivateBetaWorkspace({ ...value, has_more: true })).toThrow();
    expect(() => parsePrivateBetaWorkspace({ ...value, program: { ...value.program, reserved_liability: "0.02e3" } })).toThrow();
    expect(() => parsePrivateBetaWorkspace({ ...value, program: { ...value.program, currency: null } })).toThrow();
    expect(() => parsePrivateBetaWorkspace({ ...value, participants: [{ ...value.participants[0], maximum_requests: 30 }] })).toThrow();
    expect(() => parsePrivateBetaOperators([{ user_id: user, role: "super_admin", email: "not-for-client@example.test" }], user)).toThrow();
  });
  it.each(["tr-TR", "en-US"] as const)("renders actual existing shell/tab with truthful states in %s", async locale => {
    const result = await polatOperations(query());
    const html = render(h(AdminI18nProvider, { locale }, h(PolatOperationsView, { search: query(), result, canConversation: true, canCase: true })));
    expect(html).toContain(privateBetaText(locale, "boundary")); expect(html).toContain(privateBetaText(locale, "unknown")); expect(html).toContain("view=beta");
    expect(html).toContain("/admin/conversations/" + conversation); expect(html).toContain("&lt;script&gt;not executable&lt;/script&gt;");
    expect(html).not.toContain("Synthetic verification only"); expect(html).not.toMatch(/name="tenant"|name="verified"|name="execution_enabled"|force-send|authorization_record_hash|dispatch_key/u);
  });
  it("renders a genuinely missing program without inventing calls, costs or participant rows", () => {
    const value = fixture(), empty = parsePrivateBetaWorkspace({ ...value, program: null, participants: [], attempts: [], notes: [] });
    const html = render(h(AdminI18nProvider, { locale: "en-US" }, h(PolatPrivateBeta, { workspace: empty, invalid: false, denied: false, size: "25", canConfigure: true, canNote: true, canConversation: true, operators: [] })));
    expect(html).toContain("No private beta program exists"); expect(html).toContain("Create Isolated UAT Tenant"); expect(html).not.toContain("UAT_FIXTURE_UNKNOWN"); expect(html).toContain('name="retention_days"'); expect(html).not.toContain('name="execution_enabled"');
  });
  it("renders independently reconciled exact billing separately from unknown or restricted cost", () => {
    const value = fixture();
    const known = parsePrivateBetaWorkspace({ ...value, program: { ...value.program, actual_billed_amount: "0.001234567890123456", billing_status: "INDEPENDENTLY_RECONCILED" }, attempts: [{ ...value.attempts[0], actual_billed_amount: "0.001234567890123456", billing_status: "INDEPENDENTLY_RECONCILED" }] });
    const html = render(h(AdminI18nProvider, { locale: "en-US" }, h(PolatPrivateBeta, { workspace: known, invalid: false, denied: false, size: "25", canConfigure: false, canNote: false, canConversation: true, operators: null })));
    expect(html).toContain("0.001234567890123456");
    expect(() => parsePrivateBetaWorkspace({ ...value, program: { ...value.program, actual_billed_amount: "0", billing_status: "UNKNOWN" } })).toThrow();
    expect(() => parsePrivateBetaWorkspace({ ...value, program: { ...value.program, actual_billed_amount: 0, billing_status: "INDEPENDENTLY_RECONCILED" } })).toThrow();
    const restricted = parsePrivateBetaWorkspace({ ...value, program: { ...value.program, actual_billed_amount: null, reserved_liability: null, currency: null, billing_status: "ROLE_RESTRICTED" }, attempts: [{ ...value.attempts[0], billing_status: "ROLE_RESTRICTED" }] });
    const safe = render(h(AdminI18nProvider, { locale: "en-US" }, h(PolatPrivateBeta, { workspace: restricted, invalid: false, denied: false, size: "25", canConfigure: false, canNote: false, canConversation: true, operators: null })));
    expect(safe).toContain("Restricted for this role"); expect(safe).not.toContain("0.0200");
  });
  it("separates actual-source informal tester feedback from operator notes and formal review", () => {
    const note = { author: "TESTER", scenario: "INFORMAL_UAT_FEEDBACK", note: JSON.stringify({ review_kind: "INFORMAL_UAT_FEEDBACK", useful: 4, natural: 3, correct: 5, satisfied: 4 }) };
    expect(privateBetaFeedback(note)?.natural).toBe(3); expect(privateBetaFeedback({ ...note, author: "OPERATOR" })).toBeNull(); expect(privateBetaFeedback({ ...note, note: '{"review_kind":"INFORMAL_UAT_FEEDBACK","useful":9}' })).toBeNull();
    const value = fixture(), workspace = parsePrivateBetaWorkspace({ ...value, notes: [{ ...value.notes[0], ...note }] });
    const html = render(h(AdminI18nProvider, { locale: "en-US" }, h(PolatPrivateBeta, { workspace, invalid: false, denied: false, size: "25", canConfigure: false, canNote: false, canConversation: true, operators: null })));
    expect(html).toContain("Participant&#x27;s informal beta feedback"); expect(html).toContain("not independent blind human review"); expect(html).toContain("Satisfaction");
  });
  it("labels system observations without inventing a human author and exposes note-history navigation", () => {
    const value = fixture(), workspace = parsePrivateBetaWorkspace({ ...value, notes_has_more: true, notes: [{ ...value.notes[0], author: "SYSTEM", note: "Safe automated observation" }] });
    const html = render(h(AdminI18nProvider, { locale: "en-US" }, h(PolatPrivateBeta, { workspace, invalid: false, denied: false, size: "25", canConfigure: false, canNote: false, canConversation: true, operators: null })));
    expect(html).toContain("System observation"); expect(html).toContain("beta_collection=notes"); expect(html).not.toContain("Operator test note · UAT_FIXTURE_UNKNOWN");
  });
  it("known provider ACK is never represented as customer-read evidence", () => {
    expect(messageDeliveryLabel("sent")).toBe("Telegram API onayı alındı"); expect(manualReplyResult(true, { status: "sent" })).toContain("Müşterinin okuduğu doğrulanmadı"); expect(messageDeliveryLabel("failed", "TELEGRAM_DELIVERY_UNCERTAIN")).toContain("belirsiz");
  });
  it("canary response presentation binds actual scope, preserves unknown billing and rejects invented approvals", () => {
    const raw = canaryFixture(); expect(parsePrivateBetaCanaryResult(raw, program, "a".repeat(40)).actual_billed_amount).toBeNull();
    expect(() => parsePrivateBetaCanaryResult(raw, item, "a".repeat(40))).toThrow(); expect(() => parsePrivateBetaCanaryResult(raw, program, "f".repeat(40))).toThrow();
    expect(() => parsePrivateBetaCanaryResult({ ...raw, qa: "HELD" }, program, "a".repeat(40))).toThrow(); expect(() => parsePrivateBetaCanaryResult({ ...raw, actual_billed_amount: "0", execution_enabled: true }, program, "a".repeat(40))).toThrow();
    expect(parsePrivateBetaCanaryResult({ ...raw, status: "CANARY_HELD", qa: "HELD", response_preview: null }, program, "a".repeat(40)).response_preview).toBeNull();
  });
  it("TEST invoice acknowledgement never becomes a receipt or live financial authority", () => {
    expect(parsePrivateBetaStarsInvoiceResult({ status: "TEST_INVOICE_ACKNOWLEDGED", invoice_id: item, origin: "TELEGRAM_DEDICATED_TEST", financial_authority: "NONE", receipt_created: false }).status).toBe("TEST_INVOICE_ACKNOWLEDGED");
    expect(() => parsePrivateBetaStarsInvoiceResult({ status: "TEST_INVOICE_ACKNOWLEDGED", invoice_id: item, origin: "TELEGRAM_DEDICATED_TEST", financial_authority: "LIVE", receipt_created: true })).toThrow();
  });
  it("owner controls render without automatic requests and remain unavailable to non-owner views", () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("OFFLINE_NETWORK_MUST_NOT_RUN"));
    try {
      const value = fixture(), workspace = parsePrivateBetaWorkspace({ ...value, program: { ...value.program, stage: "CANARY", canary_state: "NOT_STARTED", account_state: "MISSING" } });
      const html = render(h(AdminI18nProvider, { locale: "en-US" }, h(PolatPrivateBeta, { workspace, invalid: false, denied: false, size: "25", canConfigure: true, canNote: true, canConversation: true, operators: [], starsCommandId: item })));
      expect(html).toContain('action="/api/v1/admin/private-beta/canary"'); expect(html).toContain('action="/api/v1/admin/private-beta/stars-test-invoice"'); expect(html).toContain("genuine, potentially billable"); expect(html).toContain("separate TEST environment"); expect(html).toContain('name="command_id"'); expect(html).toContain("Execution is blocked");
      const restricted = render(h(AdminI18nProvider, { locale: "en-US" }, h(PolatPrivateBeta, { workspace, invalid: false, denied: false, size: "25", canConfigure: false, canNote: false, canConversation: true, operators: null })));
      expect(restricted).not.toContain('action="/api/v1/admin/private-beta/canary"'); expect(restricted).not.toContain('action="/api/v1/admin/private-beta/stars-test-invoice"'); expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });
  it("owner form POST is one same-origin bounded request with no retry or hidden authority fields", async () => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json(canaryFixture()));
    const result = await submitPrivateBetaOwnerForm("/api/v1/admin/private-beta/canary", new URLSearchParams({ program_id: program }), network);
    expect(result).toEqual(canaryFixture()); expect(network).toHaveBeenCalledTimes(1); const [url, options] = network.mock.calls[0]!;
    expect(url).toBe("/api/v1/admin/private-beta/canary"); expect(options).toMatchObject({ method: "POST", credentials: "same-origin", redirect: "error" }); expect(String(options?.body)).toBe("program_id=" + program); expect(new Headers(options?.headers).get("content-type")).toBe("application/x-www-form-urlencoded");
    await expect(submitPrivateBetaOwnerForm("/api/v1/admin/private-beta/canary", new URLSearchParams({ program_id: program, execution_enabled: "true" }), network)).rejects.toThrow(); expect(network).toHaveBeenCalledTimes(1);
  });
  it.each(["failure", "unknown", "oversized"])("owner %s result is held without another request or body reflection", async kind => {
    const network = kind === "unknown" ? vi.fn<typeof fetch>().mockRejectedValue(Error("OFFLINE_SECRET_DIAGNOSTIC")) : vi.fn<typeof fetch>().mockResolvedValue(new Response(kind === "oversized" ? "x".repeat(8193) : "OFFLINE_SECRET_DIAGNOSTIC", { status: kind === "oversized" ? 200 : 409 }));
    await expect(submitPrivateBetaOwnerForm("/api/v1/admin/private-beta/canary", new URLSearchParams({ program_id: program }), network)).rejects.toThrow(); expect(network).toHaveBeenCalledTimes(1);
  });
  it("can export safe actual component previews without real conversations", async () => {
    if (!process.env.PRIVATE_BETA_PREVIEW_DIR) return;
    mkdirSync(process.env.PRIVATE_BETA_PREVIEW_DIR, { recursive: true }); const css = readFileSync("apps/web/src/app/globals.css", "utf8"); const result = await polatOperations(query());
    for (const locale of ["tr-TR", "en-US"] as const) writeFileSync(`${process.env.PRIVATE_BETA_PREVIEW_DIR}/private-beta-${locale}.html`, `<!doctype html><html lang="${locale}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${render(h(AdminWorkspaceFrame, { locale, tenantName: "SYNTHETIC UAT UI FIXTURE", userLabel: "synthetic@example.test", role: "super_admin" }, h(PolatOperationsView, { search: query(), result, canConversation: true, canCase: true })))}</body></html>`);
  });
});

describe("Private beta authenticated append-only configuration actions", () => {
  it("DRAFT configuration is tenant-owned and does not call account activation", async () => {
    mocks.rpc.mockResolvedValue({ data: { program_id: item, stage: "DRAFT", generation: "1" }, error: null });
    const response = await configurePrivateBeta(idle, form({ command_id: item, tenant_id: "other-tenant", repository_sha: "a".repeat(40), retention_days: "7" }));
    expect(response).toEqual({ kind: "success", code: "SAVED" });
    const [name, args] = mocks.rpc.mock.calls[0]!; expect(name).toBe("admin_private_beta_create_v1"); expect(args.target_tenant_id).toBe(tenant);
    expect(JSON.parse(args.configuration_value)).toEqual({ repository_sha: "a".repeat(40), starts_at: null, expires_at: null, retention_days: 7, notice_version: "polat-private-beta-notice-v1", primary_operator: null, backup_operator: null });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toMatch(/activate|authorize|grant_account/u);
  });
  it("repeated or malformed fields are rejected before any write", async () => {
    const input = form({ command_id: item, retention_days: "7" }); input.append("retention_days", "30");
    expect(await configurePrivateBeta(idle, input)).toEqual({ kind: "error", code: "INVALID" }); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not silently assign Polat primary and founder backup to the same account", async () => {
    expect(await configurePrivateBeta(idle, form({ command_id: item, primary_operator: user, backup_operator: user }))).toEqual({ kind: "error", code: "INVALID" }); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["manager", "support", "analyst", "readonly"])("%s cannot bootstrap or create invitation authority", async role => {
    mocks.require.mockResolvedValue({ tenantId: tenant, userId: user, role });
    expect((await createPrivateBetaTenant(idle, form({ command_id: item }))).kind).toBe("error");
    expect((await createPrivateBetaInvitation(idle, form({ command_id: item, program_id: program, kind: "FRIEND" }))).kind).toBe("error"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("tenant bootstrap requires actual authenticated source membership and returns outbound disabled", async () => {
    mocks.rpc.mockResolvedValue({ data: { tenant_id: item, slug: "polat-private-beta-test", outbound_enabled: false }, error: null });
    expect(await createPrivateBetaTenant(idle, form({ command_id: item }))).toEqual({ kind: "success", code: "TENANT_CREATED", tenantId: item });
    expect(mocks.rpc).toHaveBeenCalledWith("admin_private_beta_bootstrap_tenant_v1", { source_tenant_id: tenant, new_tenant_id: item });
  });
  it("does not claim a write succeeded when MFA or DB enforcement denies it", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "28000", message: "PRIVATE_AUTH_DIAGNOSTIC" } });
    const result = await configurePrivateBeta(idle, form({ command_id: item })); expect(result).toEqual({ kind: "error", code: "MFA_REQUIRED" }); expect(JSON.stringify(result)).not.toContain("PRIVATE_AUTH_DIAGNOSTIC");
  });
  it("one-time invitation secrets are not reconstructed after a replay", async () => {
    mocks.rpc.mockResolvedValue({ data: { invite_id: item, code: null, expires_at: at, kind: "FRIEND", replay: true }, error: null });
    expect(await createPrivateBetaInvitation(idle, form({ program_id: program, command_id: item, kind: "FRIEND" }))).toEqual({ kind: "success", code: "INVITATION_ALREADY_CREATED" });
  });
  it("notes bind to server tenant and keep operator/account identity out of client result", async () => {
    mocks.require.mockResolvedValue({ tenantId: tenant, userId: user, role: "support" }); mocks.rpc.mockResolvedValue({ data: { recorded: true, note_id: item }, error: null });
    const result = await recordPrivateBetaNote(idle, form({ program_id: program, conversation_id: conversation, scenario: "HANDOFF", outcome: "NOT_TESTED", note: "No actual operator acceptance yet.", command_id: item }));
    expect(result).toEqual({ kind: "success", code: "SAVED" }); expect(mocks.rpc).toHaveBeenCalledWith("admin_private_beta_note_v1", expect.objectContaining({ target_tenant_id: tenant, conversation_id_value: conversation, outcome_value: "NOT_TESTED" })); expect(JSON.stringify(result)).not.toContain(user);
  });
  it("operator acceptance requires its own authenticated MFA database operation", async () => {
    mocks.rpc.mockResolvedValue({ data: { accepted: true }, error: null });
    expect(await acceptPrivateBetaOperator(idle, form({ program_id: program }))).toEqual({ kind: "success", code: "OPERATOR_ACCEPTED" });
    expect(mocks.rpc).toHaveBeenCalledWith("admin_private_beta_operator_accept_v1", { target_tenant_id: tenant, program_id_value: program });
    mocks.require.mockResolvedValue({ tenantId: tenant, userId: user, role: "support" }); mocks.rpc.mockClear();
    expect((await acceptPrivateBetaOperator(idle, form({ program_id: program }))).kind).toBe("error"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});


describe("OpenAI and founder-only account setup reuse authenticated private-beta controls", () => {
  const discovery = () => ({ version: 1 as const, program_id: program, tenant_id: tenant, repository_sha: "a".repeat(40), program_generation: "1", bot_id: "88001000", source_hash: "b".repeat(64), observed_at: at, expires_at: "2026-10-26T10:05:00Z", candidates: [{ business_connection_id: "synthetic_private_connection", representative_user_id: "88001001", update_id: "1", source_hash: "c".repeat(64), founder_chat_ids: ["88001002"] }] });
  it("binds private discovery to tenant, program, SHA, generation and bounded validity without credential exposure", () => {
    const expected = { tenantId: tenant, programId: program, generation: "1", repositorySha: "a".repeat(40) };
    expect(parsePrivateBetaBusinessDiscovery(discovery(), expected)?.candidates).toHaveLength(1);
    for (const replacement of [{ tenantId: item }, { programId: item }, { generation: "2" }, { repositorySha: "f".repeat(40) }]) expect(() => parsePrivateBetaBusinessDiscovery(discovery(), { ...expected, ...replacement })).toThrow();
    expect(() => parsePrivateBetaBusinessDiscovery({ ...discovery(), credential_sha256: "d".repeat(64) }, expected)).toThrow();
    expect(() => parsePrivateBetaBusinessDiscovery({ ...discovery(), raw_body: "NOT_ALLOWED" }, expected)).toThrow();
    expect(() => parsePrivateBetaBusinessDiscovery({ ...discovery(), expires_at: "2026-10-26T10:05:01Z" }, expected)).toThrow();
  });
  it.each(["manager", "support"])("%s never requests or receives private account candidate discovery", async role => {
    mocks.require.mockResolvedValue({ tenantId: tenant, userId: user, role });
    const result = await polatOperations(query());
    expect("betaBusinessDiscovery" in result && result.betaBusinessDiscovery).toBeNull();
    expect(mocks.rpc.mock.calls.some(([name]) => name === "admin_private_beta_business_discovery_v1" || name === "admin_private_beta_business_scope_v1")).toBe(false);
  });
  it.each(["tr-TR", "en-US"] as const)("%s shows candidates only in the owner form and never as verified authority", locale => {
    const workspace = fixture();
    const props = { workspace, invalid: false, denied: false, size: "25", canNote: false, canConversation: true, operators: null, businessDiscovery: discovery() };
    const html = render(h(AdminI18nProvider, { locale }, h(PolatPrivateBeta, { ...props, canConfigure: true })));
    expect(html).toContain("synthetic_private_connection");
    expect(html).toContain("88001001");
    expect(html).toContain("88001002");
    expect(html).toContain(locale === "tr-TR" ? "bağlantı veya gönderim yetkisi değildir" : "not connection or sending authority");
    expect(html).not.toContain("credential_sha256");
    const restricted = render(h(AdminI18nProvider, { locale }, h(PolatPrivateBeta, { ...props, canConfigure: false })));
    expect(restricted).not.toContain("synthetic_private_connection");
    expect(restricted).not.toContain("88001001");
    expect(restricted).not.toContain("88001002");
  });
  it("selects the exact model only through the owner/MFA RPC and authenticated tenant", async () => {
    mocks.rpc.mockResolvedValue({ data: { program_id: program, provider: "openai", model: "gpt-6.1-sol", generation: "2" }, error: null });
    expect(await selectPrivateBetaOpenAI(idle, form({ program_id: program, expected_generation: "1" }))).toEqual({ kind: "success", code: "SAVED" });
    expect(mocks.rpc).toHaveBeenCalledWith("admin_private_beta_select_openai_v1", { target_tenant_id: tenant, program_id_value: program, expected_generation_value: 1 });
    mocks.rpc.mockClear(); mocks.require.mockResolvedValue({ tenantId: tenant, userId: user, role: "support" });
    expect((await selectPrivateBetaOpenAI(idle, form({ program_id: program, expected_generation: "1" }))).code).toBe("DENIED"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("preserves selected OpenAI notice and model on ordinary draft saves", async () => {
    mocks.rpc.mockResolvedValue({ data: { program_id: program, stage: "DRAFT", generation: "2" }, error: null });
    await configurePrivateBeta(idle, form({ program_id: program, model_provider: "openai", model_name: "gpt-6.1-sol", retention_days: "7" }));
    const args = mocks.rpc.mock.calls[0]![1]; const config = JSON.parse(args.configuration_value);
    expect(config).toMatchObject({ model_provider: "openai", model_name: "gpt-6.1-sol", notice_version: "polat-private-beta-notice-openai-v1" });
    expect(args.target_tenant_id).toBe(tenant);
    mocks.rpc.mockClear(); await configurePrivateBeta(idle, form({ program_id: program, model_provider: "openai", model_name: "gpt-6-luna" })); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("only configures numeric founder/representative scope; recording it is not provider verification", async () => {
    mocks.rpc.mockResolvedValue({ data: { program_id: program, mode: "BUSINESS", business_generation: "1", program_generation: "2", state: "UNVERIFIED" }, error: null });
    const values = { program_id: program, expected_generation: "1", representative_user_id: "88001001", founder_chat_id: "88001002", business_connection_id: "synthetic_connection_only" };
    expect(await configurePrivateBetaBusiness(idle, form(values))).toEqual({ kind: "success", code: "SAVED" });
    expect(mocks.rpc).toHaveBeenCalledWith("admin_private_beta_business_configure_v1", { target_tenant_id: tenant, program_id_value: program, expected_generation_value: 1, configuration_value: JSON.stringify({ representative_user_id: "88001001", founder_chat_id: "88001002", business_connection_id: "synthetic_connection_only" }) });
    mocks.rpc.mockClear(); await configurePrivateBetaBusiness(idle, form({ ...values, representative_user_id: "@not_identity" })); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("reverification is a separately tracked requirement, not an ACK, resend or automatic AI return", async () => {
    mocks.rpc.mockResolvedValue({ data: { program_id: program, business_generation: "3", state: "INDEPENDENT_REVERIFICATION_REQUIRED" }, error: null });
    expect((await reverifyPrivateBetaBusiness(idle, form({ program_id: program, business_generation: "2" }))).code).toBe("SAVED");
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["admin_private_beta_business_reverify_v1"]);
  });
  it("business projections reject wrong programs and secret/authority additions", () => {
    const scope = { version: 1, mode: "BUSINESS", program_id: program, business_generation: "1", program_generation: "2", state: "CONFIGURED_UNVERIFIED", representative_user_id: "88001001", founder_chat_id: "88001002", connection_hash: "a".repeat(64), configured_at: at, observed_at: null, expires_at: null, last_inbound_at: null, restriction_reason: null, financial_authority: "NONE" };
    expect(parsePrivateBetaBusinessScope(scope, program)?.state).toBe("CONFIGURED_UNVERIFIED");
    expect(() => parsePrivateBetaBusinessScope(scope, item)).toThrow();
    expect(() => parsePrivateBetaBusinessScope({ ...scope, token: "NOT_FOR_CLIENT" }, program)).toThrow();
  });
  it("OpenAI canary presentation accepts only its exact model and preserves unknown billing", () => {
    const output = { ...canaryFixture(), provider: "openai", model: "gpt-6.1-sol", provider_response_id: "resp_offline_ui" };
    expect(parsePrivateBetaCanaryResult(output, program, "a".repeat(40)).actual_billed_amount).toBeNull();
    expect(() => parsePrivateBetaCanaryResult({ ...output, model: "claude-haiku-5-5" }, program, "a".repeat(40))).toThrow();
  });
});
