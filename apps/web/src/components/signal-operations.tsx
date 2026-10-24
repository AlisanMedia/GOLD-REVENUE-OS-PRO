"use client";
import Link from "next/link";
import { AdminDate,AdminDuration,AdminNumber,T,useAdminI18n } from "./admin-i18n";
import { signalCollections,signalHref,signalStatuses,type SignalPage,type SignalRow,type SignalSearch,type SignalSummary } from "../lib/signals/read-model";
function State({row}:{row:SignalRow}){return <span className={`badge ${["UNKNOWN","REVIEW","SOURCE_RESTRICTED","OPEN","BLOCKED"].includes(row.state)?"warning":""}`}><T k={`signal.${row.state}`}/></span>;}
function SourceHealth({row:r}:{row:SignalRow}){
 const{t}=useAdminI18n();const h=r.source_health;if(!h)return null;
 return <section className="case-section" aria-label={t("signal.sourceHealth")}><h3><T k="signal.sourceHealth"/></h3><p><T k={`signal.health.${h.state}`}/></p>
  {(h.recovery_required||["GAP_DETECTED","RECOVERING","UNRECOVERABLE","LIMITED","BLOCKED","CONFLICT"].includes(h.state))&&<p className="signal-warning"><T k="signal.recoveryHelp"/></p>}
  {!h.fresh&&<p className="muted"><T k="signal.staleHealth"/></p>}
  {h.last_activity_at&&<p className="muted"><T k="signal.lastSourceActivity"/> · <AdminDate value={h.last_activity_at}/></p>}
  <details><summary><T k="signal.checkpoint"/></summary><dl className="signal-evidence"><dt><T k="signal.processedSequence"/></dt><dd><AdminNumber value={h.last_sequence}/></dd><dt><T k="signal.verifiedHead"/></dt><dd>{h.recovery_target===null?<T k="signal.unknownHead"/>:<AdminNumber value={h.recovery_target}/>}</dd><dt><T k="signal.recoveryFailures"/></dt><dd><AdminNumber value={h.recovery_attempts}/></dd></dl></details>
 </section>;
}
function RecordCard({row:r}:{row:SignalRow}){
 return <article className="detail-card signal-record"><div className="card-heading"><h2>{r.review?<T k={`signal.issue.${r.review.issue}`}/>:r.label}</h2><State row={r}/></div>
  {(r.source_label||r.destination_label)&&<p className="signal-route">{r.source_label}{r.source_label&&r.destination_label?" → ":""}{r.destination_label}</p>}
  {r.provider_label&&r.kind!=="PROVIDER"&&<p className="muted"><T k="signal.providers"/> · {r.provider_label}</p>}
  {r.authorization&&<p><T k={`signal.${r.authorization}`}/></p>}
  {r.state==="UNKNOWN"&&<p className="signal-warning" role="note"><T k="signal.unknownHelp"/></p>}
  {(r.state==="SOURCE_RESTRICTED"||r.code==="SOURCE_RESTRICTED")&&<p className="signal-warning"><T k="signal.restrictedHelp"/></p>}
  {(r.parse_state==="UNCERTAIN"||r.code==="PARSE_UNCERTAIN")&&<p className="signal-warning"><T k="signal.parseHelp"/></p>}
  {r.source_health&&<SourceHealth row={r}/>}
  {r.review&&<section className="case-section"><p className="muted">{r.label}</p><h3><T k="signal.reviewEvidence"/></h3><p><T k={`signal.reason.${r.review.reason}`}/></p><p className="muted"><T k="signal.reviewer"/> · <T k={`signal.reviewer.${r.review.reviewer_role}`}/></p><p className="muted"><T k="signal.reviewOnly"/></p></section>}
  {r.lease_expired&&<p className="signal-warning"role="note"><T k="signal.leaseExpiredHelp"/></p>}
  {r.current===false&&<p className="muted"><T k="signal.oldRevision"/></p>}
  {r.code&&<p><T k={`signal.${r.code}`}/></p>}
  {r.observed_at&&!(r.kind==="SOURCE"&&r.source_health)&&<p className="muted"><T k="signal.observed"/> · <AdminDate value={r.observed_at}/></p>}
  {r.acknowledged_at&&<p><T k="signal.lastAck"/> · <AdminDate value={r.acknowledged_at}/></p>}
  <div className="signal-links">
   {r.kind==="PROVIDER"&&<><Link href={signalHref({collection:"sources",provider:r.id})}><T k="signal.sources"/> →</Link><Link href={signalHref({collection:"routes",provider:r.id})}><T k="signal.routes"/> →</Link></>}
   {r.kind==="SOURCE"&&<><Link href={signalHref({collection:"events",source:r.id})}><T k="signal.events"/> →</Link><Link href={signalHref({collection:"reviews",source:r.id})}><T k="signal.reviews"/> →</Link><Link href={signalHref({collection:"deliveries",source:r.id})}><T k="signal.deliveries"/> →</Link></>}
   {r.kind==="DESTINATION"&&<Link href={signalHref({collection:"deliveries",destination:r.id})}><T k="signal.deliveries"/> →</Link>}
   {r.kind==="ROUTE"&&<Link href={signalHref({collection:"deliveries",source:r.source_id!,destination:r.destination_id!})}><T k="signal.deliveries"/> →</Link>}
   {r.kind==="HISTORY"&&r.delivery_id&&<Link href={signalHref({collection:"deliveries",delivery:r.delivery_id})}><T k="signal.deliveries"/> →</Link>}
   {(r.kind==="DELIVERY"||r.kind==="REVIEW")&&r.delivery_id&&<Link href={signalHref({collection:"reviews",delivery:r.delivery_id})}><T k="signal.reviews"/> →</Link>}
   {r.kind==="REVIEW"&&r.source_id&&<Link href={signalHref({collection:"sources",source:r.source_id})}><T k="signal.sources"/> →</Link>}
   {r.kind==="DELIVERY"&&<Link href={signalHref({collection:"history",delivery:r.id})}><T k="signal.history"/> →</Link>}
  </div>
  <details><summary><T k="signal.details"/></summary><dl className="signal-evidence">
   <dt><T k="signal.revision"/></dt><dd>{r.revision??"—"}</dd>
   <dt><T k="signal.recorded"/></dt><dd><AdminDate value={r.recorded_at}/></dd>
   {r.kind==="SOURCE"&&r.source_health&&r.observed_at&&<><dt><T k="signal.observed"/></dt><dd><AdminDate value={r.observed_at}/></dd></>}
   {r.published_at&&<><dt><T k="signal.published"/></dt><dd><AdminDate value={r.published_at}/></dd></>}
   {r.available_at&&<><dt><T k="signal.nextAttempt"/></dt><dd><AdminDate value={r.available_at}/></dd></>}
   {r.claims!==null&&<><dt><T k="signal.claims"/></dt><dd>{r.claims} / {r.reclaims??"—"} / {r.failures??"—"}</dd></>}
   <dt><T k="signal.history"/></dt><dd><code>{r.id}</code></dd>
  </dl>{r.signal&&<div><p className="muted"><T k="signal.structure"/></p><p><code>{[r.signal.action,r.signal.direction,r.signal.symbol,r.signal.order_type].filter(Boolean).join(" · ")}</code></p><dl className="signal-evidence"><dt><T k="signal.entry"/></dt><dd><code>{r.signal.entry.join(" – ")||"—"}</code></dd><dt><T k="signal.sl"/></dt><dd><code>{r.signal.stop_loss??"—"}</code></dd><dt><T k="signal.tp"/></dt><dd><code>{r.signal.take_profits.join(" · ")||"—"}</code></dd></dl></div>}</details>
 </article>;
}
function Summary({data:d}:{data:SignalSummary}){
 const {locale}=useAdminI18n();const count=(states:readonly string[])=>{const a=d.counts.filter(r=>states.includes(r.status));return {n:a.reduce((s,r)=>s+r.value,0),cap:a.some(r=>!r.complete)};};
 const metrics=[{key:"signal.queue",states:["PENDING","RETRY","RUNNING"],filter:"PENDING"},{key:"signal.unknown",states:["UNKNOWN"],filter:"UNKNOWN"},{key:"signal.review",states:["REVIEW"],filter:"REVIEW"},{key:"signal.ack",states:["FAKE_CONFIRMED"],filter:"FAKE_CONFIRMED"}] as const;
 const percentile=[{name:"p50",value:d.latency.p50_ms},{name:"p95",value:d.latency.p95_ms},{name:"p99",value:d.latency.p99_ms},{name:"max",value:d.latency.max_ms}];
 return <><p className="muted"><T k={d.enabled?"signal.enabled":"signal.disabled"}/> · <AdminDate value={d.observed_at}/></p>{d.oldest_pending_at&&<p><T k="signal.oldest"/> · <AdminDate value={d.oldest_pending_at}/> · <AdminDuration seconds={Math.max(0,(Date.parse(d.observed_at)-Date.parse(d.oldest_pending_at))/1000)}/></p>}<section className="metric-grid signal-metrics">{metrics.map(m=>{const c=count(m.states);return <article className="metric-card" key={m.key}><h2><T k={m.key}/></h2><strong><AdminNumber value={c.n}/>{c.cap?"+":""}</strong><Link href={signalHref({collection:"deliveries",status:m.filter})}><T k="signal.deliveries"/> →</Link></article>;})}</section><p className="muted"><T k="signal.countBound"/></p>
  <section className="detail-card case-section" aria-labelledby="signal-latency-title"><h2 id="signal-latency-title"><T k="signal.latency"/></h2><p className="muted"><T k="signal.latencyBasis"/></p>
   <p><T k="signal.sample"/>: <AdminNumber value={d.latency.valid}/> / <AdminNumber value={d.latency.sampled}/></p>
   {!d.latency.valid?<p className="empty-state"><T k="signal.noLatency"/></p>:<dl className="signal-latencies">{percentile.map(p=><div key={p.name}><dt>{p.name}</dt><dd>{p.value===null?"—":new Intl.NumberFormat(locale,{maximumFractionDigits:3}).format(p.value)+" ms"}<span className="signal-bar" aria-hidden="true" style={{width:`${Math.max(1,(p.value??0)/Math.max(d.latency.max_ms??1,1)*100)}%`}}/></dd></div>)}</dl>}
   {d.latency.last_ack_at&&<p className="muted"><T k="signal.lastAck"/> · <AdminDate value={d.latency.last_ack_at}/></p>}
  </section></>;
}
export function SignalOperationsView({query:q,page,summary,error,summaryError=false}:{query:SignalSearch;page:SignalPage|null;summary:SignalSummary|null;error:"cursor"|"unavailable"|null;summaryError?:boolean}){
 const {t}=useAdminI18n();const {cursor:_cursor,...first}=q;void _cursor;
 return <main className="admin-main signal-operations"><div className="page-heading"><h1><T k="Signal operations"/></h1><p className="muted"><T k="signal.subtitle"/></p></div><p className="signal-boundary" role="note"><T k="signal.boundary"/></p>
  {summary?<Summary data={summary}/>:summaryError&&<p role="status"><T k="signal.summaryError"/></p>}
  <nav className="signal-tabs" aria-label={t("Signal operations")}>{signalCollections.filter(c=>c!=="history"||q.delivery).map(c=><Link key={c} aria-current={q.collection===c?"page":undefined} href={signalHref({collection:c,...(c==="history"&&q.delivery?{delivery:q.delivery}:{})})}><T k={`signal.${c}`}/></Link>)}</nav>
  <form className="signal-filters" method="get" action="/admin/signals" aria-label={t("signal.filter")}><input type="hidden" name="collection" value={q.collection}/>{(["provider","source","destination","delivery"] as const).map(k=>q[k]?<input key={k} type="hidden" name={k} value={q[k]}/>:null)}
   {q.collection==="deliveries"&&<label><T k="signal.status"/><select name="status" defaultValue={q.status??""}><option value=""><T k="signal.all"/></option>{signalStatuses.map(s=><option key={s} value={s}>{t(`signal.${s}`)}</option>)}</select></label>}
   <label><T k="signal.pageSize"/><select name="size" defaultValue={q.size}>{["25","50","100"].map(n=><option value={n} key={n}>{n}</option>)}</select></label><button type="submit"><T k="signal.apply"/></button><Link href={signalHref({collection:q.collection==="history"?"deliveries":q.collection})}><T k="signal.clear"/></Link>
  </form>
  {(q.provider||q.source||q.destination||q.delivery)&&<p className="muted"><T k="signal.filtered"/> · {page?.items[0]?.source_label??page?.items[0]?.destination_label??page?.items[0]?.provider_label??t("signal.history")}</p>}
  {error?<section className="detail-card" role="alert"><p><T k={error==="cursor"?"signal.cursorError":"signal.unavailable"}/></p><Link href={signalHref(first)}><T k="signal.refresh"/></Link></section>:page&&<>
   <section className="signal-records" aria-label={t(`signal.${q.collection}`)}>{page.items.map(r=><RecordCard key={r.id} row={r}/>)}{!page.items.length&&<p className="empty-state"><T k="signal.empty"/></p>}</section>
   <p className="muted"><T k="signal.consistency"/></p><nav className="pagination signal-pagination" aria-label={t("signal.filter")}><Link href={signalHref(first)}><T k="signal.refresh"/></Link><span role="status"><AdminNumber value={page.items.length}/> · <T k={page.has_more?"signal.more":"signal.end"}/></span>{page.has_more&&page.next_cursor&&<Link href={signalHref({...first,cursor:page.next_cursor})}><T k="signal.next"/> →</Link>}</nav>
  </>}
  <p className="muted"><T k="signal.noHealth"/></p>
 </main>;
}
