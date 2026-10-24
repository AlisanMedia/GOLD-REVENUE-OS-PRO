import { signalWaveSchema, signalFinishSchema, signalTransportResultSchema, type SignalTransportResult } from "@gold-revenue-os/contracts";
import { FakeSignalTransport, type SignalFixtureStore } from "./signal-distribution";
export type SignalWaveStore = {
 readonly mode: "SYNTHETIC";
 finish: (...args: Parameters<SignalFixtureStore["finish"]>) => ReturnType<SignalFixtureStore["finish"]>;
 prepareWave: (tenantId: string, destinationId: string) => Promise<unknown>;
};
/** One opt-in wave, <=2 independently validated fresh OPEN messages. Does not
 * run a polling loop, relax ordered updates or retry a lost prepare/finish. */
export async function dispatchSyntheticSignalWave(input: { tenantId: string; destinationId: string; store: SignalWaveStore; transport: FakeSignalTransport }) {
 if (input.store.mode !== "SYNTHETIC" || !(input.transport instanceof FakeSignalTransport)) throw Error("SIGNAL_SYNTHETIC_REQUIRED");
 const started = performance.now(); let raw: unknown;
 try { raw = await input.store.prepareWave(input.tenantId, input.destinationId); } catch { throw Error("SIGNAL_STORE_UNAVAILABLE"); }
 const wave = signalWaveSchema.safeParse(raw); if (!wave.success) throw Error("SIGNAL_STORE_INVALID");
 if (wave.data.tenant_id !== input.tenantId || wave.data.destination_id !== input.destinationId) throw Error("SIGNAL_SCOPE_INVALID");
 if (wave.data.items.some(i => i.payload.tenant_id !== input.tenantId)) throw Error("SIGNAL_SCOPE_INVALID");
 const outcomes = await Promise.all(wave.data.items.map(async item => {
  let outcome: SignalTransportResult;
  try { outcome = signalTransportResultSchema.parse(await input.transport.dispatch(item.payload));
   if (outcome.outcome === "ACK" && (outcome.tenant_id !== input.tenantId || outcome.operation_key !== item.payload.operation_key || outcome.destination_ref !== item.payload.destination_ref || outcome.fact_hash !== item.payload.fact_hash)) throw Error("SIGNAL_ACK_INVALID");
  } catch { outcome = { outcome: "UNKNOWN", retry_after_ms: null }; }
  try { const r = signalFinishSchema.parse(await input.store.finish(input.tenantId, item.delivery_id, item.lease_token, outcome));
   return r.state === "FAKE_CONFIRMED" && outcome.outcome === "ACK" && !r.replay ? "CONFIRMED" : outcome.outcome === "UNKNOWN" ? "UNKNOWN" : "HELD";
  } catch { return "UNKNOWN"; }
 }));
 return { classification: "SYNTHETIC" as const, financial_authority: "NONE" as const, live_operations_authorized: false as const,
  state: wave.data.state, attempted: outcomes.length, confirmed: outcomes.filter(s => s === "CONFIRMED").length, unknown: outcomes.filter(s => s === "UNKNOWN").length, held: outcomes.filter(s => s === "HELD").length,
  elapsed_ms: performance.now() - started };
}
