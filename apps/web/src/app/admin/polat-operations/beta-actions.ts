"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { privateBetaConfigurationSchema } from "@gold-revenue-os/contracts";
import { requireAdminCapability } from "@/lib/admin/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type BetaActionState = {
  kind: "idle" | "success" | "error";
  code: "IDLE" | "SAVED" | "TENANT_CREATED" | "INVITATION_CREATED" | "INVITATION_ALREADY_CREATED" | "OPERATOR_ACCEPTED" | "INVALID" | "DENIED" | "MFA_REQUIRED" | "LIMIT" | "BLOCKED" | "STALE" | "UNAVAILABLE";
  tenantId?: string;
  invitation?: { code: string; kind: "FOUNDER" | "FRIEND"; expiresAt: string };
};

const commandSchema = z.uuid();
function field(form: FormData, name: string): string | null {
  const values = form.getAll(name);
  if (values.length > 1 || values.some(value => typeof value !== "string")) throw new Error("INVALID");
  return values.length ? String(values[0]).trim() || null : null;
}
function denied(code?: string): BetaActionState {
  return { kind: "error", code: code === "28000" ? "MFA_REQUIRED" : code === "42501" ? "DENIED" : code === "22023" ? "INVALID" : code === "54000" ? "LIMIT" : code === "55000" ? "BLOCKED" : code === "40001" ? "STALE" : "UNAVAILABLE" };
}
async function writeContext(ownerOnly: boolean) {
  const context = await requireAdminCapability("agents.read");
  if (ownerOnly ? context.role !== "super_admin" : !["super_admin", "manager", "support"].includes(context.role)) return null;
  return { context, db: await createSupabaseServerClient() };
}
function refresh() { revalidatePath("/admin/polat-operations"); }

export async function createPrivateBetaTenant(_previous: BetaActionState, form: FormData): Promise<BetaActionState> {
  const auth = await writeContext(true);
  if (!auth) return denied("42501");
  let id: string;
  try { id = commandSchema.parse(field(form, "command_id")); } catch { return denied("22023"); }
  const result = await auth.db.rpc("admin_private_beta_bootstrap_tenant_v1", { source_tenant_id: auth.context.tenantId, new_tenant_id: id });
  const parsed = z.strictObject({ tenant_id: z.uuid(), slug: z.string().min(1).max(80), outbound_enabled: z.literal(false) }).safeParse(result.data);
  if (result.error || !parsed.success) return denied(result.error?.code);
  refresh();
  revalidatePath("/admin", "layout");
  return { kind: "success", code: "TENANT_CREATED", tenantId: parsed.data.tenant_id };
}

export async function configurePrivateBeta(_previous: BetaActionState, form: FormData): Promise<BetaActionState> {
  const auth = await writeContext(true);
  if (!auth) return denied("42501");
  let input: { programId: string; creating: boolean; config: z.infer<typeof privateBetaConfigurationSchema> };
  try {
    const program = field(form, "program_id");
    const rawRetention = field(form, "retention_days");
    if (rawRetention !== null && !/^[1-9][0-9]?$/u.test(rawRetention)) throw new Error("INVALID");
    input = {
      programId: commandSchema.parse(program ?? field(form, "command_id")), creating: program === null,
      config: privateBetaConfigurationSchema.parse({ repository_sha: field(form, "repository_sha"), starts_at: field(form, "starts_at"), expires_at: field(form, "expires_at"), retention_days: rawRetention === null ? null : Number(rawRetention), notice_version: "polat-private-beta-notice-v1", primary_operator: field(form, "primary_operator"), backup_operator: field(form, "backup_operator") }),
    };
    if (input.config.starts_at && input.config.expires_at && Date.parse(input.config.expires_at) <= Date.parse(input.config.starts_at)) throw new Error("INVALID");
    if (input.config.primary_operator && input.config.backup_operator && input.config.primary_operator === input.config.backup_operator) throw new Error("INVALID");
  } catch { return denied("22023"); }
  const result = await auth.db.rpc(input.creating ? "admin_private_beta_create_v1" : "admin_private_beta_configure_v1", { target_tenant_id: auth.context.tenantId, program_id_value: input.programId, configuration_value: JSON.stringify(input.config) });
  const parsed = z.strictObject({ program_id: z.uuid(), stage: z.literal("DRAFT"), generation: z.string().regex(/^[1-9][0-9]*$/u) }).safeParse(result.data);
  if (result.error || !parsed.success) return denied(result.error?.code);
  refresh();
  return { kind: "success", code: "SAVED" };
}

