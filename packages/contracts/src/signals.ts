import { z } from "zod";

export const signalAdapterKinds = ["FAKE", "TELEGRAM_CLIENT", "SUPPLIER_BOT", "SUPPLIER_WEBHOOK", "DEDICATED_CHANNEL", "STRUCTURED_FEED"] as const;
export const signalPriceSchema = z.string().regex(/^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/u);
const opaque = z.string().min(1).max(128).regex(/^[^\p{C}]+$/u);
export const signalInterpretationSchema = z.object({
  action: z.enum(["OPEN", "UPDATE", "BREAK_EVEN", "PARTIAL_PROFIT", "CLOSE", "CANCEL", "COMMENTARY"]),
  direction: z.enum(["BUY", "SELL"]).nullable(), symbol: z.string().regex(/^[A-Z0-9._/-]{1,24}$/u).nullable(),
  order_type: z.enum(["MARKET", "LIMIT", "STOP"]).nullable(),
  entry: z.array(signalPriceSchema).max(2), stop_loss: signalPriceSchema.nullable(),
  take_profits: z.array(signalPriceSchema).max(12),
}).strict();
export const signalSourceEventSchema = z.object({
  version: z.literal(1), mode: z.literal("SYNTHETIC"), tenant_id: z.uuid(), source_id: z.uuid(),
  message_key: opaque, revision: z.number().int().min(1).max(2147483647),
  kind: z.enum(["MESSAGE", "EDIT", "DELETE", "RESTRICTED", "UNAVAILABLE"]),
  observed_at: z.iso.datetime({ offset: true }), published_at: z.iso.datetime({ offset: true }).nullable(),
  reply_to: opaque.nullable(), original_text: z.string().max(12000).nullable(),
  attachments: z.array(z.object({ reference: z.string().regex(/^fixture:[A-Za-z0-9:._-]{1,120}$/u), kind: z.enum(["IMAGE", "VIDEO", "DOCUMENT"]), sha256: z.string().regex(/^[a-f0-9]{64}$/u) }).strict()).max(8),
  interpretation: signalInterpretationSchema.nullable(),
}).strict().superRefine((v, ctx) => {
  if (["DELETE", "RESTRICTED", "UNAVAILABLE"].includes(v.kind) && (v.original_text !== null || v.interpretation !== null || v.attachments.length)) ctx.addIssue({ code: "custom", message: "Unavailable content must not be extracted" });
  if (v.published_at && Date.parse(v.published_at) > Date.parse(v.observed_at) + 300000) ctx.addIssue({ code: "custom", message: "Source time is uncertain" });
});
export type SignalSourceEvent = z.infer<typeof signalSourceEventSchema>;
export type SignalInterpretation = z.infer<typeof signalInterpretationSchema>;

// Session material is deliberately absent. A future adapter obtains a separately
// approved server-owned capability; normal membership never establishes rights.
export interface AuthorizedSignalSourceAdapter {
  readonly kind: typeof signalAdapterKinds[number];
  readonly mode: "SYNTHETIC" | "CONFIGURED_DISABLED";
  events(input: { sourceId: string; afterOffset: number; limit: number; signal: AbortSignal }): AsyncIterable<unknown>;
}
