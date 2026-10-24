import { describe, it, expect } from "vitest";
import { parseProviderSignal, prepareParsedSignalFixture } from "./signal-parser";
import { normalizeSignal } from "./signals";
import { parserProfile as profile, parserEvent as event, signalParserCorpus } from "./signal-parser.fixtures";

describe("deterministic provider parsing without trading authority", () => {
 it.each(signalParserCorpus)("corpus %s", (_label, text, classification) => {
  const input = event(text), before = structuredClone(input), result = parseProviderSignal(input, profile);
  expect(result.classification).toBe(classification); expect(result.source_event).toEqual(before); expect(input).toEqual(before);
  expect(result.source_fact_hash).toBe(normalizeSignal(before).fact_hash); expect(result.financial_authority).toBe("NONE"); expect(result.live_operations_authorized).toBe(false);
  if (["AMBIGUOUS", "UNSUPPORTED"].includes(classification)) expect(result.interpretation).toBeNull();
 });
 it("retains original whitespace, exact range/TP digits and provider metadata", () => {
  const text = "  XAUUSD BUY LIMIT\r\nENTRY 2700.010-2701.000\r\nSL 2690.000\r\nTP1 2720.10\r\nTP2 2730.001  ";
  const result = parseProviderSignal(event(text), profile);
  expect(result.source_event.original_text).toBe(text); expect(result.interpretation?.entry).toEqual(["2700.010", "2701.000"]); expect(result.interpretation?.take_profits).toEqual(["2720.10", "2730.001"]);
 });
 it("does not infer absent SL, TP, entry or source publication time", () => {
  const r = parseProviderSignal(event("XAUUSD BUY MARKET"), profile);
  expect(r.interpretation).toMatchObject({ entry: [], stop_loss: null, take_profits: [] }); expect(r.source_event.published_at).toBeNull();
 });
 it.each(["BREAK EVEN", "PARTIAL CLOSE 50.00%", "CLOSE", "CANCEL", "UPDATE\nSL 2700.000\nTP 2720.00", "COMMENT: Reduce exposure"])("reply-linked update %s", text => {
  const r = parseProviderSignal(event(text, { reply_to: "parent" }), profile, { latest_revision: null, parent: event("XAUUSD BUY MARKET", { message_key: "parent" }) });
  expect(r.classification).toBe("SIGNAL_UPDATE"); expect(r.interpretation?.direction).toBeNull(); expect(r.interpretation?.symbol).toBeNull(); expect(r.interpretation?.entry).toEqual([]);
  if (text.includes("50.00")) expect(r.partial_percent).toBe("50.00");
 });
 it("missing parent, foreign parent and price-less update stay reviewable", () => {
  const e = event("UPDATE\nSL 2700", { reply_to: "parent" });
  expect(parseProviderSignal(e, profile).reasons).toEqual(["MISSING_PARENT"]);
  expect(parseProviderSignal(e, profile, { latest_revision: null, parent: event(null, { message_key: "parent", tenant_id: "51e02000-0000-4000-8000-000000000002" }) }).reasons).toEqual(["PARENT_SCOPE"]);
  expect(parseProviderSignal(event("UPDATE", { reply_to: "parent" }), profile, { latest_revision: null, parent: event(null, { message_key: "parent" }) }).reasons).toEqual(["MISSING_REQUIRED"]);
 });
 it("never interprets source deletion as trade cancellation", () => { const r = parseProviderSignal(event(null, { kind: "DELETE" }), profile); expect(r.classification).toBe("NON_SIGNAL"); expect(r.interpretation).toBeNull(); expect(r.reasons).toEqual(["SOURCE_DELETED"]); });
 it.each(["RESTRICTED", "UNAVAILABLE"] as const)("%s has no extracted content", kind => {
  const r = parseProviderSignal(event(null, { kind }), profile); expect(r.interpretation).toBeNull(); expect(r.classification).toBe(kind === "RESTRICTED" ? "SOURCE_RESTRICTED" : "UNSUPPORTED");
 });
 it("isolates source scope and cannot infer membership permission", () => {
  expect(parseProviderSignal(event("XAUUSD BUY MARKET", { source_id: "51e03000-0000-4000-8000-000000000002" }), profile).reasons).toEqual(["SOURCE_SCOPE"]);
  expect(() => parseProviderSignal(event(""), { ...profile, authorization: "LIVE" })).toThrow();
 });
 it("configures per-provider prefix, symbols and supported attachment metadata", () => {
  const p = { ...profile, prefix: "FIXTURE FEED", symbols: ["XAUUSD"] };
  expect(parseProviderSignal(event("XAUUSD BUY MARKET"), p).classification).toBe("UNSUPPORTED");
  const e = event("FIXTURE FEED\nXAUUSD BUY MARKET", { attachments: [{ reference: "fixture:image", kind: "IMAGE", sha256: "a".repeat(64) }] });
  expect(parseProviderSignal(e, p).classification).toBe("VALID_SIGNAL"); expect(parseProviderSignal(e, { ...p, media: "NONE" }).reasons).toEqual(["UNSUPPORTED_MEDIA"]);
  expect(parseProviderSignal(event("FIXTURE FEED\nEURUSD BUY MARKET"), p).classification).toBe("UNSUPPORTED");
 });
 it("out-of-order edits remain uncertain, current edit preserves its exact source revision", () => {
  const e = event("XAUUSD SELL LIMIT\nENTRY 2700.010", { kind: "EDIT", revision: 2 });
  expect(parseProviderSignal(e, profile, { latest_revision: 3, parent: null }).reasons).toEqual(["STALE_REVISION"]);
  const r = parseProviderSignal(e, profile, { latest_revision: 2, parent: null }); expect(r.classification).toBe("SIGNAL_UPDATE"); expect(r.interpretation?.direction).toBe("SELL"); expect(r.source_event.revision).toBe(2);
 });
 it("does not overwrite preexisting conflicting structured values", () => {
  const e = event("XAUUSD BUY MARKET", { interpretation: { action: "OPEN", direction: "SELL", symbol: "XAUUSD", order_type: "MARKET", entry: [], stop_loss: null, take_profits: [] } });
  const r = parseProviderSignal(e, profile); expect(r.classification).toBe("AMBIGUOUS"); expect(r.source_event.interpretation?.direction).toBe("SELL"); expect(r.interpretation).toBeNull();
 });
 it("repeated receipt keeps canonical facts and parser output identity", () => {
  const e = event("XAUUSD BUY MARKET"), r = parseProviderSignal(e, profile), repeat = parseProviderSignal({ ...e, observed_at: "2026-10-24T04:00:01Z" }, profile);
  expect(repeat.source_identity).toBe(r.source_identity); expect(repeat.source_fact_hash).toBe(r.source_fact_hash); expect(repeat.interpretation_hash).toBe(r.interpretation_hash);
  expect(parseProviderSignal(e, { ...profile, revision: 2 }).parser_hash).not.toBe(r.parser_hash);
 });
 it("rejects authority/session fields, excessive lines and malformed attachment refs", () => {
  expect(() => parseProviderSignal({ ...event(""), financial_authority: "LIVE" }, profile)).toThrow();
  expect(() => parseProviderSignal(event(""), profile, { latest_revision: null, parent: null, approved: true })).toThrow();
  expect(parseProviderSignal(event(Array(34).fill("XAUUSD BUY MARKET").join("\n")), profile).reasons).toEqual(["CONTENT_BOUND"]);
  expect(() => parseProviderSignal(event("", { attachments: [{ reference: "https://private", kind: "DOCUMENT", sha256: "a".repeat(64) }] }), profile)).toThrow();
 });
 it("supports all twelve targets without sorting or converting their prices", () => {
  const targets = Array.from({ length: 12 }, (_, i) => `TP${i + 1} ${2800 + i}.010`);
  expect(parseProviderSignal(event(`XAUUSD BUY MARKET\n${targets.join("\n")}`), profile).interpretation?.take_profits).toEqual(targets.map(t => t.split(" ")[1]));
 });
 it("does not infer instructions from an image without source text", () => {
  expect(parseProviderSignal(event(null, { attachments: [{reference:"fixture:image",kind:"IMAGE",sha256:"a".repeat(64)}] }), profile).reasons).toEqual(["UNSUPPORTED_MEDIA"]);
 });
 it("rejects a partial percentage beyond100 and levels attached to cancel/close", () => {
  const c = { latest_revision: null, parent: event(null, { message_key: "parent" }) };
  expect(parseProviderSignal(event("PARTIAL CLOSE 100.01%", { reply_to: "parent" }), profile, c).classification).toBe("AMBIGUOUS");
  expect(parseProviderSignal(event("CANCEL\nSL 2700", { reply_to: "parent" }), profile, c).classification).toBe("AMBIGUOUS");
 });
});

