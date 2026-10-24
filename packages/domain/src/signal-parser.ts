import { createHash } from "node:crypto";
import { signalParserProfileSchema, signalParseContextSchema, deterministicSignalResultSchema, signalPriceSchema, type DeterministicSignalResult, type SignalInterpretation } from "@gold-revenue-os/contracts";
import { normalizeSignal } from "./signals";
import { canonicalFinancialJson } from "./financial-source-canonical";

type Classification = DeterministicSignalResult["classification"];
type Reason = DeterministicSignalResult["reasons"][number];
const hash = (v: unknown) => createHash("sha256").update(canonicalFinancialJson(v), "utf8").digest("hex");
const pricePattern = "(?:0|[1-9]\\d{0,17})(?:\\.\\d{1,18})?";
const positivePrice = (v: string) => signalPriceSchema.safeParse(v).success && /[1-9]/u.test(v);
// Lexical comparison of equal-scale integer strings; prices are never Numbers.
function comparePrices(a: string, b: string) {
  const [ai = "", af = ""] = a.split("."), [bi = "", bf = ""] = b.split(".");
  const width = Math.max(af.length, bf.length);
  const x = BigInt(ai + af.padEnd(width, "0")), y = BigInt(bi + bf.padEnd(width, "0"));
  return x < y ? -1 : x > y ? 1 : 0;
}
/** Bounded, exact allowlisted grammar. No LLM, price inference, session or sender.
 * Original source and source hash are unchanged; derived interpretation is separate.
 * The caller must still apply the durable source/revision/delivery gates.
 */
