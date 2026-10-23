import { execFileSync } from "node:child_process";
import { afterAll,beforeAll,describe,it,expect } from "vitest";
import { FakeSignalSource, normalizeSignal } from "../../packages/domain/src/signals";
import { FakeSignalTransport,dispatchSyntheticSignalWakeup,reconcileSyntheticSignal,type SignalFixtureStore } from "../../packages/domain/src/signal-distribution";
import type { SignalSourceEvent,SignalTransportResult } from "../../packages/contracts/src/index";
const url=process.env.SIGNAL_DISPOSABLE_DB_URL;
const quote=(s:string)=>"'"+s.replaceAll("'","''")+"'";
function sql(statement:string):string{
 const parsed=new URL(url!);if(parsed.protocol!=="postgresql:"||parsed.hostname!=="127.0.0.1"||!/^\/[a-zA-Z0-9_]+$/u.test(parsed.pathname))throw Error("SIGNAL_LOCAL_PG17_REQUIRED");
 try{return execFileSync(process.env.SIGNAL_PSQL_BIN??"psql",[url!,"-X","-qAt","-v","ON_ERROR_STOP=1"],{input:statement,encoding:"utf8",stdio:["pipe","pipe","pipe"],timeout:20000}).trim();}catch{throw Error("SIGNAL_LOCAL_SQL_FAILED");}
}
function json(statement:string):unknown{return JSON.parse(sql(statement).split("\n").at(-1)!) as unknown;}
const id=(n:number,kind:string)=>`51b1${kind}-0000-4000-8000-${String(n).padStart(12,"0")}`;
const owned=new Set<number>();
function setup(n:number){sql(`begin;insert into public.tenants(id,name,slug) values(${quote(id(n,"2000"))},'Synthetic bridge','signal-sandbox-bridge-${n}');select private.signal_fixture_configure_v1(${quote(id(n,"2000"))},${quote(id(n,"4000"))},${quote(id(n,"3000"))},${quote(id(n,"5000"))},${quote(id(n,"6000"))},'Synthetic bridge','fixture:bridge-source-${n}','fixture:bridge-destination-${n}',true);commit;`);owned.add(n);}
function source(n:number,key="one",revision=1,kind:SignalSourceEvent["kind"]="MESSAGE"):SignalSourceEvent{return {version:1,mode:"SYNTHETIC",tenant_id:id(n,"2000"),source_id:id(n,"3000"),message_key:key,revision,kind,observed_at:new Date().toISOString(),published_at:null,reply_to:null,original_text:kind==="DELETE"?null:"BUY XAUUSD LIMIT 2700.010 SL 2690.000 TP 2720.10",attachments:[],interpretation:kind==="DELETE"?null:{action:"OPEN",direction:"BUY",symbol:"XAUUSD",order_type:"LIMIT",entry:["2700.010"],stop_loss:"2690.000",take_profits:["2720.10"]}};}
function record(e:SignalSourceEvent){return json(`select private.signal_record_fixture_v1(${quote(normalizeSignal(e).canonical)});`);}
const finish=(t:string,j:string,token:string|null,r:SignalTransportResult,reconcile=false)=>json(`select private.signal_finish_fixture_v1(${quote(t)},${quote(j)},${token===null?"null":quote(token)},${quote(JSON.stringify(r))},${reconcile});`);
const store:SignalFixtureStore={mode:"SYNTHETIC",claim:t=>Promise.resolve(json(`select private.signal_claim_fixture_v1(${quote(t)});`)),begin:(t,j,k)=>Promise.resolve(json(`select private.signal_begin_fixture_v1(${quote(t)},${quote(j)},${quote(k)});`)),finish:(t,j,k,r)=>Promise.resolve(finish(t,j,k,r)),reconcile:(t,j,r)=>Promise.resolve(finish(t,j,null,r,true))};

