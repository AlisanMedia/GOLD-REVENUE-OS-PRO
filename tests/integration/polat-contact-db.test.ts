import{beforeAll,describe,expect,it,vi}from "vitest";
import{readFileSync}from "node:fs";
import{disposablePolatDatabase,polatSqlClient}from "../helpers/polat-local-database";
import{FakePolatTransport}from "../../packages/domain/src/index";
const fixture=vi.hoisted(()=>({client:null as unknown as ReturnType<typeof polatSqlClient>}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/supabase/admin',()=>({createSupabaseAdminClient:()=>fixture.client}));
vi.mock('@/lib/agent-runtime/context-builder',()=>import('../../apps/web/src/lib/agent-runtime/context-builder'));
vi.mock('@/lib/agent-runtime/providers/openai-responses',()=>({openAIProviderFromEnvironment:()=>{throw Error('EXTERNAL_MODEL_PROHIBITED');}}));
vi.mock('@/lib/messaging/outbound-dispatch',()=>({dispatchQueuedTelegramMessage:()=>{throw Error('REAL_OUTBOUND_PROHIBITED');}}));
vi.mock('@/lib/polat/test-runtime',()=>import('../../apps/web/src/lib/polat/test-runtime'));
import{runDeterministicWorker}from '../../apps/web/src/lib/agent-runtime/worker';
const connection=process.env.POLAT_RUNTIME_DB_URL;
const id=(n:number)=>`61b02000-0000-4000-8000-${String(n).padStart(12,'0')}`;
describe.runIf(Boolean(connection))('contact evidence against the actual native worker + local PG17',()=>{
 let db:ReturnType<typeof disposablePolatDatabase>;
 beforeAll(()=>{db=disposablePolatDatabase(connection!);expect(db.query("select to_jsonb(current_setting('server_version_num')::int/10000)")).toBe(17);});
 function setup(n:number,scope='REQUESTED_SUPPORT_FIXTURE'){
  const helpers=readFileSync('supabase/tests/helpers/polat_contact_fixtures.sql','utf8').replace('\\ir polat_inbound_fixtures.sql',()=>readFileSync('supabase/tests/helpers/polat_inbound_fixtures.sql','utf8'));
  const t=id(n);db.execute(`begin;${helpers}select pg_temp.polat_contact_setup(${n},'${scope}');commit;`);fixture.client=polatSqlClient(db);
  return{t,c:db.query(`select to_jsonb(conversation_id)from private.polat_runtime_profiles where tenant_id='${t}'`)as string};
 }
 function retire(t:string){db.execute(`update private.polat_runtime_profiles set enabled=false where tenant_id='${t}';update private.polat_conversation_controls set enabled=false where tenant_id='${t}';update public.tenants set status='suspended'where id='${t}';`);}
 async function cycle(t:string,c:string,transport:FakePolatTransport){return runDeterministicWorker({workerId:'contact-fixture-'+t.slice(-4),conversation:{tenantId:t,conversationId:c},polatTest:{transport}});}
 function optOut(n:number,t:string,c:string){db.execute(`select public.ingest_telegram_message('${t}','contact-race-${n}','2','710000${n}','710000${n}',null,'Synthetic',null,'Do not send marketing messages',null,clock_timestamp());select public.polat_test_contact_for_source_v1('${t}','${c}',(select e.id from public.domain_events e join private.polat_conversation_controls x on x.tenant_id=e.tenant_id and x.last_inbound_id::text=e.payload->>'message_id'where e.tenant_id='${t}'and e.event_type='message.received'limit 1));`);}
 it('unknown lawful scope creates review instead of a reply',async()=>{const{t,c}=setup(4701,'UNKNOWN'),transport=new FakePolatTransport(['ACK']);try{await cycle(t,c,transport);expect(transport.effects).toHaveLength(0);expect(db.query(`select to_jsonb(state)from private.polat_inbound_work where tenant_id='${t}'`)).toBe('HUMAN_HANDOFF_PENDING');}finally{retire(t);}},60000);
 it('committed opt-out between preparation and final guard prevents an effect',async()=>{
  const n=4702,{t,c}=setup(n),transport=new FakePolatTransport(['ACK']),base=fixture.client;let injected=false;
  fixture.client={...base,rpc:async(name,args)=>{const result=await base.rpc(name,args);if(name==='polat_test_contact_ticket_v1'&&!injected){injected=true;optOut(n,t,c);}return result;}};
  try{await cycle(t,c,transport);expect(injected).toBe(true);expect(transport.effects).toHaveLength(0);expect(db.query(`select to_jsonb(count(*))from private.polat_contact_evidence where tenant_id='${t}'and kind='OPT_OUT_RECORDED'`)).toBe(1);expect(db.query(`select to_jsonb(count(*))from private.polat_response_evidence where tenant_id='${t}'and stage='FAKE_ACK'`)).toBe(0);}finally{retire(t);}
 },60000);
 it('opt-out after fake effect preserves receipt but rejects current-authority success',async()=>{
  const n=4703,{t,c}=setup(n),transport=new FakePolatTransport(['ACK']),base=fixture.client;let injected=false;
  fixture.client={...base,rpc:async(name,args)=>{if(name==='polat_test_runtime_receipt_v1'&&!injected){injected=true;optOut(n,t,c);}return base.rpc(name,args);}};
  try{await cycle(t,c,transport);expect(transport.effects).toHaveLength(1);expect(db.query(`select to_jsonb(count(*))from private.polat_response_evidence where tenant_id='${t}'and stage='FAKE_ACK'`)).toBe(1);expect(db.query(`select to_jsonb(state)from private.polat_inbound_work where tenant_id='${t}'order by sequence limit 1`)).toBe('DELIVERY_UNKNOWN');expect(db.query(`select to_jsonb(count(*))from private.polat_inbound_work where tenant_id='${t}'and responded_at is not null`)).toBe(0);}finally{retire(t);}
 },60000);
 it('unavailable source persistence never fabricates a saved operation',async()=>{
  const{t,c}=setup(4704),transport=new FakePolatTransport(['ACK']),base=fixture.client;
  fixture.client={...base,rpc:async(name,args)=>name==='polat_test_contact_for_source_v1'?{data:null,error:{code:'FIXTURE_STORAGE_UNAVAILABLE'}}:base.rpc(name,args)};
  try{await cycle(t,c,transport);expect(transport.effects).toHaveLength(0);expect(db.query(`select to_jsonb(count(*))from private.polat_contact_evidence where tenant_id='${t}'and kind='OPT_OUT_RECORDED'`)).toBe(0);expect(db.query(`select to_jsonb(state)from private.polat_inbound_work where tenant_id='${t}'`)).toBe('HUMAN_HANDOFF_PENDING');}finally{retire(t);}
 },60000);
 it('applies the fixture marketing reservation cap while requested support remains separate',async()=>{
  const n=4705,{t,c}=setup(n,'MARKETING_FIXTURE'),transport=new FakePolatTransport(['ACK','ACK']),base=fixture.client;
  db.execute(`begin;select set_config('request.jwt.claim.sub','61b01000-0000-4000-8000-000000000001',true);select private.polat_contact_record_fixture('${t}','${c}',jsonb_build_object('version',1,'mode','SYNTHETIC','evidence_id',extensions.gen_random_uuid(),'tenant_id','${t}','conversation_id','${c}','expected_revision','1','expected_generation',(select generation::text from private.polat_conversation_controls where tenant_id='${t}'),'source_message_id',null,'kind','MARKETING_GRANTED','payload',jsonb_build_object('expires_at',clock_timestamp()+interval '1 day','timezone','UTC','window_start',0,'window_end',24))::text);commit;`);
  fixture.client={...base,rpc:async(name,args)=>base.rpc(name,name==='polat_test_contact_ticket_v1'?{...args,purpose_value:'MARKETING'}:args)};
  try{await cycle(t,c,transport);expect(transport.effects).toHaveLength(1);db.execute(`select public.ingest_telegram_message('${t}','cap-second','2','710000${n}','710000${n}',null,'Synthetic',null,'Thanks',null,clock_timestamp());`);for(let i=0;i<3;i++)await cycle(t,c,transport);expect(transport.effects).toHaveLength(1);expect(db.query(`select to_jsonb(count(*))from private.polat_contact_tickets where tenant_id='${t}'and purpose='MARKETING'`)).toBe(1);}finally{retire(t);}
 },60000);
});
