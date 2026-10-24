import {beforeEach,describe,it,expect,vi} from "vitest";
import {createElement as h} from "../../apps/web/node_modules/react";
import {renderToStaticMarkup as render} from "../../apps/web/node_modules/react-dom/server";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {signalPageSchema,signalSummarySchema,signalSearchSchema,signalRowSchema,decodeSignalCursor,signalHref,signalCodes,signalStates,signalStatuses,type SignalRow,type SignalSummary,type SignalPage} from "../../apps/web/src/lib/signals/read-model";
import {signalOperations} from "../../apps/web/src/lib/signals/admin";
import {SignalOperationsView} from "../../apps/web/src/components/signal-operations";
import {AdminI18nProvider} from "../../apps/web/src/components/admin-i18n";
import {AdminWorkspaceFrame} from "../../apps/web/src/components/admin-workspace-frame";
import {NavigationItems} from "../../apps/web/src/components/admin-navigation";
import {hasAdminCapability} from "../../apps/web/src/lib/admin/permissions";
import {translator} from "../../apps/web/src/lib/i18n/core";
const mocks=vi.hoisted(()=>({require:vi.fn(),rpc:vi.fn(),path:"/admin/signals"}));
vi.mock("@/app/(auth)/login/actions",()=>({signOut:async()=>{}}));
vi.mock("@/app/admin/preferences/actions",()=>({changeAdminLocale:async()=>"SAVED"}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/admin/server",()=>({requireAdminCapability:mocks.require}));
vi.mock("@/lib/supabase/server",()=>({createSupabaseServerClient:async()=>({rpc:mocks.rpc})}));
vi.mock("next/navigation",()=>({usePathname:()=>mocks.path}));
const id="51c03000-0000-4000-8000-000000000001",tenant="51c02000-0000-4000-8000-000000000001",time="2026-10-23T20:00:00Z";
const row:SignalRow={id,kind:"DELIVERY",label:"OUT-102",reference:"OUT-102",state:"UNKNOWN",provider_id:id,source_id:id,destination_id:id,event_id:id,delivery_id:id,provider_label:"Synthetic provider",source_label:"Synthetic source A",destination_label:"Synthetic destination",revision:"3",observed_at:time,published_at:null,recorded_at:time,acknowledged_at:null,available_at:time,code:"UNKNOWN_EFFECT",parse_state:null,current:true,paused:null,authorization:null,claims:2,reclaims:1,failures:0,signal:null};
const cursor={version:1 as const,scope:"a".repeat(64),started_at:time,after:"100",anchor:"102"};
const page:SignalPage={version:1,mode:"SYNTHETIC",financial_authority:"NONE",live_authority:"NONE",collection:"deliveries",page_size:25,items:[row],has_more:true,next_cursor:cursor,consistency:"LIVE_KEYSET_REFRESH_FOR_CHANGES"};
const summary:SignalSummary={version:1,mode:"SYNTHETIC",financial_authority:"NONE",live_authority:"NONE",enabled:false,observed_at:time,oldest_pending_at:time,counts:signalStatuses.map(s=>({status:s,value:s==="UNKNOWN"?1:0,complete:true})),latency:{sampled:2,valid:2,p50_ms:15.01,p95_ms:30.02,p99_ms:30.02,max_ms:30.02,last_ack_at:time}};
beforeEach(()=>{vi.clearAllMocks();mocks.require.mockResolvedValue({tenantId:tenant,role:"support"});mocks.rpc.mockImplementation(async(name:string)=>({data:name==="admin_signal_page_v2"?page:summary,error:null}));});
describe("minimal server-owned signal read boundary",()=>{
 it("uses capability, validated tenant and exactly one bounded list + summary",async()=>{const r=await signalOperations({collection:"deliveries",size:"25"});expect(r.error).toBeNull();expect(r.summary?.mode).toBe("SYNTHETIC");expect(mocks.require).toHaveBeenCalledWith("signals.read");expect(mocks.rpc).toHaveBeenCalledTimes(2);expect(mocks.rpc).toHaveBeenCalledWith("admin_signal_page_v2",expect.objectContaining({target_tenant_id:tenant,page_size_value:25,source_value:null,cursor_value:null}));});
 it("does not swallow authorization denial",async()=>{mocks.require.mockRejectedValue(Error("DENIED"));await expect(signalOperations({collection:"events",size:"25"})).rejects.toThrow("DENIED");expect(mocks.rpc).not.toHaveBeenCalled();});
 it("rejects malformed cursor before any RPC",async()=>{expect((await signalOperations({collection:"events",size:"25",cursor:"{}"})).error).toBe("cursor");expect(mocks.rpc).not.toHaveBeenCalled();});
 it("strict schema refuses leaked private fields or counterfeit authority",()=>{for(const extra of [{lease_token:id},{source_ref:"private"},{original_text:"private"},{live_authority:"LIVE"}])expect(signalRowSchema.safeParse({...row,...extra}).success).toBe(false);expect(signalPageSchema.safeParse({...page,financial_authority:"LIVE"}).success).toBe(false);});
 it("rejects duplicate rows, wrong collection and inconsistent completeness",()=>{expect(signalPageSchema.safeParse({...page,items:[row,row]}).success).toBe(false);expect(signalPageSchema.safeParse({...page,collection:"sources"}).success).toBe(false);expect(signalPageSchema.safeParse({...page,next_cursor:null}).success).toBe(false);});
 it("keeps network/database failure distinct from empty result and hides raw errors",async()=>{mocks.rpc.mockRejectedValue(Error("PRIVATE_ERROR_TOKEN"));const r=await signalOperations({collection:"events",size:"25"});expect(r.error).toBe("unavailable");expect(r.page).toBeNull();expect(r.summary).toBeNull();expect(JSON.stringify(r)).not.toContain("PRIVATE_ERROR_TOKEN");});
 it("rejects RPC projection mismatch",async()=>{mocks.rpc.mockResolvedValue({data:{...page,items:[{...row,lease_token:id}]},error:null});expect((await signalOperations({collection:"deliveries",size:"25"})).error).toBe("unavailable");});
 it("cursor serialization is exact and duplicate JSON keys cannot be concealed",()=>{expect(decodeSignalCursor(JSON.stringify(cursor))).toEqual(cursor);expect(()=>decodeSignalCursor(JSON.stringify(cursor).replace('{','{"version":1,'))).toThrow();expect(()=>decodeSignalCursor('{"scope":"x"}')).toThrow();});
 it("accepts PostgreSQL jsonb cursor key order without accepting duplicate keys",()=>{const pg={after:cursor.after,scope:cursor.scope,anchor:cursor.anchor,version:cursor.version,started_at:cursor.started_at};expect(decodeSignalCursor(JSON.stringify(pg))).toEqual(cursor);expect(()=>decodeSignalCursor(JSON.stringify(pg).replace('{','{"version":1,'))).toThrow();});
 it("URLs carry only bounded safe selectors and encoded cursor, never tenant authority",()=>{const url=signalHref({collection:"deliveries",source:id,status:"UNKNOWN",cursor});expect(url).toContain("source="+id);expect(url).toContain("cursor=");expect(url).not.toContain("tenant");expect(signalSearchSchema.safeParse({tenant}).success).toBe(false);expect(signalSearchSchema.safeParse({size:"101"}).success).toBe(false);expect(signalSearchSchema.parse({status:""}).status).toBeUndefined();});
 it("missing data never becomes a latency zero and duplicate counters are rejected",()=>{expect(signalSummarySchema.safeParse({...summary,latency:{...summary.latency,valid:0,p95_ms:0}}).success).toBe(false);expect(signalSummarySchema.safeParse({...summary,counts:Array(9).fill(summary.counts[0])}).success).toBe(false);});
 it.each(["super_admin","manager","support","analyst","readonly"] as const)("preserves %s signal role boundary",role=>{expect(hasAdminCapability(role,"signals.read")).toBe(role!=="readonly");});
});
function localized(locale:"tr-TR"|"en-US",p:SignalPage|null=page,s:SignalSummary|null=summary,error:"cursor"|"unavailable"|null=null){return render(h(AdminI18nProvider,{locale},h(SignalOperationsView,{query:{collection:"deliveries",size:"25"},page:p,summary:s,error,summaryError:!s})));}
describe("actual signal operator components and locale",()=>{
 it.each(["tr-TR","en-US"] as const)("shows truthful unknown + safe links in %s",locale=>{const html=localized(locale);expect(html).toContain(locale==="tr-TR"?"Körlemesine yeniden göndermeyin":"Do not blindly resend");expect(html).toContain("<summary>");expect(html).toContain("UTC");expect(html).toContain('method="get"');expect(html).toContain("cursor=");expect(html).not.toContain('method="post"');expect(html).not.toContain("force-send");expect(html).not.toContain("lease_token");expect(html).not.toContain("https://t.me");});
 it("real navigation respects permission and marks the active screen",()=>{const html=render(h(AdminI18nProvider,{locale:"tr-TR"},h(NavigationItems,{role:"manager"})));expect(html).toContain("Sinyal Operasyonları");expect(html).toContain('href="/admin/signals"');expect(html).toContain('aria-current="page"');const denied=render(h(AdminI18nProvider,{locale:"en-US"},h(NavigationItems,{role:"readonly"})));expect(denied).not.toContain('href="/admin/signals"');});
 it("empty result and unavailable result remain different",()=>{expect(localized("en-US",{...page,items:[],has_more:false,next_cursor:null},null)).toContain("No records in this scope");const html=localized("en-US",null,null,"unavailable");expect(html).toContain("Signal records could not be loaded");expect(html).not.toContain("No records in this scope");});
 it("does not show invented empty latency statistics",()=>{const html=localized("en-US",page,{...summary,latency:{sampled:0,valid:0,p50_ms:null,p95_ms:null,p99_ms:null,max_ms:null,last_ack_at:null}});expect(html).toContain("Unknown duration is not zero");expect(html).not.toContain("0 ms");});
 it("restricted content and uncertain parse provide next steps without bypass",()=>{const p={...page,items:[{...row,state:"REVIEW" as const,code:"SOURCE_RESTRICTED" as const},{...row,id:tenant,state:"REVIEW" as const,code:"PARSE_UNCERTAIN" as const}]};const html=localized("en-US",p);expect(html).toContain("Content protection is not bypassed");expect(html).toContain("no price or trading instruction was filled in");});
 it("keeps a bounded history view linked to its selected delivery",()=>{const html=render(h(AdminI18nProvider,{locale:"en-US"},h(SignalOperationsView,{query:{collection:"history",delivery:id,size:"25"},page:{...page,collection:"history",items:[{...row,kind:"HISTORY",label:"OUT-102 · LOG-201",state:"SIMULATED",code:"BEGUN"}]},summary:null,error:null})));expect(html).toContain("collection=deliveries&amp;delivery="+id);expect(html).toContain("Synthetic source A");expect(html).not.toContain('method="post"');});
 it("renders provider/customer text as data and escapes injection",()=>{const html=localized("tr-TR",{...page,items:[{...row,source_label:'<script>SECRET()</script>'}]});expect(html).not.toContain("<script>SECRET()");expect(html).toContain("&lt;script&gt;");expect(html).toContain("Synthetic provider");});
 it("labels all states and safe codes in both locales rather than leaking enum slugs",()=>{for(const locale of ["tr-TR","en-US"] as const)for(const k of [...signalCodes,...signalStates]){const t=translator(locale);expect(t(`signal.${k}`)).toBeTruthy();expect(t(`signal.${k}`)).not.toBe(k);}});
});
if(process.env.SIGNAL_OPS_PREVIEW_DIR){const dir=process.env.SIGNAL_OPS_PREVIEW_DIR;mkdirSync(dir,{recursive:true});const css=readFileSync("apps/web/src/app/globals.css","utf8").replace('@import "tailwindcss";','');for(const locale of ["tr-TR","en-US"] as const){const p={...page,items:[row,{...row,id:tenant,label:"OUT-101",state:"REVIEW" as const,code:"SOURCE_RESTRICTED" as const},{...row,id:"51c03000-0000-4000-8000-000000000002",label:"OUT-100",state:"FAKE_CONFIRMED" as const,code:"FAKE_ACK" as const,acknowledged_at:time}]};writeFileSync(`${dir}/signals-${locale}.html`,`<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gold Revenue OS · Synthetic signal operations</title><style>${css}</style><body>${render(h(AdminWorkspaceFrame,{locale,tenantName:"SIGNAL · SYNTHETIC TEST",userLabel:"synthetic-operator@example.test",role:"manager"},h(SignalOperationsView,{query:{collection:"deliveries",size:"25"},page:p,summary:{...summary,counts:signalStatuses.map(st=>({status:st,value:["UNKNOWN","REVIEW","FAKE_CONFIRMED"].includes(st)?1:0,complete:true})),latency:{sampled:1,valid:1,p50_ms:30.02,p95_ms:30.02,p99_ms:30.02,max_ms:30.02,last_ack_at:time}},error:null})))}</body></html>`);}}
vi.mock("@/lib/signals/admin",()=>import("../../apps/web/src/lib/signals/admin"));
vi.mock("@/lib/signals/read-model",()=>import("../../apps/web/src/lib/signals/read-model"));
vi.mock("@/components/signal-operations",()=>import("../../apps/web/src/components/signal-operations"));
import SignalPageRoute from "../../apps/web/src/app/admin/signals/page";
describe("actual asynchronous Admin route",()=>{
 it("keeps validated source and status in the server-owned read",async()=>{const view=await SignalPageRoute({searchParams:Promise.resolve({collection:"deliveries",source:id,status:"UNKNOWN"})});const html=render(h(AdminI18nProvider,{locale:"tr-TR"},view));expect(html).toContain("Sinyal Operasyonları");expect(mocks.rpc).toHaveBeenCalledWith("admin_signal_page_v2",expect.objectContaining({source_value:id,status_value:"UNKNOWN",target_tenant_id:tenant}));});
 it("rejects client tenant and repeated search arguments without querying data",async()=>{let view=await SignalPageRoute({searchParams:Promise.resolve({tenant})});expect(render(h(AdminI18nProvider,{locale:"en-US"},view))).toContain("page link is invalid");expect(mocks.rpc).not.toHaveBeenCalled();view=await SignalPageRoute({searchParams:Promise.resolve({size:["25","100"]})});expect(render(h(AdminI18nProvider,{locale:"en-US"},view))).toContain("page link is invalid");});
 it("does not hide a permission failure behind validation UI",async()=>{mocks.require.mockRejectedValue(Error("DENIED"));await expect(SignalPageRoute({searchParams:Promise.resolve({tenant})})).rejects.toThrow("DENIED");expect(mocks.rpc).not.toHaveBeenCalled();});
});
import SignalOperationsLayout from "../../apps/web/src/app/admin/signals/layout";
describe("authorization before the loading boundary",()=>{
 it("returns allowed children after the existing capability guard",async()=>{const child=h("p",null,"allowed");expect(await SignalOperationsLayout({children:child})).toBe(child);expect(mocks.require).toHaveBeenCalledWith("signals.read");expect(mocks.rpc).not.toHaveBeenCalled();});
 it("rejects before returning children or loading UI for a denied role",async()=>{mocks.require.mockRejectedValue(Error("DENIED"));await expect(SignalOperationsLayout({children:h("p",null,"PROTECTED")})).rejects.toThrow("DENIED");expect(mocks.rpc).not.toHaveBeenCalled();});
});

const health={mode:"SYNTHETIC"as const,state:"RECOVERING"as const,generation:4,last_sequence:64,recovery_target:130,recovery_required:true,recovery_attempts:0,last_activity_at:time,disconnected_at:time,fresh:true,sequence_capability:"MONOTONIC_INT"as const,recovery_capability:"INDEPENDENT_FAKE_HISTORY"as const};
const sourceRow:SignalRow={...row,kind:"SOURCE",state:"SIMULATED",label:"Synthetic source A",source_health:health,source_label:"Synthetic source A",destination_label:null,delivery_id:null,event_id:null,destination_id:null,current:null,authorization:"SYNTHETIC_APPROVED",paused:false,claims:null,reclaims:null,failures:null,code:null};
const reviewRow:SignalRow={...row,kind:"REVIEW",state:"OPEN",label:"REV-2",code:null,current:null,claims:null,reclaims:null,failures:null,revision:null,observed_at:null,published_at:null,available_at:null,acknowledged_at:null,review:{issue:"UNKNOWN_DELIVERY",reason:"EVIDENCE_MISSING",reviewer_role:"manager"}};
const reviewPage:SignalPage={...page,collection:"reviews",items:[reviewRow]};
describe("source continuity and read-only operational review",()=>{
 it("validates strict health/review projections without lease, actor or raw-source leakage",()=>{
  expect(signalRowSchema.safeParse(sourceRow).success).toBe(true);expect(signalRowSchema.safeParse(reviewRow).success).toBe(true);
  expect(signalRowSchema.safeParse({...sourceRow,source_health:{...health,lease_token:id}}).success).toBe(false);
  expect(signalRowSchema.safeParse({...reviewRow,review:{...reviewRow.review,reviewer_id:id}}).success).toBe(false);
  expect(signalRowSchema.safeParse({...row,source_health:health}).success).toBe(false);
 });
 it.each(["tr-TR","en-US"]as const)("%s source recovery is actionable without a force-send control",locale=>{
  const html=render(h(AdminI18nProvider,{locale},h(SignalOperationsView,{query:{collection:"sources",size:"25"},page:{...page,collection:"sources",items:[sourceRow]},summary:null,error:null})));
  expect(html).toContain(locale==="tr-TR"?"Kayıp dönem doğrulanıyor":"Outage history under verification");expect(html).toContain("130");expect(html).toContain('collection=reviews');expect(html).not.toContain('method="post"');
 });
 it.each(["tr-TR","en-US"]as const)("%s review resolution is not a delivery or resend claim",locale=>{
  const html=render(h(AdminI18nProvider,{locale},h(SignalOperationsView,{query:{collection:"reviews",size:"25"},page:reviewPage,summary:null,error:null})));
  expect(html).toContain(locale==="tr-TR"?"İnceleme açık":"Review open");expect(html).toContain(locale==="tr-TR"?"yeniden gönderim başlatmaz":"does not change delivery state");expect(html).not.toContain('method="post"');
 });
 it("uses a distinct read-only RPC with the existing server tenant/capability",async()=>{
  mocks.rpc.mockImplementation(async(name:string)=>({data:name==="admin_signal_review_page_v1"?reviewPage:summary,error:null}));
  expect((await signalOperations({collection:"reviews",size:"25",source:id})).page?.collection).toBe("reviews");
  expect(mocks.rpc).toHaveBeenCalledWith("admin_signal_review_page_v1",expect.objectContaining({target_tenant_id:tenant,source_value:id,page_size_value:25}));
  expect(mocks.rpc.mock.calls[0]?.[1]).not.toHaveProperty("status_value");
 });
 it("rejects misleading delivery-status filters on a review history",async()=>{
  expect(signalSearchSchema.safeParse({collection:"reviews",status:"UNKNOWN"}).success).toBe(false);
  expect((await signalOperations({collection:"reviews",size:"25",status:"UNKNOWN"})).error).toBe("cursor");expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it("exposes only an expired-lease warning and no worker token",()=>{
  const html=render(h(AdminI18nProvider,{locale:"en-US"},h(SignalOperationsView,{query:{collection:"deliveries",size:"25"},page:{...page,items:[{...row,state:"RUNNING",lease_expired:true}]},summary:null,error:null})));
  expect(html).toContain("The worker lease expired.");expect(html).not.toContain("lease_token");
 });
 it("keeps a missing independent head unknown rather than0",()=>{
  const html=render(h(AdminI18nProvider,{locale:"en-US"},h(SignalOperationsView,{query:{collection:"sources",size:"25"},page:{...page,collection:"sources",items:[{...sourceRow,source_health:{...health,recovery_target:null,fresh:false}}]},summary:null,error:null})));
  expect(html).toContain("No independent history evidence yet");expect(html).toContain("Source freshness is unverified");
 });
});
if(process.env.SIGNAL_REVIEW_PREVIEW_DIR){
 const dir=process.env.SIGNAL_REVIEW_PREVIEW_DIR;mkdirSync(dir,{recursive:true});const css=readFileSync("apps/web/src/app/globals.css","utf8").replace('@import "tailwindcss";','');
 for(const locale of["tr-TR","en-US"]as const)for(const collection of["sources","reviews"]as const){
  const items=collection==="sources"?[sourceRow,{...sourceRow,id:tenant,source_id:tenant,source_label:"Synthetic source B",label:"Synthetic source B",source_health:{...health,state:"SOURCE_RESTRICTED"as const}},{...sourceRow,id:"51c03000-0000-4000-8000-000000000003",source_id:"51c03000-0000-4000-8000-000000000003",source_label:"Synthetic source C",label:"Synthetic source C",source_health:{...health,state:"CONNECTED"as const,last_sequence:130,recovery_required:false}}]:[reviewRow,{...reviewRow,id:tenant,label:"REV-1",delivery_id:null,destination_id:null,destination_label:null,source_label:"Synthetic source B",state:"BLOCKED"as const,review:{issue:"SOURCE_RESTRICTED"as const,reason:"ALTERNATIVE_SOURCE_REQUIRED"as const,reviewer_role:"manager"as const}},{...reviewRow,id:"51c03000-0000-4000-8000-000000000003",label:"REV-0",state:"RESOLVED_WITH_EVIDENCE"as const,review:{issue:"UNKNOWN_DELIVERY"as const,reason:"MATCHING_FAKE_ACK"as const,reviewer_role:"manager"as const}}];
  writeFileSync(`${dir}/${collection}-${locale}.html`,`<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport"content="width=device-width,initial-scale=1"><title>Gold Revenue OS · Synthetic review preview</title><style>${css}</style><body>${render(h(AdminWorkspaceFrame,{locale,tenantName:"SIGNAL · SYNTHETIC TEST",userLabel:"synthetic-operator@example.test",role:"manager"},h(SignalOperationsView,{query:{collection,size:"25"},page:{...page,collection,items,has_more:false,next_cursor:null},summary:null,error:null})))}</body></html>`);
 }
}
