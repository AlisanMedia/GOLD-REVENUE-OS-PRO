import { normalizeImportRow } from "./customer-os";

/** International import boundary: no inferred +90 country or invented Telegram destination. */
export function normalizeCampaignImportRow(rowNumber: number, raw: Record<string, string>, source: string) {
  const row = normalizeImportRow(rowNumber, raw, source);
  const fields = new Map(Object.entries(raw).map(([k, v]) => [k.trim().toLowerCase().replaceAll(" ", "_"), v.trim()]));
  const marketText = fields.get("market") ?? fields.get("country_code") ?? "";
  const market = marketText ? marketText.toUpperCase() : null;
  const language = (fields.get("preferred_language") ?? fields.get("language") ?? "en").toLowerCase();
  if (market !== null && !/^[A-Z]{2}$/u.test(market)) row.errors.push({ field: "market", code: "invalid_market", message: "Use an explicit two-letter country code" });
  if (!["en", "tr", "ar", "ru"].includes(language)) row.errors.push({ field: "preferred_language", code: "unsupported_language", message: "Language preference requires reconciliation" });
  for (const identity of row.identities) {
    if (identity.identity_type === "phone" && !/^\+[1-9][0-9]{7,14}$/u.test(identity.identity_value.replace(/[()\s.-]/gu, "")))
      row.errors.push({ field: "phone", code: "explicit_international_phone_required", message: "Include the explicit international country code; none is inferred" });
  }
  row.normalized_payload.contact = { market, language, relationship: (fields.get("historical_relationship") ?? "").slice(0, 500) || null, provenance: "SOURCE_IMPORT_DECLARED" };
  return row;
}
