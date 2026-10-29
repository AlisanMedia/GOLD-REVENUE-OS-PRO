"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { campaignConfigurationSchema, campaignPermissionSchema } from "@gold-revenue-os/contracts";
import { requireCustomerTenant } from "@/lib/customer-os/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type CampaignActionState = { state: "IDLE" | "SAVED" | "MFA_REQUIRED" | "INVALID" | "BLOCKED" | "CHANGED" | "UNAVAILABLE" };
const integer = z.string().regex(/^(?:0|[1-9][0-9]{0,6})$/u).transform(Number);
function field(form: FormData, key: string) {
  const values = form.getAll(key);
  if (values.length !== 1 || typeof values[0] !== "string") throw Error("INVALID");
  return values[0].trim();
}
function amount(value: string) {
  if (!/^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,6})?$/u.test(value)) throw Error("INVALID");
  const [whole, fraction = ""] = value.split(".");
  return `${whole}.${fraction.padEnd(6, "0")}`;
}
function markets(form: FormData) { return field(form, "markets").split(",").map(v => v.trim().toUpperCase()); }
function failed(code: string | undefined): CampaignActionState {
  return { state: code === "42501" || code === "28000" ? "MFA_REQUIRED" : code === "22023" ? "INVALID" : code === "40001" || code === "23505" ? "CHANGED" : code === "55000" ? "BLOCKED" : "UNAVAILABLE" };
}
async function invoke(name: string, args: Record<string, unknown>): Promise<CampaignActionState> {
  const context = await requireCustomerTenant(["super_admin"]);
  const db = await createSupabaseServerClient();
  const { data, error } = await db.rpc(name, { target_tenant_id: context.tenantId, ...args });
  if (error || !data) return failed(error?.code);
  revalidatePath("/admin/polat-operations");
  revalidatePath("/admin/imports");
  return { state: "SAVED" };
}

export async function authorizeCampaignImport(_previous: CampaignActionState, form: FormData): Promise<CampaignActionState> {
  try {
    if (field(form, "attested") !== "yes") return { state: "INVALID" };
    const declaration = campaignPermissionSchema.parse({ version: 1, classification: "OWNER_ATTESTED_EXISTING_PERMISSION",
      batch_id: field(form, "batch_id"), dataset_version: field(form, "dataset_version"), dataset_hash: field(form, "dataset_hash"),
      source: field(form, "source"), channel: field(form, "channel"), markets: markets(form), purpose: "SIGNAL_SERVICE_MARKETING", reference: field(form, "reference") });
    return await invoke("admin_campaign_import_authorized_v1", { declaration_value: JSON.stringify(declaration) });
  } catch { return { state: "INVALID" }; }
}

export async function saveCampaign(_previous: CampaignActionState, form: FormData): Promise<CampaignActionState> {
  try {
    const config = campaignConfigurationSchema.parse({ version: 1, name: field(form, "name"), mode: field(form, "mode"),
      batch_id: field(form, "batch_id"), plan_version_id: field(form, "plan_version_id"), markets: markets(form), default_language: "en",
      starts_at: field(form, "starts_at"), expires_at: field(form, "expires_at"),
      maximum_messages: integer.parse(field(form, "maximum_messages")), maximum_per_customer: integer.parse(field(form, "maximum_per_customer")),
      maximum_per_day: integer.parse(field(form, "maximum_per_day")), minimum_interval_seconds: integer.parse(field(form, "minimum_interval_seconds")),
      follow_up_after_seconds: integer.parse(field(form, "follow_up_after_seconds")), maximum_model_calls: integer.parse(field(form, "maximum_model_calls")),
      budget_currency: "USD", budget_amount: amount(field(form, "budget_amount")), maximum_liability_per_call: amount(field(form, "maximum_liability_per_call")),
      maximum_output_tokens: integer.parse(field(form, "maximum_output_tokens")), timezone: field(form, "timezone"),
      window_start: integer.parse(field(form, "window_start")), window_end: integer.parse(field(form, "window_end")),
    });
    return await invoke("admin_campaign_save_v1", { campaign_id_value: z.uuid().parse(field(form, "campaign_id")), expected_revision: integer.parse(field(form, "revision")), configuration_value: JSON.stringify(config) });
  } catch { return { state: "INVALID" }; }
}

export async function changeCampaignState(_previous: CampaignActionState, form: FormData): Promise<CampaignActionState> {
  try {
    return await invoke("admin_campaign_state_v1", { campaign_id_value: z.uuid().parse(field(form, "campaign_id")), expected_revision: integer.parse(field(form, "revision")), action_value: z.enum(["START", "PAUSE", "STOP"]).parse(field(form, "action")) });
  } catch { return { state: "INVALID" }; }
}