export async function createPrivateBetaInvitation(_previous: BetaActionState, form: FormData): Promise<BetaActionState> {
  const auth = await writeContext(true);
  if (!auth) return denied("42501");
  let input: { program: string; command: string; kind: "FOUNDER" | "FRIEND" };
  try { input = { program: commandSchema.parse(field(form, "program_id")), command: commandSchema.parse(field(form, "command_id")), kind: z.enum(["FOUNDER", "FRIEND"]).parse(field(form, "kind")) }; } catch { return denied("22023"); }
  const result = await auth.db.rpc("admin_private_beta_invite_v1", { target_tenant_id: auth.context.tenantId, program_id_value: input.program, kind_value: input.kind, command_id_value: input.command });
  const parsed = z.strictObject({ invite_id: z.uuid(), code: z.string().regex(/^[A-Za-z0-9_-]{16,160}$/u).nullable(), expires_at: z.iso.datetime({ offset: true }), kind: z.enum(["FOUNDER", "FRIEND"]), replay: z.boolean() }).safeParse(result.data);
  if (result.error || !parsed.success) return denied(result.error?.code);
  refresh();
  return parsed.data.code === null ? { kind: "success", code: "INVITATION_ALREADY_CREATED" } : { kind: "success", code: "INVITATION_CREATED", invitation: { code: parsed.data.code, kind: parsed.data.kind, expiresAt: parsed.data.expires_at } };
}

export async function recordPrivateBetaNote(_previous: BetaActionState, form: FormData): Promise<BetaActionState> {
  const auth = await writeContext(false);
  if (!auth) return denied("42501");
  let input: { program: string; conversation: string | null; scenario: string; outcome: "PASS" | "FAIL" | "NOT_TESTED" | "BLOCKED" | "NOTE"; note: string; command: string };
  try { input = z.strictObject({ program: z.uuid(), conversation: z.uuid().nullable(), scenario: z.string().min(1).max(80), outcome: z.enum(["PASS", "FAIL", "NOT_TESTED", "BLOCKED", "NOTE"]), note: z.string().min(1).max(1000), command: z.uuid() }).parse({ program: field(form, "program_id"), conversation: field(form, "conversation_id"), scenario: field(form, "scenario"), outcome: field(form, "outcome"), note: field(form, "note"), command: field(form, "command_id") }); } catch { return denied("22023"); }
  const result = await auth.db.rpc("admin_private_beta_note_v1", { target_tenant_id: auth.context.tenantId, program_id_value: input.program, conversation_id_value: input.conversation, scenario_value: input.scenario, outcome_value: input.outcome, note_value: input.note, command_id_value: input.command });
  const parsed = z.strictObject({ recorded: z.literal(true), note_id: z.uuid() }).safeParse(result.data);
  if (result.error || !parsed.success) return denied(result.error?.code);
  refresh();
  return { kind: "success", code: "SAVED" };
}

export async function acceptPrivateBetaOperator(_previous: BetaActionState, form: FormData): Promise<BetaActionState> {
  const auth = await writeContext(false);
  if (!auth || !["super_admin", "manager"].includes(auth.context.role)) return denied("42501");
  let program: string;
  try { program = commandSchema.parse(field(form, "program_id")); } catch { return denied("22023"); }
  const result = await auth.db.rpc("admin_private_beta_operator_accept_v1", { target_tenant_id: auth.context.tenantId, program_id_value: program });
  if (result.error || !z.strictObject({ accepted: z.literal(true) }).safeParse(result.data).success) return denied(result.error?.code);
  refresh();
  return { kind: "success", code: "OPERATOR_ACCEPTED" };
}