export function parseProviderSignal(rawEvent: unknown, rawProfile: unknown, rawContext: unknown = { latest_revision: null, parent: null }): DeterministicSignalResult {
  const source = normalizeSignal(rawEvent), event = source.event;
  const profile = signalParserProfileSchema.parse(rawProfile), context = signalParseContextSchema.parse(rawContext);
  const parserHash = hash(["SIGNAL_PARSER1", profile]);
  const finish = (classification: Classification, reason: Reason, interpretation: SignalInterpretation | null = null, partial: string | null = null) => {
    if (interpretation && event.interpretation && canonicalFinancialJson(interpretation) !== canonicalFinancialJson(event.interpretation)) {
      classification = "AMBIGUOUS"; reason = "EXISTING_INTERPRETATION_CONFLICT"; interpretation = null; partial = null;
    }
    return deterministicSignalResultSchema.parse({ version: 1, mode: "SYNTHETIC", classification, reasons: [reason], source_event: event,
      source_identity: source.identity, source_fact_hash: source.fact_hash, parser_hash: parserHash,
      interpretation_hash: hash(["SIGNAL_INTERPRETATION1", source.identity, source.fact_hash, parserHash, classification, interpretation, partial]),
      interpretation, partial_percent: partial, financial_authority: "NONE", live_operations_authorized: false });
  };
  if (event.tenant_id !== profile.tenant_id || !profile.source_ids.includes(event.source_id)) return finish("UNSUPPORTED", "SOURCE_SCOPE");
  if (event.kind === "RESTRICTED") return finish("SOURCE_RESTRICTED", "SOURCE_RESTRICTED");
  if (event.kind === "UNAVAILABLE") return finish("UNSUPPORTED", "SOURCE_UNAVAILABLE");
  // Source deletion is not an instruction to cancel a trade.
  if (event.kind === "DELETE") return finish("NON_SIGNAL", "SOURCE_DELETED");
  if (context.latest_revision !== null && event.revision < context.latest_revision) return finish("AMBIGUOUS", "STALE_REVISION");
  if (event.attachments.length && profile.media !== "METADATA_ONLY") return finish("UNSUPPORTED", "UNSUPPORTED_MEDIA");
  let lines = (event.original_text ?? "").split(/\r?\n/u).map(v => v.trim()).filter(Boolean);
  if (lines.length > 32) return finish("UNSUPPORTED", "CONTENT_BOUND");
  if (profile.prefix) { if (lines[0] !== profile.prefix) return finish("UNSUPPORTED", "UNSUPPORTED_FORMAT"); lines = lines.slice(1); }
  if (!lines.length) return event.attachments.length ? finish("UNSUPPORTED", "UNSUPPORTED_MEDIA") : finish("NON_SIGNAL", "COMMENTARY");
  const text = lines.join("\n"), header = lines[0]!;
  if (/\bBUY\b/u.test(text) && /\bSELL\b/u.test(text)) return finish("AMBIGUOUS", "CONFLICTING_DIRECTION");
  const instruments = new Set(text.match(/\b[A-Z]{3,5}(?:USD|EUR|JPY|USDT)\b/gu) ?? []);
  if (instruments.size > 1) return finish("AMBIGUOUS", "MULTIPLE_INSTRUMENTS");
  if (event.reply_to) {
    if (!context.parent) return finish("AMBIGUOUS", "MISSING_PARENT");
    if (context.parent.tenant_id !== event.tenant_id || context.parent.source_id !== event.source_id || context.parent.message_key !== event.reply_to || ["DELETE", "RESTRICTED", "UNAVAILABLE"].includes(context.parent.kind)) return finish("AMBIGUOUS", "PARENT_SCOPE");
  }
  const blank = (): SignalInterpretation => ({ action: "OPEN", direction: null, symbol: null, order_type: null, entry: [], stop_loss: null, take_profits: [] });
  const parsed = blank(); let partial: string | null = null; let update = false;
  const open = header.match(/^([A-Z0-9._/-]{1,24}) (BUY|SELL) (MARKET|LIMIT|STOP)$/u) ?? header.match(/^(BUY|SELL) ([A-Z0-9._/-]{1,24}) (MARKET|LIMIT|STOP)$/u)?.map((v, i, a) => i === 1 ? a[2]! : i === 2 ? a[1]! : v);
  if (open) {
    if (!profile.symbols.includes(open[1]!)) return finish("UNSUPPORTED", "UNSUPPORTED_FORMAT");
    parsed.symbol = open[1]!; parsed.direction = open[2] as "BUY" | "SELL"; parsed.order_type = open[3] as "MARKET" | "LIMIT" | "STOP";
  } else {
    update = true;
    if (header === "BREAK EVEN") parsed.action = "BREAK_EVEN";
    else if (header === "CLOSE") parsed.action = "CLOSE";
    else if (header === "CANCEL") parsed.action = "CANCEL";
    else if (header === "UPDATE") parsed.action = "UPDATE";
    else if (/^PARTIAL CLOSE(?: (?:[1-9]\d?|100)(?:\.\d{1,4})?%)?$/u.test(header)) {
      parsed.action = "PARTIAL_PROFIT"; partial = header.match(/ ([0-9.]+)%$/u)?.[1] ?? null;
      if (partial && comparePrices(partial, "100") > 0) return finish("AMBIGUOUS", "INVALID_RANGE");
    } else if (header.startsWith("COMMENT: ") && lines.length === 1) {
      if (!event.reply_to) return finish("NON_SIGNAL", "COMMENTARY");
      parsed.action = "COMMENTARY";
    } else return finish("UNSUPPORTED", "UNSUPPORTED_FORMAT");
    if (!event.reply_to || !context.parent) return finish("AMBIGUOUS", "MISSING_PARENT");
    if (context.parent.tenant_id !== event.tenant_id || context.parent.source_id !== event.source_id || context.parent.message_key !== event.reply_to || ["DELETE", "RESTRICTED", "UNAVAILABLE"].includes(context.parent.kind)) return finish("AMBIGUOUS", "PARENT_SCOPE");
    // Never inherit direction, symbol or levels from a parent or account preference.
  }
  const seen = new Set<string>(); let tpIndex = 0;
  for (const line of lines.slice(1)) {
    const m = line.match(/^(ENTRY|SL|TP(?:[1-9]|1[0-2])?) (.+)$/u);
    if (!m) return finish("UNSUPPORTED", "UNSUPPORTED_FORMAT");
    const label = m[1]!, value = m[2]!;
    if (seen.has(label)) return finish("AMBIGUOUS", "DUPLICATE_FIELD"); seen.add(label);
    if (label === "ENTRY") {
      if (update) return finish("AMBIGUOUS", "UNSUPPORTED_FORMAT");
      const range = value.match(new RegExp(`^(${pricePattern})(?:-(${pricePattern}))?$`, "u"));
      if (!range || !positivePrice(range[1]!) || range[2] && !positivePrice(range[2])) return finish("AMBIGUOUS", "INVALID_PRICE");
      parsed.entry = range[2] ? [range[1]!, range[2]] : [range[1]!];
      if (range[2] && comparePrices(range[1]!, range[2]) > 0) return finish("AMBIGUOUS", "INVALID_RANGE");
    } else {
      if (!positivePrice(value)) return finish("AMBIGUOUS", "INVALID_PRICE");
      if (label === "SL") parsed.stop_loss = value;
      else {
        // Either one unnumbered TP or a complete ordered TP1..TP12 sequence.
        if (label === "TP" ? tpIndex !== 0 : label !== `TP${tpIndex + 1}` || seen.has("TP")) return finish("AMBIGUOUS", "DUPLICATE_FIELD");
        tpIndex++; parsed.take_profits.push(value);
      }
    }
  }
  if (!update && parsed.order_type !== "MARKET" && !parsed.entry.length || parsed.action === "UPDATE" && !parsed.stop_loss && !parsed.take_profits.length) return finish("AMBIGUOUS", "MISSING_REQUIRED");
  if (update && ["CLOSE", "CANCEL", "COMMENTARY", "PARTIAL_PROFIT"].includes(parsed.action) && lines.length > 1) return finish("AMBIGUOUS", "UNSUPPORTED_FORMAT");
  return finish(update || event.kind === "EDIT" ? "SIGNAL_UPDATE" : "VALID_SIGNAL", "EXACT_GRAMMAR", parsed, partial);
}

/** Explicit normalization bridge for a future fixture adapter. It does not
 * replace stored evidence or enqueue anything. Original and derived hashes are
 * separate, and every durable gate must still accept the resulting candidate. */
export function prepareParsedSignalFixture(rawEvent: unknown, rawProfile: unknown, rawContext?: unknown) {
 const assessment = parseProviderSignal(rawEvent, rawProfile, rawContext);
 const candidate = assessment.interpretation && ["VALID_SIGNAL", "SIGNAL_UPDATE"].includes(assessment.classification)
  ? normalizeSignal({ ...assessment.source_event, interpretation: assessment.interpretation }) : null;
 return { assessment, candidate, financial_authority: "NONE" as const, live_operations_authorized: false as const };
}
