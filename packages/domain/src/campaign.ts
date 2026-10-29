import { createHash } from "node:crypto";
import { campaignConfigurationSchema, campaignPermissionSchema, type CampaignConfiguration } from "@gold-revenue-os/contracts";
import { canonicalFinancialJson } from "./financial-source-canonical";
import { buildPolatSalesPreview } from "./polat-sales";

export function campaignPermissionHash(raw: unknown) {
  return createHash("sha256").update(canonicalFinancialJson(campaignPermissionSchema.parse(raw)), "utf8").digest("hex");
}

/** Pure policy evaluation never supplies platform permission or provider-account authority. */
export function assessCampaignContact(input: {
  configuration: unknown; permission: unknown; market: string | null;
  contactability: "user_initiated" | "allowed" | "unknown" | "blocked" | "revoked";
  numericIdentityMatched: boolean; existingPrivateChat: boolean; platformWindowOpen: boolean;
  optedOut: boolean; suppressed: boolean; humanOwned: boolean; openCase: boolean;
}) {
  const config = campaignConfigurationSchema.parse(input.configuration);
  const declaration = campaignPermissionSchema.parse(input.permission), reasons: string[] = [];
  if (declaration.batch_id !== config.batch_id || config.markets.some(m => !declaration.markets.includes(m))) reasons.push("PERMISSION_SCOPE_MISMATCH");
  if (!input.market || !config.markets.includes(input.market)) reasons.push("MARKET_UNKNOWN_OR_EXCLUDED");
  if (input.optedOut || input.suppressed || ["blocked", "revoked"].includes(input.contactability)) reasons.push("CONTACT_SUPPRESSED");
  if (!input.numericIdentityMatched || !input.existingPrivateChat || !input.platformWindowOpen
    || !["user_initiated", "allowed"].includes(input.contactability)) reasons.push("PLATFORM_ROUTE_UNAVAILABLE");
  if (input.humanOwned || input.openCase) reasons.push("HUMAN_OWNERSHIP");
  return { eligible: reasons.length === 0, reasons, provenance: declaration.classification,
    individually_verified_consent: false, financial_authority: "NONE" } as const;
}

export function campaignWithinContactWindow(config: CampaignConfiguration, at: Date) {
  if (!Number.isFinite(+at)) throw Error("CAMPAIGN_CLOCK_INVALID");
  const hour = Number(new Intl.DateTimeFormat("en", { timeZone: config.timezone, hourCycle: "h23", hour: "2-digit" }).format(at));
  return config.window_start < config.window_end
    ? hour >= config.window_start && hour < config.window_end
    : hour >= config.window_start || hour < config.window_end;
}

/** Reuses the accepted Polat sales/Phase7 QA path. There is no per-message owner review. */
export function prepareCampaignSalesReply(input: { sales: unknown; approvedPlanVersion: string; campaignActive: boolean }) {
  const result = buildPolatSalesPreview(input.sales);
  const allowed = input.campaignActive && result.quality.action === "SAFE_PREVIEW"
    && !result.handoff.required && result.next_action !== "STOP_CONTACT"
    && (!result.selection || result.selection.plan_version_id === input.approvedPlanVersion);
  return { ...result, campaign_disposition: allowed ? "QA_APPROVED_AUTOMATIC" : "HELD",
    owner_message_approval_required: false,
    // A prepared reply is neither queued nor delivered and confers no genuine execution authority.
    delivery: "NOT_SENT", financial_authority: "NONE", live_operations_authorized: false } as const;
}

export function campaignLiability(config: unknown, initiated: number) {
  const v = campaignConfigurationSchema.parse(config);
  if (!Number.isSafeInteger(initiated) || initiated < 0) throw Error("CAMPAIGN_ATTEMPT_INVALID");
  const reserved = BigInt(initiated) * BigInt(v.maximum_liability_per_call.replace(".", ""));
  const cap = BigInt(v.budget_amount.replace(".", ""));
  return { may_reserve: initiated < v.maximum_model_calls && reserved + BigInt(v.maximum_liability_per_call.replace(".", "")) <= cap,
    reserved_microunits: reserved.toString(), actual_billed_cost: null, cost_status: "UNKNOWN" } as const;
}
