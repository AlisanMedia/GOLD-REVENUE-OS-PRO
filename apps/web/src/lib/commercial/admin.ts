import "server-only";
import {requireAdminCapability} from "@/lib/admin/server";
import {createSupabaseServerClient} from "@/lib/supabase/server";
import {commercialPayload} from "@gold-revenue-os/domain";

export type CommercialRow={id:string;kind:"product"|"plan"|"knowledge";version_id:string;version:number;status:string;archived_at:string|null;test_only:boolean;payload:Record<string,unknown>;current_price?:{amount:string|null;currency:string|null;version:number}|null;effective_from:string;expires_at:string|null;published_at:string|null};
export type VersionRow={id:string;item_id:string;version:number;status:string;payload:Record<string,unknown>;created_at:string;created_by:string;reviewer:string|null;reviewed_at:string|null;published_at:string|null;effective_from:string;expires_at:string|null;superseded_at:string|null};
export async function commercialList(kind:string,search="",category=""):Promise<CommercialRow[]>{
 const c=await requireAdminCapability("commercial.read"),db=await createSupabaseServerClient();
 const {data,error}=await db.rpc("admin_commercial_list",{target_tenant_id:c.tenantId,kind_value:kind,search_value:search,category_value:category});
 if(error)throw new Error("Commercial listing unavailable");return (data??[]) as CommercialRow[];
}
export async function commercialHistory(id:string):Promise<VersionRow[]>{
 const c=await requireAdminCapability("commercial.read"),db=await createSupabaseServerClient();
 const {data,error}=await db.rpc("admin_commercial_history",{target_tenant_id:c.tenantId,target_item_id:id});
 if(error)throw new Error("Commercial history unavailable");return (data??[]) as VersionRow[];
}
export {commercialPayload};
export async function conversationCommercial(id:string):Promise<{run_id:string|null;status:string;failure:string|null;result:{action:string;reason:string;plan_version_id:string|null;offer_id:string|null;follow_up?:{action:string;reason:string}}}|null>{
 const c=await requireAdminCapability("commercial.read"),db=await createSupabaseServerClient();
 const {data,error}=await db.rpc("admin_conversation_commercial",{target_tenant_id:c.tenantId,target_conversation_id:id});
 if(error)throw new Error("Commercial conversation evidence unavailable");return data;
}
