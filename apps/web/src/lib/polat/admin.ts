import "server-only";
import{cache}from "react";
import{requireAdminCapability}from "@/lib/admin/server";
import{hasAdminCapability}from "@/lib/admin/permissions";
import{createSupabaseServerClient}from "@/lib/supabase/server";
import{analyticsWorkspace}from "@/lib/analytics/server";
import{polatCrmMetricEvidence}from "@gold-revenue-os/domain";
import{polatSearchSchema,polatCursor,polatPeriod,polatInboundPageSchema,polatSummarySchema,type PolatSearch}from "./read-model";
const readContext=cache(async()=>({context:await requireAdminCapability("agents.read"),db:await createSupabaseServerClient()}));
export async function requirePolatRead(){return(await readContext()).context;}
export async function polatOperations(input:PolatSearch){
 const{context,db}=await readContext();let q:PolatSearch,cursor=null;
 try{q=polatSearchSchema.parse(input);cursor=q.cursor?polatCursor(q.cursor):null;}catch{return{page:null,summary:null,business:null,businessError:false,businessDenied:false,error:"cursor"as const,summaryError:false};}
 if(q.view==="business"){
  if(!hasAdminCapability(context.role,"analytics.read"))return{page:null,summary:null,business:null,businessError:false,businessDenied:true,error:null,summaryError:false};
  try{const{data}=await analyticsWorkspace({...polatPeriod(q.days),mode:q.mode});return{page:null,summary:null,business:polatCrmMetricEvidence(data),businessError:false,businessDenied:false,error:null,summaryError:false};}catch{return{page:null,summary:null,business:null,businessError:true,businessDenied:false,error:null,summaryError:false};}
 }
 const rpc=async(name:string,args:Record<string,unknown>)=>Promise.resolve(db.rpc(name,args)).catch(()=>({data:null,error:{code:"READ_UNAVAILABLE"}}));
 const range=polatPeriod(q.days);const[rows,summary]=await Promise.all([rpc("admin_polat_inbound_page_v1",{target_tenant_id:context.tenantId,conversation_value:q.conversation??null,state_value:q.state??null,page_size_value:Number(q.size),cursor_value:cursor}),rpc("admin_polat_response_summary_v1",{target_tenant_id:context.tenantId,start_value:range.start,end_value:range.end})]);
 const p=polatInboundPageSchema.safeParse(rows.data),s=polatSummarySchema.safeParse(summary.data);const page=!rows.error&&p.success&&p.data.page_size===Number(q.size)?p.data:null;
 return{page,summary:!summary.error&&s.success?s.data:null,business:null,businessError:false,businessDenied:false,error:page?null:rows.error?.code==="22023"?"cursor"as const:"unavailable"as const,summaryError:!!summary.error||!s.success};
}
export type PolatOperations=Awaited<ReturnType<typeof polatOperations>>;
