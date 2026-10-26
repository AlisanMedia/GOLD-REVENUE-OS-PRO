import { z } from "zod";
import { privateBetaNotesPageSchema, privateBetaWorkspaceSchema, type PrivateBetaWorkspace } from "@gold-revenue-os/contracts";

const position = z.strictObject({ at: z.iso.datetime({ offset: true }), id: z.uuid() });
const amount = z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/u).refine(value => value.replace(".", "").length <= 30);
const staffRows = z.array(z.strictObject({ user_id: z.uuid(), role: z.enum(["super_admin", "manager"]) })).max(100);
const feedback = z.strictObject({ review_kind: z.literal("INFORMAL_UAT_FEEDBACK"), useful: z.number().int().min(1).max(5), natural: z.number().int().min(1).max(5), correct: z.number().int().min(1).max(5), satisfied: z.number().int().min(1).max(5) });
const canaryResult = z.strictObject({
  version: z.literal(1), stage: z.literal("CANARY"), status: z.enum(["CANARY_ACCOUNTING_RECONCILIATION_PENDING", "CANARY_HELD"]),
  program_id: z.uuid(), attempt_id: z.uuid(), request_id: z.uuid(), repository_sha: z.string().regex(/^[a-f0-9]{40}$/u),
  plan_hash: z.string().regex(/^[a-f0-9]{64}$/u), corpus_hash: z.string().regex(/^[a-f0-9]{64}$/u), provider: z.literal("anthropic"), model: z.literal("claude-haiku-5-5"),
  provider_response_id: z.string().min(1).max(160), response_hash: z.string().regex(/^[a-f0-9]{64}$/u), elapsed_ms: z.string().regex(/^(0|[1-9][0-9]{0,7})(?:\.[0-9]{1,8})?$/u).nullable(),
  input_tokens: z.number().int().min(0).max(2147483647).nullable(), output_tokens: z.number().int().min(0).max(2147483647).nullable(), qa: z.enum(["APPROVED", "HELD"]), response_preview: z.string().min(1).max(600).nullable(),
  actual_billed_amount: z.null(), actual_billed_currency: z.null(), billing_status: z.literal("UNKNOWN_REQUIRES_INDEPENDENT_RECONCILIATION"),
  automatic_retries: z.literal(0), telegram_messages: z.literal(0), financial_authority: z.literal("NONE"), founder_testing_enabled: z.literal(false),
});
export function parsePrivateBetaCanaryResult(raw: unknown, programId: string, repositorySha: string) {
  const result = canaryResult.parse(raw);
  if (result.program_id !== programId || result.repository_sha !== repositorySha) throw new Error("BETA_CANARY_RESPONSE_SCOPE");
  if (result.status === "CANARY_ACCOUNTING_RECONCILIATION_PENDING" ? result.qa !== "APPROVED" || result.response_preview === null : result.qa !== "HELD" || result.response_preview !== null) throw new Error("BETA_CANARY_QA_STATUS");
  return result;
}
export type PrivateBetaCanaryResult = z.infer<typeof canaryResult>;
const starsInvoiceResult = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("TEST_INVOICE_ACKNOWLEDGED"), invoice_id: z.uuid(), origin: z.literal("TELEGRAM_DEDICATED_TEST"), financial_authority: z.literal("NONE"), receipt_created: z.literal(false) }),
  z.strictObject({ status: z.literal("EXISTING_TEST_INVOICE_REVIEW"), invoice_id: z.uuid().nullable(), origin: z.literal("TELEGRAM_DEDICATED_TEST"), financial_authority: z.literal("NONE") }),
]);
export function parsePrivateBetaStarsInvoiceResult(raw: unknown) { return starsInvoiceResult.parse(raw); }
export type PrivateBetaStarsInvoiceResult = z.infer<typeof starsInvoiceResult>;

/** Same-origin owner UI only; the authenticated endpoints remain the authority.
 * One POST, no retry/fallback, no secrets, no background invocation. */
