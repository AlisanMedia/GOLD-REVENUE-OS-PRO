import { signalCommercialJourneySchema, reactivationReviewSchema } from "@gold-revenue-os/contracts";
import { canonicalFinancialJson } from "./financial-source-canonical";
import { assessFinancialSource } from "./financial-source";
import { assertPaymentSurface } from "./payments";
import { entitlementValid, subscriptionExpiry, subscriptionTermsSchema } from "./subscriptions";

export function assessSignalCommercialJourney(raw: unknown) {
 const base = { evidence_validation: "OFFLINE_CONSISTENCY_ONLY" as const, classification: "SYNTHETIC" as const, financial_authority: "NONE" as const, signal_access_authority: "NONE" as const,
  live_operations_authorized: false as const, commercial_verdict: "NO_GO" as const, owner_gates: ["C01","C02","C03"] as const };
 try { canonicalFinancialJson(raw); } catch { return { ...base, readiness: "BLOCKED" as const, reasons: ["INVALID_CONTRACT"], payment_source_state: "UNAVAILABLE" }; }
 const parsed = signalCommercialJourneySchema.safeParse(raw);
 if (!parsed.success) return { ...base, readiness: "BLOCKED" as const, reasons: ["INVALID_CONTRACT"], payment_source_state: "UNAVAILABLE" };
 const v = parsed.data, reasons: string[] = []; let blocked = false;
 const add = (reason: string, fatal = false) => { reasons.push(reason); blocked ||= fatal; };
 if (!v.checkout.channel || !v.checkout.surface) add("CHECKOUT_UNRESOLVED", true);
 else { try { assertPaymentSurface(v.checkout.channel, v.checkout.surface); } catch { add("CHECKOUT_POLICY_MISMATCH", true); } }
 const t = v.tenant_id, customer = v.customer_id, now = Date.parse(v.evaluated_at), offer = v.offer, sub = v.subscription, member = v.membership;
 if (!v.controls.fixture_admission_enabled || v.route.paused) add("ADMISSION_DISABLED", true);
 if (v.route.tenant_id !== t || v.route.revision !== v.route.source_revision) add("ROUTE_SCOPE_OR_REVISION", true);
 if (v.route.authorization !== "SYNTHETIC_APPROVED" || !v.route.rights_reference) add("RIGHTS_UNVERIFIED", true);
 if (!offer) add("OFFER_MISSING");
 else {
  if (offer.tenant_id !== t || offer.customer_id !== customer) add("OFFER_SCOPE", true);
  if (offer.state !== "APPROVED" || Date.parse(offer.expires_at) <= now) add("OFFER_UNAVAILABLE");
 }
 let finance: ReturnType<typeof assessFinancialSource> | null = null;
 if (!v.payment) add("PAYMENT_EVIDENCE_MISSING");
 else {
  const p = v.payment, binding = p.source.invoice_binding;
  if (p.source.evidence_origin !== "SYNTHETIC" || p.source.provider_environment !== "FIXTURE") add("NONFIXTURE_SOURCE", true);
  if (p.source.scope.tenant_id !== t || p.context.expected_scope.tenant_id !== t || p.context.now !== v.evaluated_at) add("PAYMENT_SCOPE_OR_CLOCK", true);
  if (!binding || !offer || binding.customer_id !== customer || binding.offer_id !== offer.id || binding.product_version_id !== offer.product_version_id || binding.plan_version_id !== offer.plan_version_id || binding.offer_snapshot_hash !== offer.snapshot_hash) add("PAYMENT_OFFER_BINDING", true);
  finance = assessFinancialSource(p.source, p.context, p.history);
  if (finance.source_state !== "SOURCE_VERIFIED" || finance.fulfillment_eligibility !== "ELIGIBLE") add("PAYMENT_REQUIRES_REVIEW");
 }
 if (!sub) add("SUBSCRIPTION_MISSING");
 else {
  const invoice = v.payment?.source.invoice_binding;
  if (sub.tenant_id !== t || sub.customer_id !== customer || sub.offer_id !== offer?.id || sub.invoice_id !== invoice?.invoice_id || sub.offer_snapshot_hash !== offer?.snapshot_hash || sub.revision !== sub.source_revision) add("SUBSCRIPTION_SCOPE_OR_REVISION", true);
  const terms = subscriptionTermsSchema.safeParse(sub.terms);
  if (!terms.success || subscriptionExpiry(sub.starts_at, terms.data) !== sub.ends_at || Date.parse(sub.grace_until) !== Date.parse(sub.ends_at) + (terms.success ? terms.data.grace_days : 0) * 86400000) add("SUBSCRIPTION_TERMS_MISMATCH", true);
  if (Date.parse(sub.starts_at) > now || !entitlementValid(sub, v.evaluated_at)) add("SUBSCRIPTION_NOT_CURRENT");
 }
 if (!member) add("MEMBERSHIP_EVIDENCE_MISSING");
 else {
  if (member.tenant_id !== t || member.customer_id !== customer || member.subscription_id !== sub?.id || member.destination_id !== v.route.destination_id || member.revision !== member.source_revision) add("MEMBERSHIP_SCOPE_OR_REVISION", true);
  const age = now - Date.parse(member.observed_at);
  if (member.binding_state !== "VERIFIED_FIXTURE" || member.state !== "FAKE_CONFIRMED" || age < 0 || age > member.max_age_seconds * 1000) add("MEMBERSHIP_UNVERIFIED_OR_STALE");
 }
 return { ...base, readiness: blocked ? "BLOCKED" as const : reasons.length ? "REVIEW" as const : "SANDBOX_READY" as const,
  reasons: reasons.slice(0,16), payment_source_state: finance?.source_state ?? "UNAVAILABLE" };
}