describe("existing normalization bridge", () => {
 it("produces a separate validated fixture candidate without rewriting original source", () => {
  const e = event("XAUUSD BUY LIMIT\nENTRY 2700.010\nSL 2690.000");
  const r = prepareParsedSignalFixture(e, profile);
  expect(r.assessment.source_event.interpretation).toBeNull(); expect(e.interpretation).toBeNull();
  expect(r.candidate?.parse_state).toBe("STRUCTURED"); expect(r.candidate?.event.original_text).toBe(e.original_text);
  expect(r.candidate?.fact_hash).not.toBe(r.assessment.source_fact_hash); expect(r.candidate?.financial_authority).toBe("NONE");
 });
 it("cannot produce a candidate for uncertain, restricted or non-signal content", () => {
  for (const e of [event("maybe BUY"), event("COMMENT: Wait"), event(null, {kind:"RESTRICTED"})]) expect(prepareParsedSignalFixture(e, profile).candidate).toBeNull();
 });
 it("keeps repeated derived facts stable while a provider grammar revision changes annotation identity", () => {
  const e = event("XAUUSD SELL MARKET");
  expect(prepareParsedSignalFixture(e, profile).candidate?.fact_hash).toBe(prepareParsedSignalFixture({...e,observed_at:"2026-10-24T04:00:01Z"}, profile).candidate?.fact_hash);
  expect(prepareParsedSignalFixture(e, {...profile,revision:2}).assessment.interpretation_hash).not.toBe(prepareParsedSignalFixture(e, profile).assessment.interpretation_hash);
 });
});
