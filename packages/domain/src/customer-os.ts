import { createHash } from "node:crypto";

export const CUSTOMER_STATES = [
  "NEW", "CONTACT_READY", "CONTACTED", "REPLIED", "QUALIFIED", "OFFER_SENT",
  "INTERESTED", "NOT_INTERESTED", "SURVEY_OFFERED", "SURVEY_COMPLETED",
  "TRIAL_ACTIVE", "PAYMENT_PENDING", "PAID", "ACCESS_GRANTED", "ACTIVE",
  "RENEWAL_DUE", "RENEWED", "EXPIRED", "CHURNED", "WINBACK",
] as const;

export const IDENTITY_TYPES = ["email", "telegram_username", "telegram_user_id", "external_id", "phone"] as const;
export type IdentityType = (typeof IDENTITY_TYPES)[number];
export type DedupClassification = "exact_match" | "probable_match" | "ambiguous" | "new_customer";
export type CustomerState = (typeof CUSTOMER_STATES)[number];

export const MEMORY_KEYS = [
  "experience_level", "primary_instrument", "trading_style", "risk_preference",
  "preferred_signal_frequency", "previous_service_experience", "pain_points", "objections",
  "communication_style", "preferred_message_length", "price_sensitivity", "trust_level",
  "churn_reason", "last_conversation_summary", "next_best_action", "retention_risk",
] as const;
export type MemoryKey = (typeof MEMORY_KEYS)[number];

export type ValidationError = { field: string; code: string; message: string; raw_value?: string };

export type NormalizedIdentity = {
  identity_type: IdentityType;
  identity_value: string;
  normalized_value: string;
  identity_scope: string;
  is_primary: boolean;
};

export type CustomerProfileInput = Partial<Record<
  | "experience_level" | "primary_instrument" | "trading_style" | "risk_preference"
  | "preferred_signal_frequency" | "communication_style" | "preferred_message_length"
  | "price_sensitivity" | "trust_level" | "churn_reason" | "last_conversation_summary"
  | "next_best_action" | "retention_risk", string
>> & {
  previous_service_experience?: unknown;
  pain_points?: unknown;
  objections?: unknown;
};

export type NormalizedCustomerRow = {
  row_number: number;
  source_record_ref: string;
  display_name: string | null;
  identities: NormalizedIdentity[];
  profile: CustomerProfileInput;
  memory: Array<{ key: MemoryKey; value: unknown; confidence: number }>;
  raw_payload: Record<string, string>;
  normalized_payload: Record<string, unknown>;
  errors: ValidationError[];
  classification: DedupClassification;
  candidate_customer_id: string | null;
  planned_mutation: { action: "link_existing" | "create_customer" | "manual_review"; customer_id?: string };
  identity_fingerprint: string;
};

const FIELD_ALIASES: Record<string, string> = {
  email: "email", "e-mail": "email", mail: "email",
  telegram: "telegram_username", telegram_username: "telegram_username", username: "telegram_username", telegram_handle: "telegram_username",
  telegram_id: "telegram_user_id", telegram_user_id: "telegram_user_id", user_id: "telegram_user_id",
  external_id: "external_id", customer_id: "external_id", customerid: "external_id", id: "external_id",
  phone: "phone", phone_number: "phone", telephone: "phone", tel: "phone",
  name: "display_name", full_name: "display_name", display_name: "display_name", customer_name: "display_name",
  experience: "experience_level", experience_level: "experience_level", trading_experience: "experience_level",
  instrument: "primary_instrument", primary_instrument: "primary_instrument",
  trading_style: "trading_style", style: "trading_style", risk: "risk_preference", risk_preference: "risk_preference",
  signal_frequency: "preferred_signal_frequency", preferred_signal_frequency: "preferred_signal_frequency",
  previous_service_experience: "previous_service_experience", pain_points: "pain_points", objections: "objections",
  communication_style: "communication_style", preferred_message_length: "preferred_message_length",
  price_sensitivity: "price_sensitivity", trust_level: "trust_level", churn_reason: "churn_reason",
  last_conversation_summary: "last_conversation_summary", next_best_action: "next_best_action", retention_risk: "retention_risk",
};

function keyOf(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/[\s-]+/g, "_");
}

function clean(value: string | undefined): string {
  return (value ?? "").normalize("NFKC").trim();
}

export function normalizeIdentity(type: IdentityType, input: string): { value: string | null; error?: ValidationError } {
  const original = clean(input);
  if (!original) return { value: null };
  if (type === "email") {
    const value = original.toLocaleLowerCase("en-US");
    if (value.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return { value: null, error: { field: type, code: "invalid_email", message: "Email format is invalid", raw_value: original } };
    }
    return { value };
  }
  if (type === "telegram_username") {
    const value = original.replace(/^@+/, "").toLocaleLowerCase("en-US");
    if (!/^[a-z0-9_]{5,32}$/.test(value)) {
      return { value: null, error: { field: type, code: "invalid_telegram_username", message: "Telegram username must be 5-32 letters, numbers or underscores", raw_value: original } };
    }
    return { value };
  }
  if (type === "telegram_user_id") {
    const value = original.replace(/^\+/, "");
    if (!/^\d{1,20}$/.test(value)) {
      return { value: null, error: { field: type, code: "invalid_telegram_user_id", message: "Telegram user ID must contain digits only", raw_value: original } };
    }
    return { value };
  }
  if (type === "phone") {
    let digits = original.replace(/[()\s.-]/g, "");
    if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
    if (!digits.startsWith("+")) {
      if (/^0\d{10}$/.test(digits)) digits = `+90${digits.slice(1)}`;
      else if (/^\d{10}$/.test(digits)) digits = `+90${digits}`;
    }
    digits = `+${digits.replace(/\D/g, "")}`;
    if (!/^\+\d{8,15}$/.test(digits)) {
      return { value: null, error: { field: type, code: "invalid_phone", message: "Phone could not be normalized to E.164", raw_value: original } };
    }
    return { value: digits };
  }
  const value = original.toLocaleLowerCase("en-US");
  if (value.length > 240) return { value: null, error: { field: type, code: "invalid_external_id", message: "External ID is too long", raw_value: original } };
  return { value };
}