export function assessReactivationPreview(raw: unknown) {
 const base = { classification: "SYNTHETIC" as const, import_authority: "NONE" as const, outbound_authority: "NONE" as const, actual_records_processed: 0 as const, customer_language_default: "en" as const };
 try { canonicalFinancialJson(raw); } catch { return { ...base, readiness: "BLOCKED" as const, reasons: ["INVALID_CONTRACT"] }; }
 const parsed = reactivationReviewSchema.safeParse(raw);
 if (!parsed.success) return { ...base, readiness: "BLOCKED" as const, reasons: ["INVALID_CONTRACT"] };
 const v = parsed.data, reasons: string[] = [], now = Date.parse(v.evaluated_at);
 if (v.source_kind === "ANONYMOUS_FEEDBACK") reasons.push("ANONYMOUS_SOURCE_PROHIBITED");
 if (v.tenant_ownership !== "REVIEWED_FIXTURE" || v.data_use_rights !== "REVIEWED_FIXTURE" || !v.data_use_reference) reasons.push("DATA_RIGHTS_UNVERIFIED");
 if (v.lawful_basis === "UNKNOWN" || !v.lawful_basis_reference || v.jurisdiction_review !== "REVIEWED_FIXTURE") reasons.push("LAWFUL_SCOPE_UNVERIFIED");
 if (v.marketing_permission !== "VERIFIED_FIXTURE" || !v.marketing_reference || !v.marketing_scope.includes(v.channel === "TELEGRAM" ? "TELEGRAM_REACTIVATION" : "EMAIL_REACTIVATION")) reasons.push("MARKETING_SCOPE_UNVERIFIED");
 if (v.contactability !== "ALLOWED_FIXTURE" || v.suppressed || v.opted_out || v.takeover || v.open_escalation) reasons.push("CONTACT_SUPPRESSED");
 if (!v.retention_until || Date.parse(v.retention_until) <= now || v.legal_hold || !v.permission_expires_at || Date.parse(v.permission_expires_at) <= now) reasons.push("RETENTION_OR_PERMISSION_REVIEW");
 if (!v.history_complete || v.max_contacts === null || v.recent_contacts >= v.max_contacts) reasons.push("FREQUENCY_REVIEW");
 if (!v.timezone || !v.window_start || !v.window_end) reasons.push("CONTACT_WINDOW_UNKNOWN");
 else {
  try {
   const parts = new Intl.DateTimeFormat("en-GB", { timeZone: v.timezone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(v.evaluated_at));
   const clock = `${parts.find(p => p.type === "hour")!.value}:${parts.find(p => p.type === "minute")!.value}`;
   const allowed = v.window_start < v.window_end ? clock >= v.window_start && clock < v.window_end : v.window_start > v.window_end && (clock >= v.window_start || clock < v.window_end);
   if (!allowed) reasons.push("OUTSIDE_CONTACT_WINDOW");
  } catch { reasons.push("CONTACT_WINDOW_UNKNOWN"); }
 }
 return { ...base, readiness: reasons.length ? "BLOCKED" as const : "PREVIEW_CANDIDATE" as const, reasons };
}
