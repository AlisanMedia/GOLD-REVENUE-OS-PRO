import{readFileSync}from "node:fs";
import{beforeAll,describe,it,expect,vi}from "vitest";
import{disposablePolatDatabase,polatSqlClient}from "../helpers/polat-local-database";
import{FakePolatTransport}from "../../packages/domain/src/polat-response";
const fixture=vi.hoisted(()=>({client:null as ReturnType<typeof polatSqlClient>|null}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/supabase/admin",()=>({createSupabaseAdminClient:()=>{if(!fixture.client)throw Error("LOCAL_FIXTURE_ONLY");return fixture.client;}}));
vi.mock("@/lib/agent-runtime/context-builder",()=>import("../../apps/web/src/lib/agent-runtime/context-builder"));
vi.mock("@/lib/agent-runtime/providers/openai-responses",()=>({openAIProviderFromEnvironment:()=>{throw Error("EXTERNAL_MODEL_PROHIBITED");}}));
vi.mock("@/lib/messaging/outbound-dispatch",()=>({dispatchQueuedTelegramMessage:()=>{throw Error("REAL_OUTBOUND_PROHIBITED");}}));
vi.mock("@/lib/polat/test-runtime",()=>import("../../apps/web/src/lib/polat/test-runtime"));
import{runDeterministicWorker}from "../../apps/web/src/lib/agent-runtime/worker";
import{buildAgentContext}from "../../apps/web/src/lib/agent-runtime/context-builder";
const connection=process.env.POLAT_RUNTIME_DB_URL;
const id=(n:number)=>`61b02000-0000-4000-8000-${String(n).padStart(12,"0")}`;
describe.runIf(Boolean(connection))("accepted orchestrator→Polat TEST profile→QA→fake ACK→history",()=>{
 let db:ReturnType<typeof disposablePolatDatabase>;
 beforeAll(()=>{db=disposablePolatDatabase(connection!);expect(db.query("select to_jsonb(current_setting('server_version_num')::int/10000)")).toBe(17);fixture.client=polatSqlClient(db);});
 it("completes two real PostgreSQL turns without a real outbound or repeated AI introduction",async()=>{
  const n=3601,t=id(n);expect(db.query(`select to_jsonb(count(*))from public.tenants where id='${t}'`)).toBe(0);
  db.execute(`begin;${readFileSync('supabase/tests/helpers/polat_inbound_fixtures.sql','utf8')}select pg_temp.polat_setup(${n});select private.polat_configure_runtime_fixture('${t}',pg_temp.polat_conv(${n}));commit;`);
  const c=db.query(`select to_jsonb(conversation_id)from private.polat_runtime_profiles where tenant_id='${t}'`)as string;
  const transport=new FakePolatTransport(['ACK','ACK']);
  try{
   const initialEvent=db.query(`select to_jsonb(id)from public.domain_events where tenant_id='${t}'and event_type='message.received'order by recorded_at desc,id desc limit 1`)as string;
   await buildAgentContext({tenant_id:t,conversation_id:c,customer_id:null,source_event_id:initialEvent},{polatTest:true});
   for(let i=0;i<4;i++)await runDeterministicWorker({workerId:`polat-test-${n}-${i}`,conversation:{tenantId:t,conversationId:c},polatTest:{transport}});
   expect(db.query(`select to_jsonb(state)from private.polat_inbound_work where tenant_id='${t}'order by sequence desc limit 1`)).toBe('AI_RESPONDED');
   expect(transport.effects).toHaveLength(1);
   expect(db.query(`select to_jsonb(body)from private.polat_runtime_drafts where tenant_id='${t}'order by created_at limit 1`)).toContain("Polat's AI assistant");
   db.execute(`select public.ingest_telegram_message('${t}','polat-second','2','710000${n}','710000${n}',null,'Synthetic',null,'Thanks',null,clock_timestamp());`);
   for(let i=0;i<4;i++)await runDeterministicWorker({workerId:`polat-test-${n}-second-${i}`,conversation:{tenantId:t,conversationId:c},polatTest:{transport}});
   expect(transport.effects).toHaveLength(2);
   const last=db.query(`select to_jsonb(body)from private.polat_runtime_drafts where tenant_id='${t}'order by created_at desc,id desc limit 1`)as string;expect(last).toContain("You're welcome");expect(last).not.toContain("Polat's AI assistant");
   const event=db.query(`select to_jsonb(id)from public.domain_events where tenant_id='${t}'and event_type='message.received'order by recorded_at desc,id desc limit 1`)as string;
   const context=await buildAgentContext({tenant_id:t,conversation_id:c,customer_id:null,source_event_id:event},{polatTest:true});expect(context.polat?.input.messages.filter(m=>m.direction==='outbound')).toHaveLength(1);expect(context.manifest.polat_history_basis).toBe('MATCHED_FAKE_ACK_ONLY');
   expect(db.query(`select to_jsonb(count(*))from private.polat_runtime_steps where tenant_id='${t}'and kind='FAKE_ACKNOWLEDGED'`)).toBe(2);
   expect(db.query(`select to_jsonb(count(*))from public.messages where tenant_id='${t}'and direction='outbound'`)).toBe(0);
   expect(db.query(`select to_jsonb(count(*))from public.model_invocations where tenant_id='${t}'and(input_tokens is not null or billed_amount is not null)`)).toBe(0);
   expect(db.query(`select to_jsonb(count(*))from public.agent_runs where tenant_id='${t}'and model_name='polat-test-runtime-v1'and total_tokens is not null`)).toBe(0);
  }finally{db.execute(`update private.polat_runtime_profiles set enabled=false where tenant_id='${t}';update private.polat_conversation_controls set enabled=false where tenant_id='${t}';update public.tenants set status='suspended'where id='${t}';`);}
 },60000);
 function setup(n:number){const t=id(n);db.execute(`begin;${readFileSync('supabase/tests/helpers/polat_inbound_fixtures.sql','utf8')}select pg_temp.polat_setup(${n});select private.polat_configure_runtime_fixture('${t}',pg_temp.polat_conv(${n}));commit;`);const c=db.query(`select to_jsonb(conversation_id)from private.polat_runtime_profiles where tenant_id='${t}'`)as string;return{t,c};}
 function retire(t:string){db.execute(`update private.polat_runtime_profiles set enabled=false where tenant_id='${t}';update private.polat_conversation_controls set enabled=false where tenant_id='${t}';update public.tenants set status='suspended'where id='${t}';`);}
 async function cycle(t:string,c:string,transport:FakePolatTransport,n=4){for(let i=0;i<n;i++)await runDeterministicWorker({workerId:`runtime-fixture-${t.slice(-4)}-${i}`,conversation:{tenantId:t,conversationId:c},polatTest:{transport}});}
 it("keeps an unknown effect out of history, then reconciles independent fake evidence without resending",async()=>{
  const{t,c}=setup(3602),transport=new FakePolatTransport(['UNKNOWN_AFTER_EFFECT']);try{
   await cycle(t,c,transport,1);expect(db.query(`select to_jsonb(state)from private.polat_inbound_work where tenant_id='${t}'`)).toBe('DELIVERY_UNKNOWN');expect(transport.effects).toHaveLength(1);
   expect(db.query(`select to_jsonb(count(*))from private.polat_runtime_steps where tenant_id='${t}'and kind='FAKE_ACKNOWLEDGED'`)).toBe(0);
   await cycle(t,c,transport,1);expect(db.query(`select to_jsonb(state)from private.polat_inbound_work where tenant_id='${t}'`)).toBe('AI_RESPONDED');expect(transport.effects).toHaveLength(1);
   await cycle(t,c,transport,1);expect(transport.effects).toHaveLength(1);
   expect(db.query(`select to_jsonb(count(*))from private.polat_runtime_steps where tenant_id='${t}'and kind='FAKE_ACKNOWLEDGED'`)).toBe(1);
  }finally{retire(t);}
 },60000);
 it("does not invent an ACK after a fake ledger is unavailable",async()=>{
  const{t,c}=setup(3603),original=new FakePolatTransport(['UNKNOWN_AFTER_EFFECT']);try{
   await cycle(t,c,original,1);const restarted=new FakePolatTransport(['ACK']);await cycle(t,c,restarted,1);
   expect(restarted.effects).toHaveLength(0);expect(db.query(`select to_jsonb(state)from private.polat_inbound_work where tenant_id='${t}'`)).toBe('DELIVERY_UNKNOWN');
  }finally{retire(t);}
 },60000);
 it("pauses for acknowledged human control and resumes only a new inbound",async()=>{
  const{t,c}=setup(3604),transport=new FakePolatTransport(['ACK','ACK']);try{
   await cycle(t,c,transport,1);
   db.execute(`select public.ingest_telegram_message('${t}','takeover-inbound','2','7100003604','7100003604',null,'Synthetic',null,'Hello',null,clock_timestamp());begin;select set_config('request.jwt.claim.sub','61b01000-0000-4000-8000-000000000001',true);select private.polat_claim_human_fixture('${t}','${c}',(select generation from private.polat_conversation_controls where tenant_id='${t}'));commit;`);
   await cycle(t,c,transport,1);expect(transport.effects).toHaveLength(1);expect(db.query(`select to_jsonb(state)from private.polat_inbound_work where tenant_id='${t}'order by sequence desc limit 1`)).toBe('HUMAN_OWNED');
   db.execute(`begin;select set_config('request.jwt.claim.sub','61b01000-0000-4000-8000-000000000001',true);select public.set_conversation_runtime_mode('${t}','${c}','AI_ACTIVE','Synthetic resume',extensions.gen_random_uuid());commit;`);
   await cycle(t,c,transport,2);expect(transport.effects).toHaveLength(1);
   db.execute(`select public.ingest_telegram_message('${t}','resume-inbound','3','7100003604','7100003604',null,'Synthetic',null,'Thanks',null,clock_timestamp());`);
   await cycle(t,c,transport,3);expect(transport.effects).toHaveLength(2);
  }finally{retire(t);}
 },60000);
 it("holds a fixture timeout with an owned obligation and unknown billing",async()=>{
  const{t,c}=setup(3605),transport=new FakePolatTransport(['ACK']);try{
   await cycle(t,c,transport,1);db.execute(`select public.ingest_telegram_message('${t}','timeout-inbound','2','7100003605','7100003605',null,'Synthetic',null,'__SIMULATE_TIMEOUT__',null,clock_timestamp());`);
   await cycle(t,c,transport,2);expect(transport.effects).toHaveLength(1);expect(db.query(`select to_jsonb(state)from private.polat_inbound_work where tenant_id='${t}'order by sequence desc limit 1`)).toBe('HUMAN_HANDOFF_PENDING');
   expect(db.query(`select to_jsonb(count(*))from public.model_invocations where tenant_id='${t}'and status='TIMED_OUT'`)).toBe(1);
   expect(db.query(`select to_jsonb(count(*))from public.model_invocations where tenant_id='${t}'and billed_amount is not null`)).toBe(0);
  }finally{retire(t);}
 },60000);

});
