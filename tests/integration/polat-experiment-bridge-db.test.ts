import { beforeAll,describe,it,expect,vi } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync,mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve,join } from "node:path";
import { createPolatExperimentPgFixtureStore,openPolatDurableOfflineCanary } from "../../packages/domain/src/polat-experiment-bridge";
import { polatGuardDigest } from "../../packages/domain/src/polat-experiment-journal";
import { preparePolatConversation } from "../../packages/domain/src/polat-conversation";
import { polatFixture } from "../../packages/domain/src/polat-conversation.fixtures";
import { polatBridgeFixtureBinding,polatClaudeCompleteEnvelope,polatClaudeFixtureWire } from "../helpers/polat-bridge-fixtures";
import { disposablePolatDatabase } from "../helpers/polat-local-database";
import type { PolatExperimentSql } from "../../packages/domain/src/polat-experiment-store";

const connection=process.env.POLAT_BRIDGE_DISPOSABLE_DB_URL;
const uuid=(n:number,kind:string)=>`91cb${kind}-0000-4000-8000-${String(n).padStart(12,"0")}`;
const literal=(v:unknown)=>v===null?"null":typeof v==="number"&&Number.isSafeInteger(v)?String(v):typeof v==="string"?"'"+v.replaceAll("'","''")+"'":(()=>{throw Error("TEST_PARAMETER_DENIED");})();
describe.runIf(Boolean(connection))("durable Claude bridge on actual disposable PostgreSQL17",()=>{
 let db:ReturnType<typeof disposablePolatDatabase>;
 beforeAll(()=>{db=disposablePolatDatabase(connection!);expect(db.query("select to_jsonb(current_setting('server_version_num')::int/10000)")).toBe(17);});
 function setup(n:number,extra:Record<string,unknown>={}){
  const tenant=uuid(n,"1000"),run=uuid(n,"2000");db.execute(`insert into public.tenants(id,name,slug)values('${tenant}','Offline bridge fixture','polat-sandbox-bridge-${n}');`);
  const b=polatBridgeFixtureBinding({timeout_ms:10000,account_scope_hash:polatGuardDigest(["fixture-account",n]),authorization_record_hash:polatGuardDigest(["fixture-owner",n]),...extra});
  const input=polatFixture("Hi","en");input.tenant_id=tenant;input.messages=input.messages.map(m=>({...m,tenant_id:tenant}));input.knowledge=input.knowledge.map(k=>({...k,tenant_id:tenant}));
  const prepared=preparePolatConversation(input),sql:PolatExperimentSql={execute:async(statement,values)=>db.query(statement.replace(/\$(\d+)\b/gu,(_,i:string)=>literal(values[Number(i)-1])))};
  return{tenant,run,b,prepared,sql,store:createPolatExperimentPgFixtureStore(tenant,sql)};
 }
 function retire(t:string){db.execute(`update public.tenants set status='suspended'where id='${t}';`);}
 const frame=(extra:Record<string,unknown>={})=>({kind:"HTTP",status:200,body:JSON.stringify(polatClaudeCompleteEnvelope()),...extra});
 it("runs actual codec/native QA/observation through committed reservations with no genuine authority",async()=>{
  const s=setup(8201);try{const g=await openPolatDurableOfflineCanary({store:s.store,run_id:s.run,binding:s.b}),r=await g.attempt(s.prepared,frame());expect(r.state).toBe("RECORDED_BILLING_UNVERIFIED");expect(r).toMatchObject({fake_transport_calls:1,network_calls:0,financial_authority:"NONE"});
   const read=await g.read();expect(read).toMatchObject({request_count:1,stop_reason:"BILLING_UNVERIFIED",actual_billed_amount:null});expect(read.items.map(x=>x.stage)).toEqual(["DISPATCH_STARTED","PROVIDER_RESULT"]);
   expect(db.query(`select to_jsonb(count(*))from public.audit_logs where tenant_id='${s.tenant}'and action='polat.experiment_reserved'`)).toBe(1);
   expect(JSON.stringify(read)).not.toContain("Hi! I'm Polat");expect(JSON.stringify(read)).not.toContain("dispatch_key");
  }finally{retire(s.tenant);}
 });
 it("new store/run UUID after a restart cannot reset the same logical request or liability",async()=>{
  const s=setup(8202);try{const g=await openPolatDurableOfflineCanary({store:s.store,run_id:s.run,binding:s.b});await g.attempt(s.prepared,frame());
   const restarted=await openPolatDurableOfflineCanary({store:createPolatExperimentPgFixtureStore(s.tenant,s.sql),run_id:uuid(9991,"2000"),binding:s.b});expect(restarted.run_id).toBe(s.run);const result=await restarted.attempt(s.prepared,frame());expect(result).toMatchObject({state:"ALREADY_RESERVED_REVIEW_REQUIRED",network_calls:0});expect((await restarted.read()).request_count).toBe(1);
  }finally{retire(s.tenant);}
 });
 it("preserves a committed reservation when its database acknowledgement is lost",async()=>{
  const s=setup(8203);let lost=false;const sql:PolatExperimentSql={execute:async(q,v)=>{const result=await s.sql.execute(q,v);if(q.includes("polat_experiment_reserve_fixture")&&!lost){lost=true;throw Error("SIMULATED_COMMIT_ACK_LOSS");}return result;}};
  try{const g=await openPolatDurableOfflineCanary({store:createPolatExperimentPgFixtureStore(s.tenant,sql),run_id:s.run,binding:s.b});await expect(g.attempt(s.prepared,frame())).rejects.toThrow("ACK_LOSS");const restored=await openPolatDurableOfflineCanary({store:s.store,run_id:s.run,binding:s.b});expect((await restored.attempt(s.prepared,frame())).state).toBe("ALREADY_RESERVED_REVIEW_REQUIRED");const read=await restored.read();expect(read.request_count).toBe(1);expect(read.items).toHaveLength(0);
  }finally{retire(s.tenant);}
 });
 it("unknown outcome commit is recovered without calling the provider again",async()=>{
  const s=setup(8204);let lost=false;const sql:PolatExperimentSql={execute:async(q,v)=>{const result=await s.sql.execute(q,v);if(q.includes("polat_experiment_record_fixture")&&!lost){lost=true;throw Error("SIMULATED_RESULT_ACK_LOSS");}return result;}};
  try{const g=await openPolatDurableOfflineCanary({store:createPolatExperimentPgFixtureStore(s.tenant,sql),run_id:s.run,binding:s.b});expect((await g.attempt(s.prepared,frame())).state).toBe("EVIDENCE_COMMIT_UNKNOWN_REVIEW_REQUIRED");expect((await g.attempt(s.prepared,frame())).state).toBe("ALREADY_RESERVED_REVIEW_REQUIRED");expect((await g.read()).items.map(x=>x.stage)).toEqual(["DISPATCH_STARTED","PROVIDER_RESULT"]);
  }finally{retire(s.tenant);}
 });
 it("timeout preserves UNKNOWN and cannot create a blind second attempt",async()=>{
  const s=setup(8205,{timeout_ms:5});try{const g=await openPolatDurableOfflineCanary({store:s.store,run_id:s.run,binding:s.b});const r=await g.attempt(s.prepared,frame({delay_ms:30,ignore_abort:true}));expect(r.state).toBe("UNKNOWN_REVIEW_REQUIRED");expect((await g.read()).stop_reason).toBe("UNKNOWN_REMOTE_COMPLETION");expect((await g.attempt(s.prepared,frame())).state).toBe("ALREADY_RESERVED_REVIEW_REQUIRED");expect((await g.read()).request_count).toBe(1);
  }finally{retire(s.tenant);}
 });
 it("malformed/wrong-model fake response still consumes the request and retains unknown billing",async()=>{
  const s=setup(8206);try{const g=await openPolatDurableOfflineCanary({store:s.store,run_id:s.run,binding:s.b});expect((await g.attempt(s.prepared,frame({body:JSON.stringify(polatClaudeCompleteEnvelope({model:"unapproved-model"}))}))).state).toBe("RECORDED_REVIEW_REQUIRED");const read=await g.read();expect(read.request_count).toBe(1);expect(read.stop_reason).toBe("BILLING_UNVERIFIED");
  }finally{retire(s.tenant);}
 });
 it("unsafe actual output is held by native QA without replacing its text",async()=>{
  const s=setup(8207),e=polatClaudeCompleteEnvelope(),w=polatClaudeFixtureWire();w.proposed_response="Your payment is verified and VIP access is active.";w.claims=[{text:w.proposed_response,kind:"fact",speech_act:"BUSINESS_FACT",capability:null,grounding:"UNKNOWN",evidence_refs:[],action_category:null}];
  try{const g=await openPolatDurableOfflineCanary({store:s.store,run_id:s.run,binding:s.b});const r=await g.attempt(s.prepared,frame({body:JSON.stringify({...e,content:[{type:"text",text:JSON.stringify(w),citations:null}]})}));expect(r).toMatchObject({state:"RECORDED_REVIEW_REQUIRED",qa:{action:"HOLD"}});expect((await g.read()).stop_reason).toBe("QA_REVIEW_REQUIRED");
  }finally{retire(s.tenant);}
 });
 it("denies binding changes and foreign tenant reads without changing native financial state",async()=>{
  const s=setup(8208),other=setup(8209);try{await s.store.prepare(s.run,s.b);await expect(s.store.prepare(s.run,{...s.b,currency:"EUR"})).rejects.toThrow();await expect(other.store.read(s.run)).rejects.toThrow();expect(db.query(`select to_jsonb(count(*))from private.verified_payment_receipts where tenant_id='${s.tenant}'`)).toBe(0);expect(db.query(`select to_jsonb(count(*))from public.domain_events where tenant_id='${s.tenant}'`)).toBe(0);
  }finally{retire(s.tenant);retire(other.tenant);}
 });
 it("two real Node processes and different local directories retain one original run and budget",()=>{
  const s=setup(8210),dirs=[mkdtempSync(join(tmpdir(),"polat-bridge-restart-")),mkdtempSync(join(tmpdir(),"polat-bridge-restart-"))];
  const code=`import{readFileSync}from'node:fs';import{execFileSync}from'node:child_process';import{createPolatExperimentPgFixtureStore}from'@gold-revenue-os/domain/polat-experiment-bridge';const x=JSON.parse(readFileSync(0,'utf8'));process.chdir(x.directory);const quote=v=>v===null?'null':typeof v==='number'?String(v):"'"+v.replaceAll("'","''")+"'";const sql={execute:async(q,v)=>JSON.parse(execFileSync('psql',[x.url,'-X','-Atq','-v','ON_ERROR_STOP=1','-c',q.replace(/\\$(\\d+)\\b/g,(_,i)=>quote(v[Number(i)-1]))],{encoding:'utf8',timeout:10000}).trim())};const store=createPolatExperimentPgFixtureStore(x.tenant,sql),p=await store.prepare(x.run,x.binding);const r=await store.reserve(p.run_id,x.attempt,x.binding.targets[0],x.request_hash,x.body_hash,p.binding_hash);const summary=await store.read(p.run_id);process.stdout.write(JSON.stringify({pid:process.pid,run_id:p.run_id,replay:r.replay,count:summary.request_count,reserved:summary.reserved_liability}));`;
  try{const run=(i:number)=>{const child=spawnSync(process.execPath,["--experimental-transform-types","--import",resolve("scripts/polat-typescript-resolver.mjs"),"--input-type=module","-e",code],{cwd:resolve("apps/web"),input:JSON.stringify({url:connection,tenant:s.tenant,run:i===0?s.run:uuid(9992,"2000"),binding:s.b,attempt:uuid(821001+i,"3000"),directory:dirs[i],request_hash:"e".repeat(64),body_hash:"f".repeat(64)}),encoding:"utf8",timeout:20000});expect(child.status,child.stderr).toBe(0);expect(child.stdout).not.toBe("");return JSON.parse(child.stdout);};
   const first=run(0),second=run(1);expect(first.pid).not.toBe(second.pid);expect(first.run_id).toBe(s.run);expect(second).toMatchObject({run_id:s.run,replay:true,count:1,reserved:"0.02"});
  }finally{retire(s.tenant);dirs.forEach(d=>rmSync(d,{recursive:true,force:true}));}
 },60000);
 it("uses only pinned parameterized private statements; caller data cannot choose SQL/host authority",async()=>{
  const execute=vi.fn();const store=createPolatExperimentPgFixtureStore(uuid(8211,"1000"),{execute});await expect(store.reserve("not-a-uuid","not-a-uuid","' ;drop table x;--","e".repeat(64),"f".repeat(64),"a".repeat(64))).rejects.toThrow();expect(execute).not.toHaveBeenCalled();expect(readFileSync("packages/domain/src/polat-experiment-store.ts","utf8")).not.toContain("process.env");
 });
});
