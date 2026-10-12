"use server";
import {requireAdminCapability} from "@/lib/admin/server";
import {createSupabaseServerClient} from "@/lib/supabase/server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
export async function reviewOffer(f:FormData){
 const c=await requireAdminCapability("commercial.write"),db=await createSupabaseServerClient();
 const {error}=await db.rpc("admin_offer_action",{target_tenant_id:c.tenantId,target_offer_id:String(f.get("offer_id")),action_value:String(f.get("action"))});
 revalidatePath("/admin/offers");redirect("/admin/offers"+(error?"?error="+encodeURIComponent(error.code??"review"):""));
}
