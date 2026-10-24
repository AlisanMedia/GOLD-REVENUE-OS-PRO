import "server-only";
import { cache } from "react";
import { requireAdminCapability } from "@/lib/admin/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { decodeSignalCursor,signalPageSchema,signalSearchSchema,signalSummarySchema,type SignalSearch } from "./read-model";
const readContext=cache(async()=>({context:await requireAdminCapability("signals.read"),db:await createSupabaseServerClient()}));
export async function requireSignalRead(){return (await readContext()).context;}
export async function signalOperations(input:SignalSearch){
 const {context,db}=await readContext();let q:SignalSearch,cursor=null;
 try{q=signalSearchSchema.parse(input);cursor=q.cursor?decodeSignalCursor(q.cursor):null;}catch{return {page:null,summary:null,error:"cursor" as const,summaryError:false};}
 const safeRpc=async(name:string,args:Record<string,unknown>)=>Promise.resolve(db.rpc(name,args)).catch(()=>({data:null,error:{code:"READ_UNAVAILABLE"}}));
 const [rows,summary]=await Promise.all([safeRpc(q.collection==="reviews"?"admin_signal_review_page_v1":"admin_signal_page_v2",{target_tenant_id:context.tenantId,...(q.collection==="reviews"?{}:{collection_value:q.collection,status_value:q.status??null}),provider_value:q.provider??null,source_value:q.source??null,destination_value:q.destination??null,delivery_value:q.delivery??null,page_size_value:Number(q.size),cursor_value:cursor}),safeRpc("admin_signal_summary_v1",{target_tenant_id:context.tenantId})]);
 const p=signalPageSchema.safeParse(rows.data),s=signalSummarySchema.safeParse(summary.data);
 const page=!rows.error&&p.success&&p.data.collection===q.collection&&p.data.page_size===Number(q.size)?p.data:null;
 return {page,summary:!summary.error&&s.success?s.data:null,error:page?null:rows.error?.code==="22023"?"cursor" as const:"unavailable" as const,summaryError:Boolean(summary.error)||!s.success};
}
