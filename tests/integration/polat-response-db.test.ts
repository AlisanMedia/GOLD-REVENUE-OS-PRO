import{execFileSync}from "node:child_process";
import{readFileSync}from "node:fs";
import{describe,it,expect}from "vitest";
import{polatConversationInputSchema,type PolatResponseCommand}from "../../packages/contracts/src/index";
import{runPolatResponseFixture,FakePolatTransport,type PolatFixtureResponseStore}from "../../packages/domain/src/polat-response";
import{polatSalesFixture}from "../../packages/domain/src/polat-sales.fixtures";
const connection=process.env.POLAT_DISPOSABLE_DB_URL;
if(connection){const u=new URL(connection);if(u.hostname!=="127.0.0.1"||u.protocol!=="postgresql:"||!u.port)throw Error("DISPOSABLE_LOCAL_PG17_ONLY");}
const quote=(s:string)=>`'${s.replaceAll("'","''")}'`;
function query(sql:string):unknown{return JSON.parse(execFileSync("psql",[connection!,"-X","-Atq","-v","ON_ERROR_STOP=1","-c",sql],{encoding:"utf8",timeout:8000,maxBuffer:1024*1024}).trim());}
const tid=(n:number)=>`61b02000-0000-4000-8000-${String(n).padStart(12,"0")}`,op=(n:number)=>`61b09000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function load(n:number){return query(`select jsonb_build_object('tenant',m.tenant_id,'conversation',m.conversation_id,'source',m.id,'text',m.content,'occurred',m.occurred_at,'generation',c.generation::text)from public.messages m join private.polat_conversation_controls c on c.tenant_id=m.tenant_id and c.conversation_id=m.conversation_id where m.tenant_id=${quote(tid(n))}and m.direction='inbound'and m.id=c.last_inbound_id limit 1;`)as {tenant:string;conversation:string;source:string;text:string;occurred:string;generation:string};}
function input(n:number){const p=load(n),at=new Date(p.occurred).toISOString();return polatConversationInputSchema.parse({version:1,mode:"SYNTHETIC",tenant_id:p.tenant,conversation_id:p.conversation,customer_id:null,source_message_id:p.source,boundary:at,runtime_mode:"AI_ACTIVE",contactability:"contactable",verified_customer_language:"en",messages:[{id:p.source,tenant_id:p.tenant,conversation_id:p.conversation,direction:"inbound",content:p.text,occurred_at:at,author:"CUSTOMER",delivery:"INBOUND_OBSERVED"}],memory:[],knowledge:[]});}
function store(){const commands:PolatResponseCommand[]=[];const s:PolatFixtureResponseStore={mode:"SYNTHETIC",prepare:c=>{commands.push(c);return Promise.resolve(query(`select private.polat_prepare_fixture(${[c.tenant_id,c.message_id,c.operation_id,c.generation,c.source_hash,c.body_hash,c.actor].map(quote).join(",")});`));},canDispatch:c=>Promise.resolve(query(`select to_jsonb(private.polat_can_dispatch_fixture(${quote(c.tenant_id)},${quote(c.operation_id)},${quote(c.generation)}));`)as boolean),record:r=>Promise.resolve(query(`select to_jsonb(private.polat_outcome_fixture(${quote(r.tenant_id)},${quote(r.operation_id)},${quote(JSON.stringify(r))}));`)),hold:x=>Promise.resolve(query(`select to_jsonb(private.polat_hold_fixture(${[x.tenant_id,x.message_id,x.generation,x.reason].map(quote).join(",")}));`))};return {store:s,commands};}
describe.runIf(Boolean(connection))("actual local PG17 Polat provider→QA→evidence bridge",()=>{
 it("sales preview reaches real PostgreSQL evidence using only fake transport",async()=>{
  expect(query(`select to_jsonb(count(*))from public.tenants where id=${quote(tid(507))};`)).toBe(0);
  const helper=readFileSync("supabase/tests/helpers/polat_inbound_fixtures.sql","utf8");
  execFileSync("psql",[connection!,"-X","-q","-v","ON_ERROR_STOP=1"],{input:`begin;${helper}\nselect pg_temp.polat_setup(507);select public.ingest_telegram_message(${quote(tid(507))},'fixture-sales-507','2','710000507','710000507',null,'Synthetic',null,'What is the price and what is included?',null,clock_timestamp());commit;`,stdio:["pipe","ignore","pipe"],timeout:15000});
  try{const sales=polatSalesFixture();sales.conversation=input(507);expect(sales.conversation.messages.at(-1)?.content).toBe("What is the price and what is included?");sales.catalog=sales.catalog.map(d=>({...d,tenant_id:sales.conversation.tenant_id,conversation_id:sales.conversation.conversation_id}));const f=store(),transport=new FakePolatTransport();
   const r=await runPolatResponseFixture({input:sales.conversation,sales,operationId:op(507),generation:load(507).generation,store:f.store,transport});expect(r.state,JSON.stringify(r.quality)).toBe("AI_RESPONDED");expect(r.quality?.qa.grounding.blocked).toBe(false);expect(transport.effects).toHaveLength(1);
   expect(query(`select to_jsonb(count(*))from private.polat_response_evidence where tenant_id=${quote(tid(507))}and stage='FAKE_ACK';`)).toBe(1);
   expect(query(`select to_jsonb(count(*))from public.messages where tenant_id=${quote(tid(507))}and direction='outbound';`)).toBe(0);
   expect(query(`select to_jsonb(count(*))from private.verified_payment_receipts where tenant_id=${quote(tid(507))};`)).toBe(0);
  }finally{execFileSync("psql",[connection!,"-X","-q","-v","ON_ERROR_STOP=1","-c",`update private.polat_conversation_controls set enabled=false where tenant_id=${quote(tid(507))};update public.tenants set status='suspended'where id=${quote(tid(507))};`],{stdio:"ignore",timeout:8000});}
 },20000);

 it("persists fake ACK, holds payment uncertainty, recovers unknown commit and fences takeover",async()=>{
  expect(query("select to_jsonb(current_setting('server_version_num')::int/10000);")).toBe(17);
  expect(query(`select to_jsonb(count(*))from public.tenants where id in(${[501,502,503,504].map(n=>quote(tid(n))).join(",")});`)).toBe(0);
  const helper=readFileSync("supabase/tests/helpers/polat_inbound_fixtures.sql","utf8");
  execFileSync("psql",[connection!,"-X","-q","-v","ON_ERROR_STOP=1"],{input:`begin;${helper}\nselect pg_temp.polat_setup(501);select pg_temp.polat_setup(502);select pg_temp.polat_setup(503);select pg_temp.polat_setup(504);commit;`,stdio:["pipe","ignore","pipe"],timeout:15000});
  try{
   const one=store(),transport=new FakePolatTransport();const r=await runPolatResponseFixture({input:input(501),operationId:op(501),generation:load(501).generation,store:one.store,transport});
   expect(r.state).toBe("AI_RESPONDED");expect(transport.effects).toHaveLength(1);expect(query(`select to_jsonb(state)from private.polat_inbound_work where tenant_id=${quote(tid(501))};`)).toBe("AI_RESPONDED");
   const two=store(),unknown=new FakePolatTransport(["UNKNOWN_AFTER_EFFECT"]);const lost=await runPolatResponseFixture({input:input(502),operationId:op(502),generation:load(502).generation,store:two.store,transport:unknown});
   expect(lost.state).toBe("DELIVERY_UNKNOWN");expect(unknown.effects).toHaveLength(1);const observed=unknown.observe(two.commands[0]!);expect(observed?.result).toBe("FAKE_ACK");expect(await two.store.record(observed!)).toBe("AI_RESPONDED");
   const three=store(),noResend=new FakePolatTransport();const prepare=three.store.prepare;three.store.prepare=async c=>{await prepare(c);return new Promise(()=>{});};
   const uncertain=await runPolatResponseFixture({input:input(503),operationId:op(503),generation:load(503).generation,store:three.store,transport:noResend,stepTimeoutMs:1});
   expect(uncertain.state).toBe("DELIVERY_UNKNOWN");const retry=store();const again=await runPolatResponseFixture({input:input(503),operationId:op(503),generation:load(503).generation,store:retry.store,transport:noResend});expect(again.state).toBe("DELIVERY_UNKNOWN");expect(noResend.effects).toEqual([]);
   const four=store(),paused=new FakePolatTransport();four.store.canDispatch=async c=>{execFileSync("psql",[connection!,"-X","-q","-v","ON_ERROR_STOP=1","-c",`begin;select set_config('request.jwt.claim.sub','61b01000-0000-4000-8000-000000000001',true);select private.polat_claim_human_fixture(${quote(c.tenant_id)},${quote(c.conversation_id)},${quote(c.generation)});commit;`],{stdio:"ignore",timeout:8000});return false;};
   const taken=await runPolatResponseFixture({input:input(504),operationId:op(504),generation:load(504).generation,store:four.store,transport:paused});expect(taken.state).toBe("HUMAN_HANDOFF_PENDING");expect(paused.effects).toEqual([]);
   expect(query(`select to_jsonb(count(*))from public.messages where tenant_id in(${[501,502,503,504].map(n=>quote(tid(n))).join(",")})and direction='outbound';`)).toBe(0);
   expect(query(`select to_jsonb(count(*))from private.verified_payment_receipts where tenant_id in(${[501,502,503,504].map(n=>quote(tid(n))).join(",")});`)).toBe(0);
  }finally{execFileSync("psql",[connection!,"-X","-q","-v","ON_ERROR_STOP=1","-c",`update private.polat_conversation_controls set enabled=false where tenant_id in(${[501,502,503,504].map(n=>quote(tid(n))).join(",")});update public.tenants set status='suspended'where id in(${[501,502,503,504].map(n=>quote(tid(n))).join(",")});`],{stdio:"ignore",timeout:8000});}
 },30000);
});
