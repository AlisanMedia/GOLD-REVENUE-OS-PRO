import { describe,it,expect } from "vitest";
import { createElement as h } from "../../apps/web/node_modules/react";
import { renderToStaticMarkup as render } from "../../apps/web/node_modules/react-dom/server";
import PurchaseStatus from "../../apps/web/src/components/purchase-status";
const base={now:Date.parse("2030-01-01T00:00:00Z"),mode:"test" as const,paymentVerified:true,state:"ACTIVE" as const,endsAt:"2030-01-31T00:00:00Z",graceUntil:"2030-01-31T00:00:00Z"};
describe("real membership component / source contradictions",()=>{
 it("REVIEW remains visible without claiming access is being prepared or completed",()=>{
  const html=render(h(PurchaseStatus,{...base,accessStatus:"REVIEW"}));expect(html).toContain("needs review");expect(html).not.toContain("joining is being prepared");expect(html).not.toContain("access are active");
 });
 it.each(["2029-12-31T00:00:00Z","invalid"])("invalid grace %s cannot produce active access",graceUntil=>{
  const html=render(h(PurchaseStatus,{...base,graceUntil,accessStatus:"MEMBER"}));expect(html).not.toContain("access are active");expect(html).not.toContain("Join VIP</a>");
 });
 it("unverified period never implies actual payment despite a MEMBER snapshot",()=>{
  const html=render(h(PurchaseStatus,{...base,paymentVerified:false,accessStatus:"MEMBER"}));expect(html).toContain("awaiting confirmation");expect(html).not.toContain("Payment verified");expect(html).not.toContain("updates automatically");
 });
 it.each([NaN,Infinity,1e99])("invalid clock %s cannot claim active membership",now=>expect(render(h(PurchaseStatus,{...base,now,accessStatus:"MEMBER"}))).not.toContain("access are active"));
 it("uses an explicit UTC label and no raw timestamp as ordinary customer wording",()=>{
  const html=render(h(PurchaseStatus,base));expect(html).toContain("UTC");expect(html).not.toContain("2030-01-31T00:00:00Z");
 });
 it.each(["2030-02-01T00:00:00Z","2029-12-31T00:00:00Z"])("out-of-entitlement invitation %s is not rendered",inviteExpires=>{
  // Shape-only link is never fetched or transmitted to a provider.
  const html=render(h(PurchaseStatus,{...base,mode:"live",accessStatus:"INVITED",invite:"https://t.me/+SYNTHETIC",inviteExpires}));expect(html).not.toContain('href="https://t.me/');
 });
 it("REVOKED snapshot with a stale invitation cannot show a join action",()=>{
  const html=render(h(PurchaseStatus,{...base,mode:"live",accessStatus:"REVOKED",invite:"https://t.me/+SYNTHETIC",inviteExpires:"2030-01-01T00:05:00Z"}));expect(html).not.toContain('href="https://t.me/');expect(html).toContain("needs review");
 });
});
