import { T,AdminNumber } from "./admin-i18n";
import type { JobHealth } from "@/lib/entitlements/job-health";
const reasonLabels={RESTRICTED:"Technical details restricted",UNRECORDED:"No tracked effect evidence",UNKNOWN_EFFECT:"External result is unknown",RECLAIM_BUDGET:"Crash recovery budget exhausted",CLAIM_BUDGET:"Lifetime attempt budget exhausted",PROVIDER_FAILURE_BUDGET:"Provider retry budget exhausted",PROVIDER_FAILURE:"Provider failure; retry status is shown above.",REVISION_STALE:"Source revision changed"} as const;
export function EntitlementJobHealth({data}:{data:JobHealth}){
 const uncertain=["UNCERTAIN","UNTRACKED"].includes(data.effect_state)||data.reason==="UNKNOWN_EFFECT";
 return <section className="case-section" aria-labelledby={`health-${data.job_id}`}>
  <h3 id={`health-${data.job_id}`}><T k="Operation evidence"/></h3>
  <p className={data.review_required?"alert":"muted"}><T k={reasonLabels[data.reason]}/></p>
  {data.mode==="test"&&<p className="muted"><T k="TEST diagnostics — no live authority"/></p>}
  {!data.revision_current&&<p><T k="This job is outdated. Inspect the current revision before acting."/></p>}
  {uncertain&&<p><T k="Do not retry an unknown effect. Independent reconciliation is required."/></p>}
  {data.review_required&&!uncertain&&<p><T k="Review is required. No retry or successful access change is authorized here."/></p>}
  {data.obligation!=="NONE"&&<p><T k={data.obligation==="REVOKE"?"Revocation obligation remains open until verified.":"Reconciliation obligation remains open until verified."}/></p>}
  {data.claims!==null&&<details><summary><T k="Recorded TEST attempt budgets"/></summary>
   <p><T k="Lifetime claims"/>: <AdminNumber value={data.claims}/> / 7</p>
   {data.reclaims!==null&&<p><T k="Pre-dispatch recoveries"/>: <AdminNumber value={data.reclaims}/> / 2</p>}
   {data.provider_failures!==null&&<p><T k="Definite provider failures"/>: <AdminNumber value={data.provider_failures}/> / 5</p>}
  </details>}
  {data.lease_state==="EXPIRED"&&<p><T k="Worker lease expired; this does not prove that no effect occurred."/></p>}
 </section>;
}
