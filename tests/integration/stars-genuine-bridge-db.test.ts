import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { disposablePolatDatabase, polatSqlClient } from "../helpers/polat-local-database";
vi.mock("server-only",()=>({}));
const state=vi.hoisted(()=>({db:null as ReturnType<typeof polatSqlClient>|null}));
vi.mock("@/lib/supabase/admin",()=>({createSupabaseAdminClient:()=>state.db}));
import { createStarsCommerce } from "../../apps/web/src/lib/payments/telegram-stars-commerce";
import { runGenuineEntitlementCycle } from "../../apps/web/src/lib/entitlements/genuine-service";
const url=process.env.STARS_COMMERCE_DB_URL,sha="b".repeat(40),q=(s:string)=>"'"+s.replaceAll("'","''")+"'";
const id=(n:number,kind:string)=>`61b0${kind}-0000-4000-8000-${String(n).padStart(12,"0")}`;
describe.runIf(Boolean(url))("Stars production-shaped bridge, disposable PG17 and OFFLINE Telegram only",()=>{
 let db:ReturnType<typeof disposablePolatDatabase>;const owned=new Set<string>();
 beforeAll(()=>{db=disposablePolatDatabase(url!);state.db=polatSqlClient(db);vi.stubEnv("VERCEL_GIT_COMMIT_SHA",sha);});
 afterAll(()=>{for(const tenant of owned)db.execute(`update private.entitlement_controls set live_enabled=false where tenant_id='${tenant}';update private.sales_campaigns set state='STOPPED'where tenant_id='${tenant}';update public.tenants set status='suspended'where id='${tenant}';`);vi.unstubAllEnvs();});
 function setup(n:number){
  const t=id(n,"2000"),c=id(n,"5000"),p=id(n,"9000"),bot=String(9400000+n),payer="710000"+n,token=bot+":SYNTHETIC_MERCHANT_CREDENTIAL_ONLY",secret="SYNTHETIC_WEBHOOK_SECRET_"+"s".repeat(40),channel="-100"+n;
  const helpers=readFileSync("supabase/tests/helpers/campaign_fixtures.sql","utf8").replace("\\ir polat_inbound_fixtures.sql",()=>readFileSync("supabase/tests/helpers/polat_inbound_fixtures.sql","utf8")).replaceAll("'currency','USD'","'currency','XTR'").replace("'amount','10.00'","'amount','100.00'");
  db.execute(`begin;${helpers}select pg_temp.campaign_setup(${n},false,true);update public.tenants set outbound_messaging_enabled=true where id='${t}';select public.admin_campaign_state_v1('${t}','${p}',1,'START');commit;`);owned.add(t);
  db.execute(`select public.ingest_telegram_message('${t}','stars-fixture-${n}','99','${payer}','${payer}',null,'Synthetic',null,'I want to buy the approved plan',null,clock_timestamp());`);
  const event=db.query(`select to_jsonb(e.id)from public.domain_events e join public.messages m on m.tenant_id=e.tenant_id and m.id::text=e.payload->>'message_id'where e.tenant_id='${t}'and e.event_type='message.received'and m.provider_message_id='99'limit 1`)as string;
  const offer=db.query(`select to_jsonb(private.prepare_commercial_offer('${t}','${event}','${id(n,"7001")}',0))`)as string;
  db.execute(`do $$declare step record;ev uuid;res jsonb;begin for step in select * from(values('NEW','CONTACT_READY','admin.manual_transition','{}'::jsonb),('CONTACT_READY','CONTACTED','admin.manual_transition','{}'),('CONTACTED','REPLIED','admin.manual_transition','{}'),('REPLIED','QUALIFIED','qualification.completed','{"qualification_id":"SYNTHETIC"}'),('QUALIFIED','OFFER_SENT','offer.created','{"offer_id":"SYNTHETIC"}'),('OFFER_SENT','INTERESTED','offer.accepted','{"offer_id":"SYNTHETIC"}'),('INTERESTED','PAYMENT_PENDING','payment.intent_created','{"payment_id":"SYNTHETIC","amount":"100","asset":"XTR","network":"TELEGRAM"}'))x(a,b,e,p)loop ev:=null;if step.e<>'admin.manual_transition'then ev:=private.append_domain_event('${t}','${c}',step.e,1,step.p,'SYSTEM',null,'synthetic_stars_test','TRUSTED',extensions.gen_random_uuid(),null,'stars-fixture-state:'||step.b,clock_timestamp());end if;res:=public.transition_customer_state('${t}','${c}',step.a::public.customer_state,step.b::public.customer_state,'disposable_synthetic_fixture','SYSTEM',null,extensions.gen_random_uuid(),ev,step.e,ev,'stars-fixture-state:'||step.b,clock_timestamp());if res->>'accepted'<>'true'then raise exception 'SYNTHETIC_STATE_FAILED %',res;end if;end loop;end;$$;`);
  const binding={version:1,environment:"TELEGRAM_PRODUCTION",tenant_id:t,financial_authority:"VERIFIED_STARS_RECEIPT",approval_reference:"SYNTHETIC_LOCAL_ONLY_NOT_REAL_ELIGIBILITY",repository_sha:sha,bot_user_id:bot,credential_sha256:createHash("sha256").update(token).digest("hex"),webhook_secret_sha256:createHash("sha256").update(secret).digest("hex"),owner_user_id:"61ca1000-0000-4000-8000-000000000001",eligibility_evidence_hash:"c".repeat(64),owner_authorization_hash:"d".repeat(64),channel_id:channel,allowed_markets:["GB","DE"],expires_at:new Date(Date.now()+3600000).toISOString()};
  db.execute(`insert into public.vip_channels(tenant_id,mode,chat_id,enabled,approval_reference,private_verified)values('${t}','live','${channel}',true,'SYNTHETIC_LOCAL_ONLY',true);insert into private.entitlement_controls(tenant_id,live_enabled,approval_reference,stars_binding)values('${t}',true,${q(binding.approval_reference)},${q(JSON.stringify(binding))}::jsonb);`);
  vi.stubEnv("POLAT_STARS_MERCHANT_BOT_TOKEN",token);vi.stubEnv("POLAT_STARS_MERCHANT_WEBHOOK_SECRET",secret);
  let invoice="",charge="synthetic-charge-"+n,refunded=false,unknown=false;const at=Math.floor(Date.now()/1000),calls:string[]=[];
  const fetcher=vi.fn<typeof fetch>().mockImplementation(async(input,init)=>{
   const address=String(input),method=address.slice(address.lastIndexOf("/")+1);calls.push(method);
   expect(address.startsWith(`https://api.telegram.org/bot${token}/`)).toBe(true);expect(address).not.toContain('/test/');expect(init).toMatchObject({method:"POST",redirect:"error"});
   if(unknown&&method==='createInvoiceLink')throw Error("SYNTHETIC_UNKNOWN");
   const body=JSON.parse(String(init?.body))as Record<string,unknown>;
   const result=method==='getMe'?{id:Number(bot),is_bot:true}:method==='createInvoiceLink'?`https://t.me/$synthetic_${n}`:method==='getStarTransactions'?{transactions:[{id:charge,amount:100,date:at,[refunded?'receiver':'source']:{type:'user',user:{id:Number(payer),is_bot:false},transaction_type:'invoice_payment',invoice_payload:'stars-live:'+invoice}}]}:method==='getChat'?{id:Number(channel),type:'channel'}:method==='getChatMember'?{status:body.user_id===bot?'administrator':refunded?'kicked':'member',user:{id:Number(body.user_id)},can_invite_users:true,can_restrict_members:true}:method==='createChatInviteLink'?{invite_link:'https://t.me/+synthetic',creates_join_request:true,is_primary:false,is_revoked:false,expire_date:body.expire_date}:true;
   return Response.json({ok:true,result});
  });
  const webhook=(kind:"PAYMENT"|"REFUND"|"PRE_CHECKOUT",update=1)=>JSON.stringify(kind==='PRE_CHECKOUT'?{update_id:update,pre_checkout_query:{id:'synthetic-query-'+n,from:{id:Number(payer),is_bot:false},currency:'XTR',total_amount:100,invoice_payload:'stars-live:'+invoice}}:{update_id:update,message:{from:{id:Number(payer),is_bot:false},chat:{id:Number(payer),type:'private'},date:at,[kind==='PAYMENT'?'successful_payment':'refunded_payment']:{currency:'XTR',total_amount:100,invoice_payload:'stars-live:'+invoice,telegram_payment_charge_id:charge,provider_payment_charge_id:''}}});
  return{t,c,p,offer,binding,fetcher,calls,secret,webhook,setInvoice:(v:string)=>{invoice=v;},setRefund:()=>{refunded=true;},setUnknown:()=>{unknown=true;}};
 }
 const seed=Number(process.env.STARS_COMMERCE_CASE_SEED??"0");
 it("default financial authority denies before credential or network access",async()=>{const fetcher=vi.fn();await expect(createStarsCommerce({tenantId:'d4000000-0000-4000-8000-000000000001'},fetcher)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();});
 it("approved offer -> exact XTR intent -> independently corroborated immutable receipt -> one subscription -> numeric VIP -> refund/revoke",async()=>{
  const s=setup(982001+seed),api=await createStarsCommerce({tenantId:s.t},s.fetcher),prepared=await api.preparePurchase(s.offer,'synthetic-purchase');s.setInvoice(prepared.invoice_id);
  expect(prepared.subscription_activated).toBe(false);expect(db.query(`select to_jsonb(count(*))from private.verified_payment_receipts where tenant_id='${s.t}'`)).toBe(0);
  expect(await api.acceptWebhook(s.webhook('PRE_CHECKOUT'),s.secret,'precheckout')).toMatchObject({state:'PENDING'});
  const paid=await api.acceptWebhook(s.webhook('PAYMENT',2),s.secret,'payment')as{state:string;subscription_id:string};expect(paid.state).toBe('CONFIRMED');
  const beforeReplay=s.calls.length;expect(await api.acceptWebhook(s.webhook('PAYMENT',2),s.secret,'payment-replay')).toMatchObject({state:'CONFIRMED',replay:true});expect(s.calls).toHaveLength(beforeReplay);
  expect(db.query(`select to_jsonb(count(*))from public.subscription_payments where tenant_id='${s.t}'`)).toBe(1);
  expect(db.query(`select jsonb_build_object('amount',amount_units::text,'asset',asset)from private.verified_payment_receipts where tenant_id='${s.t}'`)).toEqual({amount:'100',asset:'XTR'});
  expect(await runGenuineEntitlementCycle(s.t,s.fetcher)).toMatchObject({confirmed:true});
  expect(db.query(`select to_jsonb(status)from public.channel_access where tenant_id='${s.t}'`)).toBe('INVITED');
  const joined=await state.db!.rpc('stars_commerce_join_v1',{target_tenant_id:s.t,user_id_value:'710000'+(982001+seed),channel_id_value:s.binding.channel_id,invite_value:'https://t.me/+synthetic',source_hash_value:'f'.repeat(64),occurred_at_value:new Date().toISOString()});expect(joined.error).toBeNull();expect(joined.data).toBe(true);
  expect(await runGenuineEntitlementCycle(s.t,s.fetcher)).toMatchObject({confirmed:true});
  expect(db.query(`select jsonb_build_object('access',a.status,'state',c.state)from public.channel_access a join public.subscriptions sub on sub.id=a.subscription_id join public.customers c on c.id=sub.customer_id where a.tenant_id='${s.t}'`)).toEqual({access:'MEMBER',state:'ACTIVE'});
  s.setRefund();expect(await api.acceptWebhook(s.webhook('REFUND',3),s.secret,'refund-read')).toMatchObject({state:'REFUNDED'});
  expect(await runGenuineEntitlementCycle(s.t,s.fetcher)).toMatchObject({confirmed:true});
  expect(db.query(`select jsonb_build_object('state',s.state,'access',a.status)from public.subscriptions s join public.channel_access a on a.subscription_id=s.id where s.tenant_id='${s.t}'`)).toEqual({state:'CANCELLED',access:'REVOKED'});
  expect(await api.acceptWebhook(s.webhook('PAYMENT',2),s.secret,'after-refund-replay')).toMatchObject({state:'REFUNDED',replay:true});
  expect(s.calls.filter(v=>v==='createInvoiceLink')).toHaveLength(1);
 },60000);
 it("unknown checkout consumes its durable attempt and cannot be blindly dispatched by a restarted factory",async()=>{
  const s=setup(982002+seed);s.setUnknown();const api=await createStarsCommerce({tenantId:s.t},s.fetcher);await expect(api.preparePurchase(s.offer,'unknown')).rejects.toThrow('UNKNOWN');
  const restarted=await createStarsCommerce({tenantId:s.t},s.fetcher);await expect(restarted.preparePurchase(s.offer,'unknown')).rejects.toThrow('NO_REPLAY');expect(s.calls.filter(v=>v==='createInvoiceLink')).toHaveLength(1);
 },30000);
 it("independent connections admit one charge exactly once under concurrent replay",async()=>{
  const s=setup(982004+seed),api=await createStarsCommerce({tenantId:s.t},s.fetcher),p=await api.preparePurchase(s.offer,'concurrent');s.setInvoice(p.invoice_id);
  const original=state.db!,base=original.rpc;let args:Record<string,unknown>|null=null;
  state.db={...original,rpc:async(name:string,a:Record<string,unknown>)=>{if(name==='stars_commerce_admit_v1'){args=a;return{data:{state:'PENDING'},error:null};}return base(name,a);}};
  try{const staged=await createStarsCommerce({tenantId:s.t},s.fetcher);await staged.acceptWebhook(s.webhook('PAYMENT',2),s.secret,'stage');}finally{state.db=original;}
  const a=args as Record<string,unknown>|null;if(!a)throw Error('SYNTHETIC_ADMISSION_NOT_CAPTURED');
  const expression=`public.stars_commerce_admit_v1('${s.t}','${p.invoice_id}','2','${String(a.ledger_attempt_id_value)}')`;
  const concurrent=()=>new Promise<{pid:number;result:{state:string;replay:boolean}}>((resolve,reject)=>{const child=spawn('psql',[url!,'-XAtq','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});let output='',errors='';child.stdout.on('data',(v:Buffer)=>output+=v.toString());child.stderr.on('data',(v:Buffer)=>errors+=v.toString());child.on('error',reject);child.on('close',code=>{if(code!==0)reject(Error(errors.slice(0,500)));else try{resolve(JSON.parse(output.trim()));}catch(e){reject(e);}});child.stdin.end(`begin;set local statement_timeout='10s';set local role service_role;select jsonb_build_object('pid',pg_backend_pid(),'result',${expression});commit;`);});
  const results=await Promise.all([concurrent(),concurrent()]);expect(results[0]!.pid).not.toBe(results[1]!.pid);expect(results.map(r=>r.result.replay).sort()).toEqual([false,true]);expect(db.query(`select to_jsonb(count(*))from public.subscription_payments where tenant_id='${s.t}'`)).toBe(1);
 },30000);
 it("unknown VIP mutation remains reviewable and is not reclaimed after restart",async()=>{
  const s=setup(982005+seed),api=await createStarsCommerce({tenantId:s.t},s.fetcher),p=await api.preparePurchase(s.offer,'vip-unknown');s.setInvoice(p.invoice_id);await api.acceptWebhook(s.webhook('PAYMENT',2),s.secret,'payment');
  let mutations=0;const network:typeof fetch=async(input,init)=>{if(String(input).endsWith('/createChatInviteLink')){mutations++;throw Error('SYNTHETIC_UNKNOWN_AFTER_REMOTE_EFFECT');}return s.fetcher(input,init);};
  expect(await runGenuineEntitlementCycle(s.t,network)).toMatchObject({unknown:true,confirmed:false});expect(await runGenuineEntitlementCycle(s.t,network)).toMatchObject({processed:false});expect(mutations).toBe(1);expect(db.query(`select to_jsonb(status)from public.channel_access where tenant_id='${s.t}'`)).toBe('REVIEW');
 },30000);
 it("wrong webhook/amount and a campaign STOP never initiate another effect",async()=>{
  const s=setup(982003+seed),api=await createStarsCommerce({tenantId:s.t},s.fetcher),p=await api.preparePurchase(s.offer,'purchase');s.setInvoice(p.invoice_id);const count=s.calls.length;
  await expect(api.acceptWebhook(s.webhook('PAYMENT'),'wrong','wrong')).rejects.toThrow('WEBHOOK');
  await expect(api.acceptWebhook(s.webhook('PAYMENT').replace('"total_amount":100','"total_amount":99'),s.secret,'wrong-amount')).rejects.toThrow();expect(s.calls).toHaveLength(count);
  db.execute(`update private.sales_campaigns set state='STOPPED',revision=revision+1 where id='${s.p}';`);await expect(api.preparePurchase(s.offer,'after-stop')).rejects.toThrow();expect(s.calls).toHaveLength(count);
 },30000);
});
