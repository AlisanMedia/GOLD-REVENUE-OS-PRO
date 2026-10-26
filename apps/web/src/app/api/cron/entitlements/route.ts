import { createHash,timingSafeEqual } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runTestEntitlementCycle } from "@/lib/entitlements/service";
import { privateBetaIsolationActive } from "../../../../lib/polat/private-beta-isolation";
export const runtime="nodejs";
export const maxDuration=60;
export async function GET(request:Request){
 const secret=process.env.CRON_SECRET;if(!secret)return Response.json({error:"NOT_CONFIGURED"},{status:503});
 const expected=createHash("sha256").update("Bearer "+secret).digest(),received=createHash("sha256").update(request.headers.get("authorization")??"").digest();if(!timingSafeEqual(expected,received))return Response.json({error:"UNAUTHORIZED"},{status:401});
 if(privateBetaIsolationActive())return Response.json({error:"LEGACY_ENTITLEMENT_WORKLOAD_ISOLATED"},{status:423});
 const {data,error}=await createSupabaseAdminClient().rpc("entitlement_ready_test_tenants");if(error)return Response.json({error:"ENTITLEMENT_QUEUE_UNAVAILABLE"},{status:503});
 let processed=0;for(const tenant of (Array.isArray(data)?data:[]).slice(0,10)){if(typeof tenant!=="string")continue;const result=await runTestEntitlementCycle(tenant);if(result.processed)processed++;}return Response.json({mode:"test",processed,live_access:false});
}
