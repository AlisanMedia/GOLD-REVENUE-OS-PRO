import { beforeEach, describe, expect, it, vi } from "vitest";
import { messageDeliveryLabel, manualReplyResult } from "../../apps/web/src/lib/escalations/manual-reply";
const f=vi.hoisted(()=>({authorize:vi.fn(),rpc:vi.fn()}));
vi.mock("server-only",()=>({}));vi.mock("@/lib/admin/server",()=>({requireAdminCapability:f.authorize}));vi.mock("@/lib/supabase/server",()=>({createSupabaseServerClient:()=>Promise.resolve({rpc:f.rpc})}));
import { getConversationMessagePage } from "../../apps/web/src/lib/messaging/server";
const tenant="91cc1000-0000-4000-8000-000000000001",conversation="91cc2000-0000-4000-8000-000000000001";
const page=()=>({version:1,page_size:25,has_more:false,next_cursor:null,items:[{id:conversation,direction:"inbound",content:"Synthetic only",status:"received",failure_code:null,occurred_at:"2026-10-25T00:00:00Z",created_at:"2026-10-25T00:00:00Z"}]});
beforeEach(()=>{vi.clearAllMocks();f.authorize.mockResolvedValue({tenantId:tenant});f.rpc.mockResolvedValue({data:page(),error:null});});
describe("server-owned message history and uncertain delivery presentation",()=>{
 it("uses one bounded role-guarded read and current authenticated tenant",async()=>{const r=await getConversationMessagePage(conversation,{});expect(r.page?.items).toHaveLength(1);expect(f.authorize).toHaveBeenCalledWith("messaging.read");expect(f.rpc).toHaveBeenCalledWith("admin_conversation_message_page_v1",{target_tenant_id:tenant,target_conversation_id:conversation,page_size_value:25,cursor_value:null});});
 it.each([{tenant:"foreign"},{cursor:["a","b"]},{cursor:"not-json"},{cursor:"{}"}])("invalid search %j never queries a privileged source",async search=>{expect(await getConversationMessagePage(conversation,search)).toMatchObject({error:true,page:null});expect(f.rpc).not.toHaveBeenCalled();});
 it("denies unauthorized access before parsing source data",async()=>{f.authorize.mockRejectedValue(Error("DENIED"));await expect(getConversationMessagePage(conversation,{})).rejects.toThrow("DENIED");expect(f.rpc).not.toHaveBeenCalled();});
 it("does not serialize unexpected routing or private fields from a bad read model",async()=>{f.rpc.mockResolvedValue({data:{...page(),items:[{...page().items[0],provider_chat_id:"PRIVATE_ID"}]},error:null});const r=await getConversationMessagePage(conversation,{});expect(r).toEqual({page:null,error:true});expect(JSON.stringify(r)).not.toContain("PRIVATE_ID");});
 it("unknown effect is never presented as definite failure or successful delivery",()=>{expect(messageDeliveryLabel("failed","TELEGRAM_DELIVERY_UNCERTAIN")).toContain("belirsiz");expect(manualReplyResult(false,{error:"DELIVERY_UNKNOWN_REVIEW_REQUIRED"})).toContain("Otomatik yeniden deneme yapılmaz");expect(messageDeliveryLabel("failed")).toBe("Teslim edilemedi");});
});
