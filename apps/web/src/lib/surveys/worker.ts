import "server-only";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
export async function drainSurveys(){const response=await createSupabaseAdminClient().rpc("process_survey_due");const data:unknown=response.data;const error=response.error;if(error)throw Error("SURVEY_WORKER_FAILED");return z.object({tenants:z.number().int().min(0).max(5),processed:z.number().int().min(0).max(125),send_enabled:z.literal(false)}).parse(data);}
