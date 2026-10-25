import { describe, expect, it } from "vitest";
import { assessTelegramOperationalUpdate } from "./telegram-operational-capability";
const now = Date.parse("2026-10-25T23:00:00Z"), tenant = "91cc1000-0000-4000-8000-000000000001";
function fixture() {
  return { b: { version: 1, mode: "BUSINESS", tenant_id: tenant, connection_id: tenant, evidence_origin: "OFFLINE_FIXTURE", bot_user_id: "7100000001", representative_user_id: "8327046095", business_connection_id: "synthetic-connection", enabled: true, can_reply: true, observed_at: new Date(now).toISOString(), generation: "1" }, u: { update_id: 1, business_message: { business_connection_id: "synthetic-connection", message_id: 2, date: now/1000, text: "Synthetic incoming only", from: { id: 7100000002 }, chat: { id: 7100000002, type: "private" } } } };
}
describe("Telegram Bot/Business capability boundary, offline only", () => {
  it("normalizes authorized synthetic inbound but never grants real dispatch", () => { const s=fixture();expect(assessTelegramOperationalUpdate(s.b,s.u,tenant,"1",now)).toMatchObject({state:"INBOUND_READY",event:{providerUserId:"7100000002"},outbound_authority:"NONE"}); });
  it.each(["tenant", "generation", "stale", "disabled", "permission", "identity", "expired-window"])("%s fails closed", change => {
    const s=fixture();if(change==="tenant")s.b.tenant_id="91cc1000-0000-4000-8000-000000000002";if(change==="generation")s.b.generation="2";if(change==="stale")s.b.observed_at="2026-01-01T00:00:00Z";if(change==="disabled")s.b.enabled=false;if(change==="permission")s.b.can_reply=false;if(change==="identity")s.u.business_message.business_connection_id="foreign";if(change==="expired-window")s.u.business_message.date-=86400;
    expect(assessTelegramOperationalUpdate(s.b,s.u,tenant,"1",now)).toMatchObject({state:"HELD",live_operations_authorized:false});
  });
  it("keeps human observation, AI echo, edit and deletion semantics separate", () => {
    const s=fixture();s.u.business_message.from.id=8327046095;expect(assessTelegramOperationalUpdate(s.b,s.u,tenant,"1",now)).toMatchObject({state:"HUMAN_REPLY_OBSERVED",requires_ownership_commit:true});
    expect(assessTelegramOperationalUpdate(s.b,{update_id:1,business_message:{...s.u.business_message,sender_business_bot:{id:7100000001}}},tenant,"1",now)).toMatchObject({state:"HELD",reason:"BOT_ECHO_NOT_HUMAN_TAKEOVER"});
    s.u.business_message.from.id=7100000002;expect(assessTelegramOperationalUpdate(s.b,{update_id:1,edited_business_message:s.u.business_message},tenant,"1",now)).toMatchObject({state:"SOURCE_EDIT_REVIEW"});
    expect(assessTelegramOperationalUpdate(s.b,{update_id:2,deleted_business_messages:{business_connection_id:"synthetic-connection",chat:{id:7100000002,type:"private"},message_ids:[2]}},tenant,"1",now)).toMatchObject({state:"SOURCE_DELETION_REVIEW",reason:"DELETION_IS_NOT_DELIVERY_REVOCATION"});
  });
  it("BOT and BUSINESS updates never silently share a connection mode", () => { const s=fixture();s.b.mode="BOT";expect(assessTelegramOperationalUpdate(s.b,s.u,tenant,"1",now)).toMatchObject({state:"HELD"});expect(assessTelegramOperationalUpdate(s.b,{update_id:1,message:s.u.business_message},tenant,"1",now)).toMatchObject({state:"HELD"});expect(assessTelegramOperationalUpdate(s.b,{update_id:1,message:{message_id:2,date:now/1000,text:"Synthetic only",from:{id:7100000002},chat:{id:7100000002,type:"private"}}},tenant,"1",now)).toMatchObject({state:"INBOUND_READY"}); });
});
