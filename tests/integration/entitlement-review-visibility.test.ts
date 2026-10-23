import { beforeEach,describe,it,expect,vi } from "vitest";
import { createElement as h } from "../../apps/web/node_modules/react";
import { renderToStaticMarkup as render } from "../../apps/web/node_modules/react-dom/server";
import { mkdirSync,readFileSync,writeFileSync } from "node:fs";
import { jobHealthSchema,jobHealthRowSchema,type JobHealth } from "../../apps/web/src/lib/entitlements/job-health";
import { EntitlementJobHealth } from "../../apps/web/src/components/entitlement-job-health";
import { AdminI18nProvider } from "../../apps/web/src/components/admin-i18n";
const mocks=vi.hoisted(()=>({require:vi.fn(),rpc:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/admin/server",()=>({requireAdminCapability:mocks.require}));
vi.mock("@/lib/supabase/server",()=>({createSupabaseServerClient:async()=>({rpc:mocks.rpc})}));
import { entitlementJobHealth } from "../../apps/web/src/lib/entitlements/admin";
const sid="16a31000-0000-4000-8000-000000000001",jid="16a32000-0000-4000-8000-000000000001";
const item:JobHealth={job_id:jid,mode:"test",financial_authority:"NONE",retry_authority:"NONE",revision_current:true,review_required:true,obligation:"REVOKE",reason:"UNKNOWN_EFFECT",claims:3,reclaims:1,provider_failures:2,effect_state:"UNCERTAIN",lease_state:"NONE"};
const envelope=(items:unknown[]=[item])=>({version:1,subscription_id:sid,observed_at:"2026-10-23T17:00:00Z",items});
beforeEach(()=>{vi.clearAllMocks();mocks.require.mockResolvedValue({tenantId:"server-owned",role:"support"});mocks.rpc.mockResolvedValue({data:envelope(),error:null});});
describe("bounded server-owned diagnostic supplement",()=>{
 it("uses existing capability and server tenant, one batch query",async()=>{
  expect((await entitlementJobHealth(sid,[jid])).data?.items[0]?.reason).toBe("UNKNOWN_EFFECT");
  expect(mocks.require).toHaveBeenCalledWith("entitlements.read");expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("admin_entitlement_job_health_v1",{target_tenant_id:"server-owned",target_subscription_id:sid,job_ids_value:[jid]});
 });
 it.each([[jid,jid],Array(101).fill(jid),["bad"]])("rejects duplicate, oversized and malformed selectors",async ids=>{
  expect((await entitlementJobHealth(sid,ids)).error).toBe("unavailable");expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it("rejects malformed subscription before querying",async()=>{expect((await entitlementJobHealth("foreign",[jid])).error).toBe("unavailable");expect(mocks.rpc).not.toHaveBeenCalled();});
 it("does not swallow RBAC rejection",async()=>{mocks.require.mockRejectedValue(Error("DENIED"));await expect(entitlementJobHealth(sid,[jid])).rejects.toThrow("DENIED");expect(mocks.rpc).not.toHaveBeenCalled();});
 it.each([envelope([]),envelope([{...item,job_id:sid}]),envelope([item,item]),{...envelope(),subscription_id:jid},envelope([{...item,lease_token:jid}]),envelope([{...item,retry_authority:"GRANTED"}])])("rejects incomplete or foreign response and unexpected authority",async data=>{
  mocks.rpc.mockResolvedValue({data,error:null});expect((await entitlementJobHealth(sid,[jid])).error).toBe("unavailable");
 });
 it("does not serialize SQL/network error content or assume successful empty result",async()=>{
  mocks.rpc.mockRejectedValue(Error("private-token-value"));const result=await entitlementJobHealth(sid,[jid]);expect(result.error).toBe("unavailable");expect(result.data).toBeNull();expect(JSON.stringify(result)).not.toContain("private-token-value");
 });
 it("requires analyst SQL redaction as defense in depth",async()=>{
  mocks.require.mockResolvedValue({tenantId:"server-owned",role:"analyst"});expect((await entitlementJobHealth(sid,[jid])).error).toBe("unavailable");
  mocks.rpc.mockResolvedValue({data:envelope([{...item,reason:"RESTRICTED",claims:null,reclaims:null,provider_failures:null,effect_state:"RESTRICTED",lease_state:"RESTRICTED"}]),error:null});
  expect((await entitlementJobHealth(sid,[jid])).data).not.toBeNull();
 });
 it("bounds schemas and rejects numeric budget overflow",()=>{
  expect(jobHealthRowSchema.safeParse({...item,claims:8}).success).toBe(false);expect(jobHealthSchema.safeParse(envelope(Array(101).fill(item))).success).toBe(false);
 });
});
describe("operator guidance in real TR/EN component",()=>{
 it.each(["tr-TR","en-US"] as const)("shows evidence and retained obligation in %s, never a reset button",locale=>{
  const html=render(h(AdminI18nProvider,{locale},h(EntitlementJobHealth,{data:item})));
  expect(html).toContain(locale==="tr-TR"?"Sonucu bilinmeyen işlemi tekrarlamayın":"Do not retry an unknown effect");
  expect(html).toContain(locale==="tr-TR"?"Erişimi kaldırma yükümlülüğü":"Revocation obligation");expect(html).toContain("<summary>");
  expect(html).not.toContain("<form");expect(html).not.toContain("<button");expect(html).not.toContain("lease_token");expect(html).not.toContain("https://t.me");
 });
 it("restricts analyst budget display instead of rendering null as zero",()=>{
  const html=render(h(AdminI18nProvider,{locale:"en-US"},h(EntitlementJobHealth,{data:{...item,reason:"RESTRICTED",claims:null,reclaims:null,provider_failures:null,effect_state:"RESTRICTED",lease_state:"RESTRICTED"}})));
  expect(html).not.toContain("<details>");expect(html).not.toContain("Lifetime claims");expect(html).toContain("Technical details restricted");
 });
 it("expired lease explicitly does not prove effect absence",()=>{
  const html=render(h(AdminI18nProvider,{locale:"en-US"},h(EntitlementJobHealth,{data:{...item,lease_state:"EXPIRED",revision_current:false}})));
  expect(html).toContain("does not prove that no effect occurred");expect(html).toContain("Inspect the current revision");
 });
});
if(process.env.ENTITLEMENT_REVIEW_PREVIEW_DIR){
 const dir=process.env.ENTITLEMENT_REVIEW_PREVIEW_DIR;mkdirSync(dir,{recursive:true});
 const css=readFileSync("apps/web/src/app/globals.css","utf8").replace('@import "tailwindcss";','');
 for(const locale of ["tr-TR","en-US"] as const){
  const body=render(h(AdminI18nProvider,{locale},h("main",{className:"admin-main"},h("a",{href:"#evidence"},locale==="tr-TR"?"Abonelik kanıtları":"Subscription evidence"),h("h1",{id:"evidence"},locale==="tr-TR"?"TEST erişim işlemleri":"TEST access operations"),h("article",{className:"detail-card case-section"},h(EntitlementJobHealth,{data:item})),h("article",{className:"detail-card case-section"},h(EntitlementJobHealth,{data:{...item,job_id:sid,reason:"RECLAIM_BUDGET",effect_state:"NOT_STARTED",obligation:"RECONCILE",lease_state:"EXPIRED",revision_current:false}})))));
  writeFileSync(`${dir}/review-${locale}.html`,`<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gold Revenue OS · SYNTHETIC TEST</title><style>${css}</style><body>${body}</body></html>`);
 }
}
