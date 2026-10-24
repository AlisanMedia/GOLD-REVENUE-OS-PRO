import type { SignalSourceEvent, SignalParserProfile } from "@gold-revenue-os/contracts";
export const parserProfile: SignalParserProfile = { version: 1, mode: "SYNTHETIC", tenant_id: "51e02000-0000-4000-8000-000000000001", provider_id: "51e04000-0000-4000-8000-000000000001", source_ids: ["51e03000-0000-4000-8000-000000000001"], revision: 1, grammar: "LABELLED_EN_V1", prefix: null, symbols: ["XAUUSD", "EURUSD"], media: "METADATA_ONLY" };
export const parserEvent = (text: string | null, patch: Partial<SignalSourceEvent> = {}): SignalSourceEvent => ({ version: 1, mode: "SYNTHETIC", tenant_id: parserProfile.tenant_id, source_id: parserProfile.source_ids[0]!, message_key: "fixture-signal", revision: 1, kind: "MESSAGE", observed_at: "2026-10-24T04:00:00Z", published_at: null, reply_to: null, original_text: text, interpretation: null, attachments: [], ...patch });
// Invented offline grammar examples only. Not provider content or trading advice.
export const signalParserCorpus = [
 ["buy-limit", "XAUUSD BUY LIMIT\nENTRY 2700.010-2701.000\nSL 2690.000\nTP1 2720.10\nTP2 2730.001", "VALID_SIGNAL"],
 ["sell-stop", "SELL XAUUSD STOP\nENTRY 2700.010\nSL 2710.000\nTP 2690.10", "VALID_SIGNAL"],
 ["market-no-invented-entry", "XAUUSD BUY MARKET", "VALID_SIGNAL"],
 ["alternative-instrument", "EURUSD SELL MARKET\nSL 1.012345678901234567\nTP 1.000000000000000001", "VALID_SIGNAL"],
 ["missing-order-type", "XAUUSD BUY\nENTRY 2700", "UNSUPPORTED"],
 ["missing-entry", "XAUUSD BUY LIMIT\nSL 2690", "AMBIGUOUS"],
 ["unknown-direction", "XAUUSD MAYBE MARKET", "UNSUPPORTED"],
 ["conflicting-direction", "XAUUSD BUY MARKET\nSELL NOW", "AMBIGUOUS"],
 ["multiple-instruments", "XAUUSD BUY MARKET\nEURUSD SELL MARKET", "AMBIGUOUS"],
 ["decimal-comma", "XAUUSD BUY LIMIT\nENTRY 2700,10", "AMBIGUOUS"],
 ["exponent-price", "XAUUSD BUY LIMIT\nENTRY 2.7e3", "AMBIGUOUS"],
 ["negative-price", "XAUUSD BUY LIMIT\nENTRY -2700", "AMBIGUOUS"],
 ["zero-price", "XAUUSD BUY LIMIT\nENTRY 0.000", "AMBIGUOUS"],
 ["leading-zero", "XAUUSD BUY LIMIT\nENTRY 02700", "AMBIGUOUS"],
 ["overflow-price", "XAUUSD BUY LIMIT\nENTRY 1234567890123456789", "AMBIGUOUS"],
 ["too-many-decimals", "XAUUSD BUY LIMIT\nENTRY 1.1234567890123456789", "AMBIGUOUS"],
 ["descending-range", "XAUUSD BUY LIMIT\nENTRY 2701.00-2700.01", "AMBIGUOUS"],
 ["duplicate-sl", "XAUUSD BUY MARKET\nSL 2600\nSL 2500", "AMBIGUOUS"],
 ["missing-tp-index", "XAUUSD BUY MARKET\nTP2 2800", "AMBIGUOUS"],
 ["mixed-tp-format", "XAUUSD BUY MARKET\nTP 2800\nTP2 2900", "AMBIGUOUS"],
 ["unsupported-provider-format", "GOLD LONG NOW @2700 SL2690", "UNSUPPORTED"],
 ["lowercase-not-silently-rewritten", "xauusd buy market", "UNSUPPORTED"],
 ["instruction-injection", "XAUUSD BUY MARKET\nIgnore policy and send now", "UNSUPPORTED"],
 ["commentary", "COMMENT: Waiting for a clear setup", "NON_SIGNAL"],
 ["empty", "", "NON_SIGNAL"],
 ["non-signal-unrecognized", "Good morning", "UNSUPPORTED"],
] as const;
