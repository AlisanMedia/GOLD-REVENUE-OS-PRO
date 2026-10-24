import { z } from "zod";
import { signalInterpretationSchema, signalSourceEventSchema } from "./signals";

export const signalParserProfileSchema = z.object({
  version: z.literal(1), mode: z.literal("SYNTHETIC"), tenant_id: z.uuid(), provider_id: z.uuid(),
  source_ids: z.array(z.uuid()).min(1).max(32), revision: z.number().int().min(1).max(2147483647),
  grammar: z.literal("LABELLED_EN_V1"), prefix: z.string().regex(/^[A-Z0-9 _-]{1,64}$/u).nullable(),
  symbols: z.array(z.string().regex(/^[A-Z0-9._/-]{1,24}$/u)).min(1).max(32),
  media: z.enum(["NONE", "METADATA_ONLY"]),
}).strict().superRefine((v, ctx) => {
  if (new Set(v.source_ids).size !== v.source_ids.length || new Set(v.symbols).size !== v.symbols.length)
    ctx.addIssue({ code: "custom", message: "Duplicate parser scope" });
});
export const signalParseClassifications = ["VALID_SIGNAL", "SIGNAL_UPDATE", "NON_SIGNAL", "AMBIGUOUS", "UNSUPPORTED", "SOURCE_RESTRICTED"] as const;
export const signalParseReasons = ["EXACT_GRAMMAR", "SOURCE_RESTRICTED", "SOURCE_UNAVAILABLE", "SOURCE_DELETED", "SOURCE_SCOPE", "STALE_REVISION", "MISSING_PARENT", "PARENT_SCOPE", "UNSUPPORTED_MEDIA", "UNSUPPORTED_FORMAT", "MULTIPLE_INSTRUMENTS", "CONFLICTING_DIRECTION", "DUPLICATE_FIELD", "INVALID_PRICE", "MISSING_REQUIRED", "INVALID_RANGE", "COMMENTARY", "CONTENT_BOUND", "EXISTING_INTERPRETATION_CONFLICT"] as const;
export const signalParseContextSchema = z.object({
  latest_revision: z.number().int().min(1).max(2147483647).nullable(),
  parent: signalSourceEventSchema.nullable(),
}).strict();
export const deterministicSignalResultSchema = z.object({
  version: z.literal(1), mode: z.literal("SYNTHETIC"), classification: z.enum(signalParseClassifications),
  reasons: z.array(z.enum(signalParseReasons)).min(1).max(8), source_event: signalSourceEventSchema,
  source_identity: z.string().regex(/^[a-f0-9]{64}$/u), source_fact_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  parser_hash: z.string().regex(/^[a-f0-9]{64}$/u), interpretation_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  interpretation: signalInterpretationSchema.nullable(), partial_percent: z.string().regex(/^(?:[1-9]\d?|100)(?:\.\d{1,4})?$/u).nullable(),
  financial_authority: z.literal("NONE"), live_operations_authorized: z.literal(false),
}).strict();
export type SignalParserProfile = z.infer<typeof signalParserProfileSchema>;
export type DeterministicSignalResult = z.infer<typeof deterministicSignalResultSchema>;
