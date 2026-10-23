import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const fixture = z.string().regex(/^fixture:[A-Za-z0-9:._-]{1,120}$/u);
const message = z.string().regex(/^fake-message:[A-Za-z0-9:_-]{1,120}$/u);
export const signalLeaseSchema = z.object({ state: z.literal("LEASED"), mode: z.literal("SYNTHETIC"), tenant_id: z.uuid(), delivery_id: z.uuid(), lease_token: z.uuid(), claim: z.number().int().min(1).max(7), drained: z.number().int().min(0).max(32), has_more: z.literal(true) }).strict();
export type SignalLease = z.infer<typeof signalLeaseSchema>;
export const signalClaimSchema = z.union([signalLeaseSchema,
 z.object({state:z.literal("NO_LEASE"),drained:z.number().int().min(0).max(32),visited:z.number().int().min(0).max(16),has_more:z.boolean()}).strict(),
 z.object({state:z.enum(["BUSY","PAUSED"]),drained:z.literal(0),has_more:z.literal(true)}).strict(),
]);
export const signalDispatchPayloadSchema = z.object({
 version: z.literal(1), mode: z.literal("SYNTHETIC"), tenant_id: z.uuid(), operation_key: hash, operation: z.enum(["SEND","EDIT","DELETE"]), destination_ref: fixture,
 message_ref: message.nullable(), reply_ref: message.nullable(), text: z.string().max(8192).nullable(),
 attachments: z.array(z.object({ reference: fixture, kind: z.enum(["IMAGE","VIDEO","DOCUMENT"]), sha256: hash }).strict()).max(8),
 fact_hash: hash, observed_at: z.iso.datetime({ offset: true }),
}).strict().superRefine((v,ctx)=>{
 if (v.text !== null && Array.from(v.text).length > 4096 || v.operation !== "SEND" && v.message_ref === null || v.operation === "SEND" && v.message_ref !== null) ctx.addIssue({code:"custom",message:"Unsupported dispatch shape"});
 if (v.operation === "DELETE" ? v.text !== null || v.attachments.length > 0 || v.reply_ref !== null : v.text === null && !v.attachments.length) ctx.addIssue({code:"custom",message:"Missing or unexpected content"});
});
export type SignalDispatchPayload = z.infer<typeof signalDispatchPayloadSchema>;
export const signalFakeAckSchema = z.object({ outcome: z.literal("ACK"), mode: z.literal("SYNTHETIC"), tenant_id: z.uuid(), operation_key: hash, destination_ref: fixture, message_ref: message, fact_hash: hash, acknowledged_at: z.iso.datetime({offset:true}) }).strict();
export const signalTransportResultSchema = z.union([signalFakeAckSchema,z.object({ outcome: z.enum(["KNOWN_FAILURE","RATE_LIMITED","UNKNOWN"]), retry_after_ms: z.number().int().min(1).max(300000).nullable() }).strict()]);
export type SignalTransportResult = z.infer<typeof signalTransportResultSchema>;
export const signalPreparedSchema = z.union([z.object({state:z.literal("PREPARED"),payload:signalDispatchPayloadSchema}).strict(),z.object({state:z.enum(["FENCED","HELD","NO_EFFECT"])}).strict()]);
export const signalFinishSchema = z.union([z.object({state:z.literal("FENCED")}).strict(),z.object({state:z.enum(["FAKE_CONFIRMED","UNKNOWN","REVIEW","RETRY","STALE_ACK"]),replay:z.boolean(),financial_authority:z.literal("NONE").optional()}).strict().refine(v=>v.replay||v.financial_authority==="NONE")]);
export const signalFakeScenariosSchema = z.array(z.object({outcome:z.enum(["ACK","KNOWN_FAILURE","RATE_LIMITED","UNKNOWN_AFTER_EFFECT","UNKNOWN_BEFORE_EFFECT"]),delay_ms:z.number().int().min(0).max(1000).optional(),retry_after_ms:z.number().int().min(1).max(300000).optional()}).strict()).max(10000);
