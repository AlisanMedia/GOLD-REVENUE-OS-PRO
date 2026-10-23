import { z } from "zod";
export const jobHealthRowSchema=z.strictObject({
 job_id:z.uuid(),mode:z.enum(["test","live"]),financial_authority:z.literal("NONE"),retry_authority:z.literal("NONE"),
 revision_current:z.boolean(),review_required:z.boolean(),obligation:z.enum(["NONE","REVOKE","RECONCILE"]),
 reason:z.enum(["RESTRICTED","UNRECORDED","UNKNOWN_EFFECT","RECLAIM_BUDGET","CLAIM_BUDGET","PROVIDER_FAILURE_BUDGET","PROVIDER_FAILURE","REVISION_STALE"]),
 claims:z.number().int().min(0).max(7).nullable(),reclaims:z.number().int().min(0).max(2).nullable(),provider_failures:z.number().int().min(0).max(5).nullable(),
 effect_state:z.enum(["RESTRICTED","UNRECORDED","UNCERTAIN","UNTRACKED","STARTED","NOT_STARTED"]),
 lease_state:z.enum(["RESTRICTED","NONE","UNKNOWN","EXPIRED","ACTIVE"]),
});
export const jobHealthSchema=z.strictObject({version:z.literal(1),subscription_id:z.uuid(),observed_at:z.iso.datetime({offset:true}),items:z.array(jobHealthRowSchema).max(100)});
export type JobHealth=z.infer<typeof jobHealthRowSchema>;