export async function submitPrivateBetaOwnerForm(path: "/api/v1/admin/private-beta/canary" | "/api/v1/admin/private-beta/stars-test-invoice", values: URLSearchParams, transport: typeof fetch = fetch): Promise<unknown> {
  if (path !== "/api/v1/admin/private-beta/canary" && path !== "/api/v1/admin/private-beta/stars-test-invoice") throw new Error("PRIVATE_BETA_OWNER_ACTION_SCOPE");
  const keys = path === "/api/v1/admin/private-beta/canary" ? ["program_id"] : ["program_id", "approved_offer_id", "command_id"];
  if ([...values.keys()].length !== keys.length || keys.some(key => values.getAll(key).length !== 1 || !z.uuid().safeParse(values.get(key)).success)) throw new Error("PRIVATE_BETA_OWNER_ACTION_SCOPE");
  const response = await transport(path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(30_000), body: new URLSearchParams(values) });
  if (!response.ok || !response.body) throw new Error("PRIVATE_BETA_OWNER_ACTION_REVIEW");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0, ended = false;
  try {
    for (let index = 0; index < 256; index++) { const part = await reader.read(); if (part.done) { ended = true; break; } bytes += part.value.byteLength; if (bytes > 8192) throw new Error("PRIVATE_BETA_OWNER_ACTION_REVIEW"); chunks.push(part.value); }
    if (!ended) throw new Error("PRIVATE_BETA_OWNER_ACTION_REVIEW");
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const joined = new Uint8Array(bytes); let offset = 0; for (const part of chunks) { joined.set(part, offset); offset += part.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined));
}
export const privateBetaCursorSchema = z.strictObject({
  v: z.literal(1), tenant: z.uuid(), user: z.uuid(), role: z.enum(["super_admin", "manager", "support"]),
  size: z.number().int().min(1).max(100), program: z.uuid(), generation: z.string().regex(/^[1-9][0-9]*$/u),
  anchor: position, before: position, expires: z.iso.datetime({ offset: true }), seal: z.string().regex(/^[a-f0-9]{64}$/u),
});
export const privateBetaNotesCursorSchema = privateBetaCursorSchema.extend({ collection: z.literal("notes") });
export function privateBetaCursor(raw: string) { return privateBetaCursorSchema.parse(JSON.parse(raw)); }
export function privateBetaNotesCursor(raw: string) { return privateBetaNotesCursorSchema.parse(JSON.parse(raw)); }
export function parsePrivateBetaNotesPage(raw: unknown) {
  const result = privateBetaNotesPageSchema.parse(raw);
  if (result.next_cursor !== null) privateBetaNotesCursorSchema.parse(result.next_cursor);
  if (result.has_more !== (result.next_cursor !== null)) throw new Error("BETA_NOTES_PAGE_INCONSISTENT");
  return result;
}
export function parsePrivateBetaWorkspace(raw: unknown): PrivateBetaWorkspace {
  const result = privateBetaWorkspaceSchema.parse(raw);
  if (result.next_cursor !== null) privateBetaCursorSchema.parse(result.next_cursor);
  if (result.has_more !== (result.next_cursor !== null)) throw new Error("BETA_PAGE_INCONSISTENT");
  if (result.program === null && (result.participants.length || result.attempts.length || result.notes.length || result.has_more || result.notes_has_more)) throw new Error("BETA_PROGRAM_MISSING");
  if (result.program) {
    if (result.program.reserved_liability !== null) amount.parse(result.program.reserved_liability);
    if (result.program.actual_billed_amount !== null) amount.parse(result.program.actual_billed_amount);
    if (result.program.currency === null && (result.program.actual_billed_amount !== null || result.program.reserved_liability !== null)) throw new Error("BETA_BILLING_REDACTION");
    if ((result.program.actual_billed_amount !== null) !== (result.program.billing_status === "INDEPENDENTLY_RECONCILED")) throw new Error("BETA_BILLING_STATUS");
  }
  if (result.participants.filter(value => value.kind === "FRIEND").length > 10 || result.participants.filter(value => value.kind === "FOUNDER").length > 1) throw new Error("BETA_PARTICIPANT_LIMIT");
  for (const participant of result.participants) if (participant.model_requests > participant.maximum_requests || participant.maximum_requests !== (participant.kind === "FOUNDER" ? 20 : 30)) throw new Error("BETA_PARTICIPANT_BUDGET");
  for (const attempt of result.attempts) {
    if (attempt.actual_billed_amount !== null) { amount.parse(attempt.actual_billed_amount); if (!result.program?.currency) throw new Error("BETA_BILLING_REDACTION"); }
    if ((attempt.actual_billed_amount !== null) !== (attempt.billing_status === "INDEPENDENTLY_RECONCILED")) throw new Error("BETA_BILLING_STATUS");
  }
  return result;
}
export function parsePrivateBetaOperators(raw: unknown, userId: string | undefined) { return staffRows.parse(raw).map(value => ({ id: value.user_id, role: value.role, current: value.user_id === userId })); }
export function privateBetaFeedback(note: { author: string; scenario: string; note: string }) {
  if (note.author !== "TESTER" || note.scenario !== "INFORMAL_UAT_FEEDBACK") return null;
  try { return feedback.parse(JSON.parse(note.note)); } catch { return null; }
}
export function privateBetaHref(size: string, cursor?: Record<string, unknown> | null, collection: "attempts" | "notes" = "attempts") {
  const params = new URLSearchParams({ view: "beta", size });
  if (collection === "notes") params.set("beta_collection", "notes");
  if (cursor) params.set("cursor", JSON.stringify((collection === "notes" ? privateBetaNotesCursorSchema : privateBetaCursorSchema).parse(cursor)));
  return `/admin/polat-operations?${params}`;
}
export type { PrivateBetaWorkspace };
export type PrivateBetaNotesPage = z.infer<typeof privateBetaNotesPageSchema>;
