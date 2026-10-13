// Isolated sandbox acceptance only. No source messages, workers, provider activation
// or live funds. Secrets remain in process memory/private runner files, never evidence.
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { randomUUID, randomBytes, createHmac, createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,secret=process.env.SUPABASE_SECRET_KEY;
const out=process.env.PHASE10_EVIDENCE_FILE;
if (!url||!key||!secret||!out||!process.env.PAYMENT_TEST_WEBHOOK_SECRET) throw new Error('PHASE10_SANDBOX_ENV_REQUIRED');
const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const run=randomUUID(),tenant=randomUUID(),otherTenant=randomUUID(),customer=randomUUID(),connection=randomUUID(),contact=randomUUID(),conversation=randomUUID(),product=randomUUID(),plan=randomUUID(),pv=randomUUID(),plv=randomUUID(),offer=randomUUID();
const results=[],users=[],sessions=[];let manager,invoiceIds=[],baseline,afterEvidence,completed=false;
const check=(name,ok)=>{if(!ok)throw new Error('ACCEPTANCE_FAILED:'+name);results.push({name,status:'PASS'});};
async function rpc(client,name,args){const {data,error}=await client.rpc(name,args);if(error)throw new Error('RPC_FAILED:'+name+':'+error.code);return data;}
function sql(text){const f=process.env.RUNNER_TEMP+'/phase10-query.sql';writeFileSync(f,text,{mode:0o600});if(process.env.PHASE10_LOCAL_DB_URL){const output=execFileSync('psql',[process.env.PHASE10_LOCAL_DB_URL,'-v','ON_ERROR_STOP=1','-Atq','-f',f],{encoding:'utf8',maxBuffer:2*1024*1024}).trim();return output===''?[]:output==='t'?[{passed:true}]:[{snapshot:JSON.parse(output)}];}const output=execFileSync('supabase',['db','query','--linked','--file',f,'-o','json'],{encoding:'utf8',maxBuffer:2*1024*1024});return JSON.parse(output);}
function rows(result){if(Array.isArray(result))return result;if(Array.isArray(result.result))return result.result;if(Array.isArray(result.rows))return result.rows;if(Array.isArray(result.data))return result.data;throw new Error('SQL_RESULT_INVALID');}
function summary(){return rows(sql(`select jsonb_build_object('outbound_messages',(select count(*) from public.messages where direction='outbound'),'real_payment_events',(select count(*) from public.domain_events where event_type='payment.confirmed'),'paid_customers',(select count(*) from public.customers where state='PAID'),'history',(select count(*) from public.customer_state_history where tenant_id not in ('${tenant}','${otherTenant}')),'fixture_transitions',(select count(*) from public.customer_state_history where tenant_id in ('${tenant}','${otherTenant}') and from_state is not null),'test_windows',(select count(*) from private.payment_test_webhook_windows where enabled_until>now()),'operating_flags',(select coalesce(jsonb_agg(jsonb_build_object('tenant_id',t.id,'outbound',t.outbound_messaging_enabled,'tenant_status',t.status) order by t.id),'[]') from public.tenants t where t.id not in ('${tenant}','${otherTenant}') and t.slug not like 'phase10-sandbox-%'),'conversation_controls',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'mode',c.runtime_mode,'takeover',c.human_takeover,'automatic_replies',c.automatic_replies_enabled) order by c.id),'[]') from public.conversations c where c.tenant_id not in ('${tenant}','${otherTenant}')),'subscription_table',to_regclass('public.subscriptions') is not null,'access_table',to_regclass('public.channel_access') is not null) as snapshot;`))[0].snapshot;}
async function identity(role){const email=`phase10-sandbox+${role}-${run}@example.test`,password=randomBytes(30).toString('base64url')+'Aa1!';const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true});if(error)throw new Error('SANDBOX_AUTH_CREATE_FAILED');users.push(data.user.id);const {error:memberError}=await admin.from('tenant_members').insert({tenant_id:tenant,user_id:data.user.id,role,status:'active'});if(memberError)throw new Error('SANDBOX_MEMBER_FAILED');let cookies=[];const client=createServerClient(url,key,{cookies:{getAll:()=>cookies,setAll:values=>{for(const value of values){cookies=cookies.filter(c=>c.name!==value.name);cookies.push(value);}}}});const signed=await client.auth.signInWithPassword({email,password});if(signed.error)throw new Error('SANDBOX_SIGNIN_FAILED');sessions.push(client);return {id:data.user.id,client,cookie:()=>cookies.map(c=>`${c.name}=${c.value}`).join('; ')};}
async function http(path,{cookie,body,signature,timestamp,method='GET'}={}){
 const config=['silent','show-error','max-time = 25',`request = "${method}"`,'write-out = "\\n%{http_code}"'];
 if(cookie)config.push('header = '+JSON.stringify('Cookie: '+cookie));
 if(body!==undefined){config.push('header = "Content-Type: application/json"','data-binary = '+JSON.stringify(body));}
 if(signature)config.push('header = '+JSON.stringify('x-payment-test-signature: '+signature));
 if(timestamp)config.push('header = '+JSON.stringify('x-payment-test-timestamp: '+timestamp));
 if(process.env.PHASE10_LOCAL_APP_URL){
  const headers={'x-forwarded-proto':'https'};if(cookie)headers.Cookie=cookie;if(body!==undefined)headers['Content-Type']='application/json';if(signature)headers['x-payment-test-signature']=signature;if(timestamp)headers['x-payment-test-timestamp']=timestamp;
  const response=await fetch(new URL(path,process.env.PHASE10_LOCAL_APP_URL),{method,headers,body,redirect:'manual',signal:AbortSignal.timeout(25000)});return {status:response.status,body:await response.text()};
 }
 const args=['dlx','vercel@59.16.0','curl',path,'--deployment',process.env.DEPLOYMENT_URL,'--scope',process.env.VERCEL_TEAM_SLUG,'--','--config','-'];
 const output=await new Promise((resolve,reject)=>{const child=spawn('pnpm',args,{env:process.env,stdio:['pipe','pipe','pipe']});let stdout='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',()=>{});child.on('error',()=>reject(new Error('VERCEL_HTTP_START_FAILED')));child.on('close',code=>code===0?resolve(stdout):reject(new Error('VERCEL_HTTP_REQUEST_FAILED')));child.stdin.end(config.join('\n')+'\n');});
 const i=output.lastIndexOf('\n');return {status:Number(output.slice(i+1)),body:output.slice(0,i)};
}
const sign=(body,timestamp)=>createHmac('sha256',process.env.PAYMENT_TEST_WEBHOOK_SECRET).update(timestamp+'.'+body).digest('hex');
async function webhook(invoice,snapshot,event=randomUUID(),changes={}) {const body=JSON.stringify({event_id:'test:'+event,invoice_id:invoice,snapshot_id:snapshot}),timestamp=String(Math.floor(Date.now()/1000));return http('/api/webhooks/payments/'+(invoiceIds.find(i=>i.id===invoice).provider),{body,method:'POST',timestamp,signature:sign(body,timestamp),...changes});}
async function snapshot(invoice,scenario){return rpc(manager.client,'admin_simulate_test_payment',{target_tenant_id:tenant,target_invoice_id:invoice,scenario_value:scenario,request_key_value:randomUUID()});}
async function detail(invoice){return rpc(manager.client,'admin_payment_detail',{target_tenant_id:tenant,target_invoice_id:invoice});}
try {
 baseline=summary();
 const inserted=await admin.from('tenants').insert([{id:tenant,name:'Phase 10 isolated sandbox',slug:'phase10-sandbox-'+run},{id:otherTenant,name:'Phase 10 denial sandbox',slug:'phase10-sandbox-denial-'+run}]);if(inserted.error)throw new Error('SANDBOX_TENANT_CREATE_FAILED');
 manager=await identity('manager');const support=await identity('support'),readonly=await identity('readonly');
 sql(`begin;
 insert into public.customers(id,tenant_id,display_name) values('${customer}','${tenant}','TEST ONLY synthetic payment fixture');
 insert into public.messaging_provider_connections(id,tenant_id,provider,status) values('${connection}','${tenant}','telegram','disabled');
 insert into public.messaging_contacts(id,tenant_id,provider_connection_id,customer_id,provider_user_id,provider_chat_id,contactability) values('${contact}','${tenant}','${connection}','${customer}','test:${run}','test:${run}','blocked');
 insert into public.conversations(id,tenant_id,provider_connection_id,messaging_contact_id,customer_id,provider_conversation_id,status,human_takeover) values('${conversation}','${tenant}','${connection}','${contact}','${customer}','test:${run}','closed',true);
 insert into public.commercial_items(id,tenant_id,kind,test_only,test_conversation_id,created_by) values('${product}','${tenant}','product',true,'${conversation}','${manager.id}'),('${plan}','${tenant}','plan',true,'${conversation}','${manager.id}');
 insert into public.commercial_versions(id,tenant_id,item_id,version,payload,created_by,effective_from) values('${pv}','${tenant}','${product}',1,'{"fixture":"TEST ONLY"}','${manager.id}',now()),('${plv}','${tenant}','${plan}',1,'{"fixture":"TEST ONLY"}','${manager.id}',now());
 insert into public.commercial_offers(id,tenant_id,conversation_id,customer_id,source_event_id,plan_version_id,product_version_id,amount,currency,discount_bps,snapshot,status,expires_at)
 select '${offer}','${tenant}','${conversation}','${customer}',id,'${plv}','${pv}',79,'USD',0,'{"fixture":"TEST ONLY; no real service rights"}','approved',now()+interval '2 hours' from public.domain_events where customer_id='${customer}' and event_type='customer.created';
 commit;`);
 await rpc(manager.client,'admin_payment_test_webhook_window',{target_tenant_id:tenant,seconds_value:900});
 for (const [channel,asset,units] of [['telegram_stars','XTR','100'],['external_crypto','USDT','79000000'],['external_crypto','USDC','79000000']]) {
  const id=await rpc(manager.client,'admin_create_test_payment_invoice',{target_tenant_id:tenant,target_offer_id:offer,channel_value:channel,asset_value:asset,amount_units_value:units,idempotency_key_value:randomUUID()});invoiceIds.push({id,provider:channel==='telegram_stars'?'telegram_stars_test':'external_crypto_test',asset});
  const i=(await detail(id)).invoice;check('channel-separation-'+asset,i.mode==='test'&&i.surface===(channel==='telegram_stars'?'telegram_bot':'independent_web')&&i.amount_units===units);
  const sid=await snapshot(id,'settled');
  const forged=await webhook(id,sid,randomUUID(),{signature:'f'.repeat(64)});check('reject-forged-hmac-'+asset,forged.status===400);
  const staleTimestamp=String(Math.floor(Date.now()/1000)-301),staleBody=JSON.stringify({event_id:'test:'+randomUUID(),invoice_id:id,snapshot_id:sid});
  const stale=await http('/api/webhooks/payments/'+invoiceIds.at(-1).provider,{method:'POST',body:staleBody,timestamp:staleTimestamp,signature:sign(staleBody,staleTimestamp)});check('reject-expired-replay-'+asset,stale.status===400);
  const event=randomUUID();const replies=await Promise.all([webhook(id,sid,event),webhook(id,sid,event)]);check('concurrent-signed-webhook-'+asset,replies.every(r=>r.status===200));
  const d=await detail(id);check('single-receipt-and-transaction-'+asset,d.invoice.status==='CONFIRMED'&&d.observations.length===1&&d.transactions.length===1);
  const conflicting=await snapshot(id,'pending');const conflict=await webhook(id,conflicting,event);check('reject-event-content-conflict-'+asset,conflict.status===503&&(await detail(id)).observations.length===1);
  const valid=await rpc(admin,'payment_get_test_snapshot',{target_snapshot_id:sid});
  const reconciliation=await rpc(admin,'payment_record_test_observation',{target_tenant_id:tenant,target_invoice_id:id,target_snapshot_id:sid,event_id_value:'test:reconcile:'+sid,raw_hash_value:createHash('sha256').update(JSON.stringify(valid)).digest('hex'),method_value:'reconcile'});
  check('independent-reconciliation-'+asset,reconciliation.state==='CONFIRMED'&&(await detail(id)).invoice.reconciliation_count===1);
 }
 const list=await rpc(manager.client,'admin_payment_list',{target_tenant_id:tenant});check('unified-payments-admin',list.length===3);
 const managerUi=await http('/admin/payments',{cookie:manager.cookie()}),supportUi=await http('/admin/payments',{cookie:support.cookie()}),readonlyUi=await http('/admin/payments',{cookie:readonly.cookie()});
 check('manager-payments-ui',managerUi.status===200&&managerUi.body.includes('Create a test invoice')&&managerUi.body.includes('TEST ONLY'));
 check('support-ui-read-only',supportUi.status===200&&!supportUi.body.includes('name="offer_id"'));
 check('readonly-ui-denied',[302,303,307].includes(readonlyUi.status));
 const detailUi=await http('/admin/payments/'+invoiceIds[0].id,{cookie:manager.cookie()});check('invoice-detail-ui-evidence',detailUi.status===200&&detailUi.body.includes('Provider evidence')&&detailUi.body.includes('Immutable quote snapshot'));
 const cross=await manager.client.rpc('admin_payment_list',{target_tenant_id:otherTenant});check('cross-tenant-rpc-denied',cross.error?.code==='42501');
 const noWrite=await support.client.rpc('admin_simulate_test_payment',{target_tenant_id:tenant,target_invoice_id:invoiceIds[0].id,scenario_value:'settled',request_key_value:randomUUID()});check('support-privileged-write-denied',noWrite.error?.code==='42501');
 const rejectedAsset=await manager.client.rpc('admin_create_test_payment_invoice',{target_tenant_id:tenant,target_offer_id:offer,channel_value:'telegram_stars',asset_value:'USDT',amount_units_value:'100',idempotency_key_value:randomUUID()});check('crypto-on-telegram-denied',rejectedAsset.error?.code==='22023');
 for(const scenario of ['underpaid','overpaid','wrong_asset','wrong_network','wrong_recipient','insufficient_confirmations','late','failed','refunded','reorg']){
  const id=await rpc(manager.client,'admin_create_test_payment_invoice',{target_tenant_id:tenant,target_offer_id:offer,channel_value:'external_crypto',asset_value:'USDT',amount_units_value:'79000000',idempotency_key_value:randomUUID()});invoiceIds.push({id,provider:'external_crypto_test',asset:'USDT'});const sid=await snapshot(id,scenario);const response=await webhook(id,sid);const d=await detail(id);
  const expected=scenario==='insufficient_confirmations'?'PENDING':scenario==='failed'?'FAILED':scenario==='refunded'?'REFUNDED':'REVIEW';check('provider-evidence-'+scenario,response.status===200&&d.invoice.status===expected);
 }
 // Atomic rollback tests catch immutable/cross-tenant/test-fence bypasses.
 const immutable=rows(sql(`do $$begin
 begin update public.payment_invoices set amount_units=1 where id='${invoiceIds[0].id}';raise exception 'IMMUTABILITY_FAILED';exception when insufficient_privilege then null;end;
 begin update public.commercial_offers set amount=1 where id='${offer}';raise exception 'OFFER_IMMUTABILITY_FAILED';exception when insufficient_privilege then null;end;
 begin update public.payment_invoices set mode='live' where id='${invoiceIds[0].id}';raise exception 'MODE_FENCE_FAILED';exception when insufficient_privilege then null;end;
 end;$$;select true as passed;`));check('immutable-offer-invoice-and-test-fence',immutable[0].passed===true);
 const live=await http('/api/webhooks/payments/live_crypto',{method:'POST',body:'{}'});check('live-provider-route-disabled',live.status===503);
 await rpc(manager.client,'admin_payment_test_webhook_window',{target_tenant_id:tenant,seconds_value:0});
 const closed=await webhook(invoiceIds[0].id,await snapshot(invoiceIds[0].id,'settled'));check('sandbox-window-restored-closed',closed.status===503);
 const after=summary();afterEvidence=after;
 check('zero-real-payment-events',after.real_payment_events===baseline.real_payment_events);
 check('zero-paid-transitions',after.paid_customers===baseline.paid_customers&&after.history===baseline.history&&after.fixture_transitions===0);
 check('zero-outbound-messages',after.outbound_messages===baseline.outbound_messages);
 check('zero-subscription-access-engine',!after.subscription_table&&!after.access_table);
 check('existing-operating-flags-preserved',JSON.stringify(after.operating_flags)===JSON.stringify(baseline.operating_flags)&&JSON.stringify(after.conversation_controls)===JSON.stringify(baseline.conversation_controls));
 completed=true;
 } finally {
 let cleanupVerified=true;
 if(manager){const {error}=await manager.client.rpc('admin_payment_test_webhook_window',{target_tenant_id:tenant,seconds_value:0});if(error)cleanupVerified=false;}
 for(const session of sessions){const {error}=await session.auth.signOut({scope:'global'});if(error)cleanupVerified=false;}
 if(users.length){const {error}=await admin.from('tenant_members').update({status:'disabled'}).eq('tenant_id',tenant);if(error)cleanupVerified=false;}
 for(const id of users){const {error}=await admin.auth.admin.updateUserById(id,{ban_duration:'876000h'});if(error)cleanupVerified=false;}
 const suspended=await admin.from('tenants').update({status:'suspended'}).in('id',[tenant,otherTenant]);if(suspended.error)cleanupVerified=false;
 if(manager){const window=await admin.rpc('payment_test_webhook_window_active',{target_tenant_id:tenant});if(window.error||window.data!==false)cleanupVerified=false;}
 const evidence={phase:10,commit:process.env.VALIDATED_SHA,mode:'test',deployment_url:process.env.DEPLOYMENT_URL,status:completed&&cleanupVerified?'PASS':'INCOMPLETE',checks:results,integrity_counts:{before:baseline?{real_payment_events:baseline.real_payment_events,paid_customers:baseline.paid_customers,operating_history:baseline.history,outbound_messages:baseline.outbound_messages}:null,after:afterEvidence?{real_payment_events:afterEvidence.real_payment_events,paid_customers:afterEvidence.paid_customers,operating_history:afterEvidence.history,fixture_transitions:afterEvidence.fixture_transitions,outbound_messages:afterEvidence.outbound_messages}:null},cleanup_verified:cleanupVerified,final_flags:{sandbox_window:cleanupVerified?'closed':'restore-not-verified',fixture_tenant:cleanupVerified?'suspended':'restore-not-verified',fixture_memberships:cleanupVerified?'disabled':'restore-not-verified',fixture_auth_sessions:cleanupVerified?'revoked':'restore-not-verified',live_payments:false,phase11:false,historical_import:'LOCKED'},cost:{real_funds:0,new_paid_services:0,provider_network_calls:0,ci_vercel_usage:'not independently metered'}};
 mkdirSync(out.slice(0,out.lastIndexOf('/')),{recursive:true});writeFileSync(out,JSON.stringify(evidence,null,2));
 console.log(JSON.stringify({phase:10,status:evidence.status,checks:results.length,evidence:'sanitized artifact'}));
 if(!cleanupVerified)throw new Error('PHASE10_SANDBOX_CLEANUP_NOT_VERIFIED');
}