// Application intentionally has no DB. Database CI executes these same tests
// with its disposable PG17 and separate committed psql calls for every boundary.
describe.runIf(Boolean(url))("actual v1 signal contracts → PostgreSQL → fake transport",()=>{
 beforeAll(()=>{expect(sql("select current_setting('server_version_num')::int/10000")).toBe("17");});
 afterAll(()=>{if(owned.size){const ids=[...owned].map(n=>quote(id(n,"2000"))).join(",");sql(`begin;update private.signal_controls set enabled=false where tenant_id in (${ids});update public.tenants set status='suspended' where id in (${ids});commit;`);}});
 it("matches canonical hashes and atomically routes multiple source channels",async()=>{
  setup(1);sql(`select private.signal_fixture_configure_v1(${quote(id(1,"2000"))},${quote(id(1,"4000"))},${quote(id(1,"3001"))},${quote(id(1,"5000"))},${quote(id(1,"6001"))},'Second source','fixture:bridge-second-source','fixture:bridge-destination-1',true);`);
  const a=source(1),b={...source(1,"second"),source_id:id(1,"3001")};record(a);record(b);
  expect(sql(`select fact_hash from private.signal_events where tenant_id=${quote(a.tenant_id)} and source_id=${quote(a.source_id)};`)).toBe(normalizeSignal(a).fact_hash);
  const transport=new FakeSignalTransport(),r=await dispatchSyntheticSignalWakeup({tenantId:a.tenant_id,store,transport});expect(r.confirmed).toBe(2);expect(transport.effects).toHaveLength(2);
  record({...a,observed_at:new Date().toISOString()});expect((await dispatchSyntheticSignalWakeup({tenantId:a.tenant_id,store,transport})).confirmed).toBe(0);
  expect(sql(`select count(*) from private.signal_deliveries where tenant_id=${quote(a.tenant_id)};`)).toBe("2");
 });
 it("preserves original text through actual committed edit/delete bindings",async()=>{
  setup(2);const t=id(2,"2000"),f=new FakeSignalTransport();record(source(2));await dispatchSyntheticSignalWakeup({tenantId:t,store,transport:f});
  const edit=source(2,"one",2,"EDIT");edit.original_text="SL 2700.010 — source update";record(edit);expect((await dispatchSyntheticSignalWakeup({tenantId:t,store,transport:f})).confirmed).toBe(1);
  const ref=sql(`select message_ref from private.signal_message_bindings where tenant_id=${quote(t)};`);expect(f.inspectMessage(ref)?.text).toBe(edit.original_text);
  record(source(2,"one",3,"DELETE"));expect((await dispatchSyntheticSignalWakeup({tenantId:t,store,transport:f})).confirmed).toBe(1);expect(f.inspectMessage(ref)).toBeNull();expect(f.effects.map(e=>e.operation)).toEqual(["SEND","EDIT","DELETE"]);
 });
 it("reconciles an unknown committed fake effect without sending twice",async()=>{
  setup(3);const t=id(3,"2000"),f=new FakeSignalTransport([{outcome:"UNKNOWN_AFTER_EFFECT"}]);record(source(3));const r=await dispatchSyntheticSignalWakeup({tenantId:t,store,transport:f});expect(r.unknown).toBe(1);expect(f.effects).toHaveLength(1);
  expect((await dispatchSyntheticSignalWakeup({tenantId:t,store,transport:f})).confirmed).toBe(0);expect(f.effects).toHaveLength(1);
  const deliveryId=sql(`select id from private.signal_deliveries where tenant_id=${quote(t)};`);
  const operationKey=sql(`select operation_key from private.signal_attempts where tenant_id=${quote(t)};`);
  await reconcileSyntheticSignal({tenantId:t,deliveryId,operationKey,store,transport:f});expect(sql(`select status from private.signal_deliveries where tenant_id=${quote(t)};`)).toBe("FAKE_CONFIRMED");
  expect(sql(`select count(*) from private.signal_delivery_history where tenant_id=${quote(t)} and code='UNKNOWN_EFFECT';`)).toBe("1");expect(f.effects).toHaveLength(1);
 });
 it("resumes a committed source batch by durable offset without replaying effects",async()=>{
  setup(5);const t=id(5,"2000"),events=[source(5,"a"),source(5,"b")],adapter=new FakeSignalSource(events),collected:SignalSourceEvent[]=[];
  for await(const value of adapter.events({sourceId:id(5,"3000"),afterOffset:0,limit:2,signal:new AbortController().signal}))collected.push(value.event);
  const array="array["+collected.map(e=>quote(normalizeSignal(e).canonical)).join(",")+"]";
  const command=`select private.signal_record_fixture_batch_v1(${quote(t)},${quote(id(5,"3000"))},0,2,${array})->>'replay';`;
  expect(sql(command)).toBe("false");expect(sql(command)).toBe("true");
  const f=new FakeSignalTransport();expect((await dispatchSyntheticSignalWakeup({tenantId:t,store,transport:f})).confirmed).toBe(2);
  const offset=Number(sql(`select fixture_offset from private.signal_sources where id=${quote(id(5,"3000"))};`));
  let recovered=0;for await(const value of new FakeSignalSource(events).events({sourceId:id(5,"3000"),afterOffset:offset,limit:2,signal:new AbortController().signal})){void value;recovered++;}
  expect(recovered).toBe(0);expect(f.effects).toHaveLength(2);
 });
 it("isolates tenants and retains financial/access safety",async()=>{
  setup(4);const event=source(4),f=new FakeSignalTransport();record(event);const r=await dispatchSyntheticSignalWakeup({tenantId:event.tenant_id,store,transport:f});expect(r).toMatchObject({classification:"SYNTHETIC",financial_authority:"NONE",live_delivery:false});
  expect(sql(`select count(*) from public.subscriptions where tenant_id=${quote(event.tenant_id)};`)).toBe("0");expect(sql(`select count(*) from private.verified_payment_receipts where tenant_id=${quote(event.tenant_id)};`)).toBe("0");expect(sql(`select count(*) from public.channel_access where tenant_id=${quote(event.tenant_id)};`)).toBe("0");
 });
});