function parseJsonField(value: string, field: string): unknown {
  const trimmed = clean(value);
  if (!trimmed) return undefined;
  if (field === "pain_points" || field === "objections" || field === "previous_service_experience") {
    try { return JSON.parse(trimmed) as unknown; } catch { return trimmed; }
  }
  return trimmed;
}

export function normalizeImportRow(rowNumber: number, raw: Record<string, string>, sourceName: string): Omit<NormalizedCustomerRow, "classification" | "candidate_customer_id" | "planned_mutation"> {
  const canonical: Record<string, string> = {};
  for (const [header, value] of Object.entries(raw)) {
    const alias = FIELD_ALIASES[keyOf(header)];
    if (alias && clean(value)) canonical[alias] = clean(value);
  }
  const errors: ValidationError[] = [];
  const identities: NormalizedIdentity[] = [];
  for (const type of IDENTITY_TYPES) {
    const input = canonical[type];
    if (!input) continue;
    const result = normalizeIdentity(type, input);
    if (result.error) errors.push(result.error);
    if (result.value) identities.push({ identity_type: type, identity_value: input, normalized_value: result.value, identity_scope: type === "external_id" ? keyOf(sourceName) : "global", is_primary: identities.length === 0 });
  }
  if (identities.length === 0 && !canonical.display_name) {
    errors.push({ field: "row", code: "missing_identity", message: "At least one supported identity or display name is required" });
  }
  const profile: CustomerProfileInput = {};
  for (const key of ["experience_level", "primary_instrument", "trading_style", "risk_preference", "preferred_signal_frequency", "communication_style", "preferred_message_length", "price_sensitivity", "trust_level", "churn_reason", "last_conversation_summary", "next_best_action", "retention_risk"] as const) {
    if (canonical[key]) profile[key] = canonical[key];
  }
  for (const key of ["previous_service_experience", "pain_points", "objections"] as const) {
    const parsed = parseJsonField(canonical[key] ?? "", key);
    if (parsed !== undefined) profile[key] = parsed;
  }
  const memory = (Object.entries(profile) as Array<[MemoryKey, unknown]>).map(([key, value]) => ({ key, value, confidence: 0.8 }));
  const identityFingerprint = identities.map((item) => `${item.identity_type}:${item.identity_scope}:${item.normalized_value}`).sort().join("|") || `name:${clean(canonical.display_name).toLocaleLowerCase("en-US")}`;
  const normalizedPayload = { display_name: canonical.display_name ?? null, external_id: canonical.external_id ?? null, identities, profile, memory };
  return {
    row_number: rowNumber,
    source_record_ref: `${keyOf(sourceName)}:${rowNumber}`,
    display_name: canonical.display_name ?? null,
    identities,
    profile,
    memory,
    raw_payload: raw,
    normalized_payload: normalizedPayload,
    errors,
    identity_fingerprint: createHash("sha256").update(identityFingerprint).digest("hex"),
  };
}

export type ExistingCustomer = {
  id: string;
  display_name: string | null;
  identities: Array<{ identity_type: IdentityType; normalized_value: string; identity_scope?: string }>;
};

export function classifyDedup(row: Pick<NormalizedCustomerRow, "display_name" | "identities" | "errors">, existing: readonly ExistingCustomer[]): Pick<NormalizedCustomerRow, "classification" | "candidate_customer_id" | "planned_mutation"> {
  if (row.errors.length > 0) return { classification: "new_customer", candidate_customer_id: null, planned_mutation: { action: "manual_review" } };
  const exactCandidates = new Set<string>();
  for (const identity of row.identities) {
    for (const customer of existing) {
      if (customer.identities.some((candidate) => candidate.identity_type === identity.identity_type && (candidate.identity_scope ?? "global") === identity.identity_scope && candidate.normalized_value === identity.normalized_value)) exactCandidates.add(customer.id);
    }
  }
  if (exactCandidates.size === 1) {
    const customerId = [...exactCandidates][0]!;
    return { classification: "exact_match", candidate_customer_id: customerId, planned_mutation: { action: "link_existing", customer_id: customerId } };
  }
  if (exactCandidates.size > 1) return { classification: "ambiguous", candidate_customer_id: null, planned_mutation: { action: "manual_review" } };
  const name = row.display_name?.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  if (name) {
    const nameCandidates = existing.filter((customer) => customer.display_name?.normalize("NFKC").trim().toLocaleLowerCase("en-US") === name);
    if (nameCandidates.length === 1) {
      return { classification: "probable_match", candidate_customer_id: nameCandidates[0]!.id, planned_mutation: { action: "manual_review", customer_id: nameCandidates[0]!.id } };
    }
    if (nameCandidates.length > 1) return { classification: "ambiguous", candidate_customer_id: null, planned_mutation: { action: "manual_review" } };
  }
  return { classification: "new_customer", candidate_customer_id: null, planned_mutation: { action: "create_customer" } };
}

export function classifyRows(rows: Array<Omit<NormalizedCustomerRow, "classification" | "candidate_customer_id" | "planned_mutation">>, existing: readonly ExistingCustomer[]): NormalizedCustomerRow[] {
  return rows.map((row) => ({ ...row, ...classifyDedup(row, existing) }));
}
