import { describe, it, expect } from "vitest";
import { FakeSignalSource, normalizeSignal, parseSignalJson } from "./signals";
import type { SignalSourceEvent } from "@gold-revenue-os/contracts";

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> { const values: T[] = []; for await (const item of iterable) values.push(item); return values; }

const event = (patch: Partial<SignalSourceEvent> = {}): SignalSourceEvent => ({
  version: 1, mode: "SYNTHETIC", tenant_id: "51a02000-0000-4000-8000-000000000001", source_id: "51a03000-0000-4000-8000-000000000001",
  message_key: "message:1", revision: 1, kind: "MESSAGE", observed_at: "2026-10-23T18:00:00Z", published_at: null, reply_to: null,
  original_text: "BUY XAUUSD LIMIT 2700.010 SL 2690.000 TP 2720.10", attachments: [],
  interpretation: { action: "OPEN", direction: "BUY", symbol: "XAUUSD", order_type: "LIMIT", entry: ["2700.010"], stop_loss: "2690.000", take_profits: ["2720.10"] }, ...patch,
});
describe("authorized synthetic signal foundation", () => {
  it("preserves every price digit, original text and original/derived separation", () => {
    const r = normalizeSignal(event()); expect(r.event.interpretation?.entry).toEqual(["2700.010"]); expect(r.event.original_text).toBe(event().original_text);
    expect(r.financial_authority).toBe("NONE"); expect(r.distribution_authority).toBe("SYNTHETIC_ONLY"); expect(r.parse_state).toBe("STRUCTURED");
  });
  it.each(["OPEN", "UPDATE", "BREAK_EVEN", "PARTIAL_PROFIT", "CLOSE", "CANCEL", "COMMENTARY"] as const)("represents %s without invented levels", action => {
    const r = normalizeSignal(event({ interpretation: { action, direction: null, symbol: null, order_type: null, entry: [], stop_loss: null, take_profits: [] } }));
    expect(r.event.interpretation?.stop_loss).toBeNull(); expect(r.event.interpretation?.take_profits).toEqual([]); expect(r.parse_state).toBe(action === "OPEN" ? "UNCERTAIN" : "STRUCTURED");
  });
  it.each(["BUY", "SELL"] as const)("preserves %s and multiple exact targets", direction => { const e = event(); e.interpretation!.direction = direction; e.interpretation!.take_profits.push("2730.001"); expect(normalizeSignal(e).event.interpretation).toEqual(e.interpretation); });
  it.each(["MARKET", "LIMIT", "STOP"] as const)("supports %s orders and entry zones", order_type => { const e = event(); e.interpretation!.order_type = order_type; e.interpretation!.entry = ["2700.000", "2701.000"]; expect(normalizeSignal(e).event.interpretation).toEqual(e.interpretation); });
  it("retains unparsed source instead of interpreting unknown instructions", () => { const r = normalizeSignal(event({ interpretation: null, original_text: "maybe move it near the last one" })); expect(r.parse_state).toBe("UNCERTAIN"); expect(r.event.interpretation).toBeNull(); });
  it.each(["DELETE", "RESTRICTED", "UNAVAILABLE"] as const)("%s never extracts inaccessible payload", kind => {
    expect(() => normalizeSignal(event({ kind }))).toThrow(); expect(normalizeSignal(event({ kind, original_text: null, interpretation: null })).parse_state).toBe("UNAVAILABLE");
  });
  it.each([1, 1.5, "1e3", "-1", "NaN", "1,5", "01.1", "0.1234567890123456789", "1234567890123456789"])("rejects invalid/rounded level %s", level => { const e = event(); expect(() => normalizeSignal({ ...e, interpretation: { ...e.interpretation, entry: [level] } })).toThrow(); });
  it("retains opaque message identities and tenant boundaries", () => {
    expect(normalizeSignal(event()).identity).not.toBe(normalizeSignal(event({ message_key: "MESSAGE:1" })).identity);
    expect(normalizeSignal(event()).identity).not.toBe(normalizeSignal(event({ tenant_id: "51a02000-0000-4000-8000-000000000002" })).identity);
    expect(normalizeSignal(event()).identity).not.toBe(normalizeSignal(event({ revision: 2 })).identity);
  });
  it("canonicalizes key order and rejects duplicate JSON keys or injected authority", () => {
    const e = event(); expect(normalizeSignal(e).fact_hash).toBe(normalizeSignal(Object.fromEntries(Object.entries(e).reverse())).fact_hash);
    expect(() => parseSignalJson(JSON.stringify(e).replace('"version":1', '"version":1,"version":1'))).toThrow();
    expect(() => normalizeSignal({ ...e, financial_authority: "LIVE", session_string: "unsafe" })).toThrow();
  });
  it("bounds multibyte payloads and media references", () => {
    expect(() => normalizeSignal(event({ original_text: "€".repeat(12000) }))).toThrow();
    expect(() => normalizeSignal(event({ attachments: [{ reference: "https://private", kind: "IMAGE", sha256: "a".repeat(64) }] }))).toThrow();
  });
  it("replays bounded adapter offsets, not per-message revision watermarks", async () => {
    const fixtures = [event({ revision: 10 }), event({ message_key: "new", revision: 1 }), event({ source_id: "51a03000-0000-4000-8000-000000000002" })];
    const adapter = new FakeSignalSource(fixtures), args = { sourceId: fixtures[0]!.source_id, afterOffset: 0, limit: 1, signal: new AbortController().signal };
    const first = await collect(adapter.events(args)); expect(first).toEqual([{ event: fixtures[0], checkpoint: 1 }]);
    expect(await collect(adapter.events({ ...args, afterOffset: 1 }))).toEqual([{ event: fixtures[1], checkpoint: 2 }]);
    expect(await collect(adapter.events(args))).toEqual(first);
  });
  it("stops when aborted and rejects unbounded reads", async () => {
    const adapter = new FakeSignalSource([event()]); const controller = new AbortController(); controller.abort();
    expect(await collect(adapter.events({ sourceId: event().source_id, afterOffset: 0, limit: 1, signal: controller.signal }))).toEqual([]);
    await expect(collect(adapter.events({ sourceId: event().source_id, afterOffset: 0, limit: 101, signal: controller.signal }))).rejects.toThrow();
  });
});
