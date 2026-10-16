import { z } from "zod";
// Read-only presentation: missing historical/test snapshots never establish terms.
const offerSnapshot = z.object({
 plan: z.object({payload: z.object({title:z.string(),terms:z.string(),duration_unit:z.enum(["fixed_days","calendar_month","calendar_year"]),duration_count:z.number().int().min(1).max(366)})}),
 follow_up:z.object({action:z.enum(["WAIT","REVIEW_ONE_FOLLOW_UP"]),delivery:z.literal("none")}),
});
export function offerSnapshotPresentation(value:unknown) {const parsed=offerSnapshot.safeParse(value);return parsed.success?parsed.data:null;}
