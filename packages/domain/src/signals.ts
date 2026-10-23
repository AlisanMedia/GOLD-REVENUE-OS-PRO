import { createHash } from "node:crypto";
import { signalSourceEventSchema, type SignalSourceEvent, type AuthorizedSignalSourceAdapter } from "@gold-revenue-os/contracts";
import { canonicalFinancialJson, parseFinancialJson } from "./financial-source-canonical";

export function normalizeSignal(input: unknown) {
  const event = signalSourceEventSchema.parse(input);
  const canonical = canonicalFinancialJson(event);
  const hash = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
  const identity = hash(canonicalFinancialJson(["SIGNAL1", event.tenant_id, event.source_id, event.message_key, String(event.revision)]));
  const unavailable = ["DELETE", "RESTRICTED", "UNAVAILABLE"].includes(event.kind);
  const i = event.interpretation;
  const parseState = unavailable ? "UNAVAILABLE" : !i || i.action === "OPEN" && (!i.direction || !i.symbol || !i.order_type || i.order_type !== "MARKET" && !i.entry.length) ? "UNCERTAIN" : "STRUCTURED";
  return { event, identity, fact_hash: hash(canonical), canonical, parse_state: parseState, financial_authority: "NONE" as const, distribution_authority: "SYNTHETIC_ONLY" as const };
}
export function parseSignalJson(raw: string) { return normalizeSignal(parseFinancialJson(raw)); }

// No network, timer, credential, SDK or Telegram dependency. Iteration is bounded;
// repeated and reordered inputs are retained for the durable ledger to reconcile.
export class FakeSignalSource implements AuthorizedSignalSourceAdapter {
  readonly kind = "FAKE" as const;
  readonly mode = "SYNTHETIC" as const;
  constructor(private readonly fixture: readonly SignalSourceEvent[]) { if (fixture.length > 10000) throw Error("SIGNAL_FIXTURE_BOUND"); }
  async *events({ sourceId, afterOffset, limit, signal }: Parameters<AuthorizedSignalSourceAdapter["events"]>[0]) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(afterOffset) || afterOffset < 0) throw Error("SIGNAL_BOUND_REQUIRED");
    let n = 0;
    for (let index = afterOffset; index < this.fixture.length; index++) {
      const input = this.fixture[index]!;
      if (signal.aborted || n >= limit) break;
      const event = normalizeSignal(input).event;
      if (event.source_id !== sourceId) continue;
      n++; yield await Promise.resolve({ event, checkpoint: index + 1 });
    }
  }
}
