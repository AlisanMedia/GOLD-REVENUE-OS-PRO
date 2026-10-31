import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { authenticateCampaignIngress, authenticatePrivateBetaIngress } from "../../apps/web/src/lib/polat/private-beta-webhook";

const config = { tenantId: "912ac000-0000-4000-8000-000000000001", programId: "912ac000-0000-4000-8000-000000000002",
  releaseSha: "a".repeat(40), webhookSecret: "SYNTHETIC_WEBHOOK_SECRET".padEnd(40,"x"), relaySecret: "SYNTHETIC_RELAY_SECRET".padEnd(40,"y") };
function body() { return JSON.stringify({ update_id: 14, business_message: { business_connection_id: "synthetic-business-connection", message_id: 15,
  date: Math.floor(Date.now()/1000), chat: { id: 123456789, type: "private" }, from: { id: 123456789, is_bot: false }, text: "Hi" } }); }
function signed(raw: string, binding = config, beta = false, timestamp = Math.floor(Date.now()/1000).toString()) {
  const hash = createHash("sha256").update(raw).digest("hex");
  const signature = createHmac("sha256", binding.relaySecret).update(JSON.stringify(beta ? ["POLAT_UAT_RELAY1",timestamp,hash]
    : ["POLAT_CAMPAIGN_RELAY1",binding.tenantId,binding.programId,binding.releaseSha,timestamp,hash])).digest("hex");
  return new Request("https://fixture.invalid/api/webhooks/campaign/telegram", { method: "POST", headers: { "content-type":"application/json",
    "x-telegram-bot-api-secret-token":binding.webhookSecret,"x-polat-uat-timestamp":timestamp,"x-polat-uat-signature":signature },body:raw });
}
describe("authenticated existing parser, separate campaign relay signature scope", () => {
  it("parses genuine-shaped numeric Business input with no credential lookup or model call", async () => {
    const value = await authenticateCampaignIngress(signed(body()),config);
    expect(value.kind).toBe("BUSINESS");
    if(value.kind==="BUSINESS") expect(value.event).toMatchObject({ providerUserId:"123456789",providerChatId:"123456789",botEcho:false });
  });
  it.each(["TENANT","CAMPAIGN","SHA","BODY","UAT_DOMAIN","EXPIRED"])("rejects %s replay/drift", async kind => {
    const raw=body(), different={...config};
    if(kind==="TENANT")different.tenantId="912ac000-0000-4000-8000-000000000009";
    if(kind==="CAMPAIGN")different.programId="912ac000-0000-4000-8000-000000000009";
    if(kind==="SHA")different.releaseSha="b".repeat(40);
    const request=signed(raw,different,kind==="UAT_DOMAIN",String(Math.floor(Date.now()/1000)-(kind==="EXPIRED"?301:0)));
    await expect(authenticateCampaignIngress(kind==="BODY"?new Request(request,{body:raw.replace('"Hi"','"changed"')}):request,config)).rejects.toThrow();
  });
  it("a campaign signature cannot activate the historical UAT ingress", async () => {
    await expect(authenticatePrivateBetaIngress(signed(body()),config)).rejects.toThrow();
  });
});
