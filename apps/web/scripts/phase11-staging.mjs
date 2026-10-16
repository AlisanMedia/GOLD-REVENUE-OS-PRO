// Isolated sandbox acceptance only. No source messages, workers, provider activation
// or live funds. Secrets remain in process memory/private runner files, never evidence.
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,secret=process.env.SUPABASE_SECRET_KEY;
const out=process.env.PHASE11_EVIDENCE_FILE;
if (!url||!key||!secret||!out) throw new Error('PHASE10_SANDBOX_ENV_REQUIRED');
const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const run=randomUUID(),tenant=randomUUID(),otherTenant=randomUUID(),customer=randomUUID(),connection=randomUUID(),contact=randomUUID(),conversation=randomUUID(),product=randomUUID(),plan=randomUUID(),pv=randomUUID(),plv=randomUUID(),offer=randomUUID();
const results=[],users=[],sessions=[];let manager,invoiceIds=[],baseline,afterEvidence,completed=false;
const check=(name,ok)=>{if(!ok)throw new Error('ACCEPTANCE_FAILED:'+name);results.push({name,status:'PASS'});};
async function rpc(client,name,args){const {data,error}=await client.rpc(name,args);if(error)throw new Error('RPC_FAILED:'+name+':'+error.code);return data;}
function sql(text){const f=process.env.RUNNER_TEMP+'/phase11-query.sql';writeFileSync(f,text,{mode:0o600});if(process.env.PHASE10_LOCAL_DB_URL){const output=execFileSync('psql',[process.env.PHASE10_LOCAL_DB_URL,'-v','ON_ERROR_STOP=1','-Atq','-f',f],{encoding:'utf8',maxBuffer:2*1024*1024}).trim();return output===''?[]:output==='t'?[{passed:true}]:[{snapshot:JSON.parse(output)}];}const output=execFileSync('supabase',['db','query','--linked','--file',f,'-o','json'],{encoding:'utf8',maxBuffer:2*1024*1024});return JSON.parse(output);}
function rows(result){if(Array.isArray(result))return result;if(Array.isArray(result.result))return result.result;if(Array.isArray(result.rows))return result.rows;if(Array.isArray(result.data))return result.data;throw new Error('SQL_RESULT_INVALID');}
function summary(){return rows(sql(`select jsonb_build_object('outbound_messages',(select count(*) from public.messages where direction='outbound'),'real_payment_events',(select count(*) from public.domain_events where event_type='payment.confirmed'),'paid_customers',(select count(*) from public.customers where state='PAID'),'history',(select count(*) from public.customer_state_history where tenant_id not in ('${tenant}','${otherTenant}')),'fixture_transitions',(select count(*) from public.customer_state_history where tenant_id in ('${tenant}','${otherTenant}') and from_state is not null),'test_windows',(select count(*) from private.payment_test_webhook_windows where enabled_until>now()),'operating_flags',(select coalesce(jsonb_agg(jsonb_build_object('tenant_id',t.id,'outbound',t.outbound_messaging_enabled,'tenant_status',t.status) order by t.id),'[]') from public.tenants t where t.id not in ('${tenant}','${otherTenant}') and t.slug not like 'phase11-sandbox-%'),'conversation_controls',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'mode',c.runtime_mode,'takeover',c.human_takeover,'automatic_replies',c.automatic_replies_enabled) order by c.id),'[]') from public.conversations c where c.tenant_id not in ('${tenant}','${otherTenant}')),'subscription_table',exists(select 1 from public.subscriptions where mode='live'),'access_table',exists(select 1 from public.channel_access where mode='live')) as snapshot;`))[0].snapshot;}
async function identity(role){const email=`phase11-sandbox+${role}-${run}@example.test`,password=randomBytes(30).toString('base64url')+'Aa1!';const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true});if(error)throw new Error('SANDBOX_AUTH_CREATE_FAILED');users.push(data.user.id);const {error:memberError}=await admin.from('tenant_members').insert({tenant_id:tenant,user_id:data.user.id,role,status:'active'});if(memberError)throw new Error('SANDBOX_MEMBER_FAILED');let cookies=[];const client=createServerClient(url,key,{cookies:{getAll:()=>cookies,setAll:values=>{for(const value of values){cookies=cookies.filter(c=>c.name!==value.name);cookies.push(value);}}}});const signed=await client.auth.signInWithPassword({email,password});if(signed.error)throw new Error('SANDBOX_SIGNIN_FAILED');sessions.push(client);return {id:data.user.id,client,cookie:()=>cookies.map(c=>`${c.name}=${c.value}`).join('; ')};}
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
async function snapshot(invoice,scenario){return rpc(manager.client,'admin_simulate_test_payment',{target_tenant_id:tenant,target_invoice_id:invoice,scenario_value:scenario,request_key_value:randomUUID()});}
async function ledger(){return rpc(manager.client,'admin_entitlement_list',{target_tenant_id:tenant});}
async function processJob(result){let job;for(let n=0;n<8&&!job;n++)job=await rpc(admin,'entitlement_claim_job',{target_tenant_id:tenant});if(!job)throw Error('TEST_JOB_REQUIRED');const data=typeof result==='function'?result(job):result;return rpc(admin,'entitlement_complete_job',{target_tenant_id:tenant,target_job_id:job.id,lease_value:job.lease_token,result_value:data});}
try {
 baseline=summary();
 const inserted=await admin.from('tenants').insert([{id:tenant,name:'Phase 11 isolated sandbox',slug:'phase11-sandbox-'+run},{id:otherTenant,name:'Phase 11 denial sandbox',slug:'phase11-sandbox-denial-'+run}]);if(inserted.error)throw Error('SANDBOX_TENANT_CREATE_FAILED');
 manager=await identity('manager');const support=await identity('support'),readonly=await identity('readonly');
 sql(`begin;
 insert into public.customers(id,tenant_id,display_name) values('${customer}','${tenant}','TEST ONLY entitlement fixture');
 insert into public.messaging_provider_connections(id,tenant_id,provider,status) values('${connection}','${tenant}','telegram','disabled');
 insert into public.messaging_contacts(id,tenant_id,provider_connection_id,customer_id,provider_user_id,provider_chat_id,contactability) values('${contact}','${tenant}','${connection}','${customer}','test:12345','test:12345','blocked');
 insert into public.conversations(id,tenant_id,provider_connection_id,messaging_contact_id,customer_id,provider_conversation_id,status,human_takeover) values('${conversation}','${tenant}','${connection}','${contact}','${customer}','test:${run}','closed',true);
 insert into public.commercial_items(id,tenant_id,kind,test_only,test_conversation_id,created_by) values('${product}','${tenant}','product',true,'${conversation}','${manager.id}'),('${plan}','${tenant}','plan',true,'${conversation}','${manager.id}');
 insert into public.commercial_versions(id,tenant_id,item_id,version,payload,created_by,effective_from) values('${pv}','${tenant}','${product}',1,'{"fixture":"TEST ONLY"}','${manager.id}',now()),('${plv}','${tenant}','${plan}',1,'{"title":"TEST ONLY membership","duration_unit":"calendar_month","duration_count":1}','${manager.id}',now());
 insert into public.commercial_offers(id,tenant_id,conversation_id,customer_id,source_event_id,plan_version_id,product_version_id,amount,currency,discount_bps,snapshot,status,expires_at)
 select '${offer}','${tenant}','${conversation}','${customer}',id,'${plv}','${pv}',79,'USD',0,'{"fixture":"TEST ONLY; no live rights"}','approved',now()+interval '2 hours' from public.domain_events where customer_id='${customer}' and event_type='customer.created';commit;`);
 // CLI returns JSON row output; local psql helper expects JSON snapshot.
 const proof=rows(sql(`select jsonb_build_object('event_id',id) as snapshot from public.domain_events where customer_id='${customer}' and event_type='customer.created'`))[0].snapshot.event_id;
 const badBinding=await manager.client.rpc('admin_test_access_setup',{target_tenant_id:tenant,target_customer_id:customer,target_event_id:proof,user_id_value:'@username'});check('username-cannot-bind',badBinding.error?.code==='42501');
 await rpc(manager.client,'admin_test_access_setup',{target_tenant_id:tenant,target_customer_id:customer,target_event_id:proof,user_id_value:'test:12345'});
 let sub;
 for(const [channel,asset,units] of [['telegram_stars','XTR','100'],['external_crypto','USDT','79000000']]){
  const inv=await rpc(manager.client,'admin_create_test_payment_invoice',{target_tenant_id:tenant,target_offer_id:offer,channel_value:channel,asset_value:asset,amount_units_value:units,idempotency_key_value:randomUUID()});invoiceIds.push({id:inv,provider:channel==='telegram_stars'?'telegram_stars_test':'external_crypto_test',asset});
  const pending=await manager.client.rpc('admin_create_test_subscription',{target_tenant_id:tenant,target_invoice_id:inv});check('pending-cannot-entitle-'+asset,pending.error?.code==='42501');
  const sid=await snapshot(inv,'settled');await rpc(admin,'payment_record_test_observation',{target_tenant_id:tenant,target_invoice_id:inv,target_snapshot_id:sid,event_id_value:'test:p11:'+randomUUID(),raw_hash_value:createHash('sha256').update(sid).digest('hex'),method_value:'reconcile'});
  const response=await Promise.all([rpc(manager.client,'admin_create_test_subscription',{target_tenant_id:tenant,target_invoice_id:inv}),rpc(manager.client,'admin_create_test_subscription',{target_tenant_id:tenant,target_invoice_id:inv})]);check('concurrent-subscription-'+asset,response[0]===response[1]);sub=response[0];
  const live=await admin.rpc('consume_verified_payment',{target_tenant_id:tenant,target_receipt_id:inv});check('simulation-cannot-live-entitle-'+asset,live.error?.code==='42501');
 }
 let d=await ledger();check('renewal-one-subscription-two-periods',d.subscriptions.length===1&&d.payments.length===2&&d.subscriptions[0].mode==='test');
 const periods=d.payments.toSorted((a,b)=>Date.parse(a.period_start)-Date.parse(b.period_start));check('renewal-extends-from-old-expiry',periods[1].period_start===periods[0].period_end);
 const a=d.access[0];check('automatic-access-request-follows-entitlement',a&&a.mode==='test'&&a.telegram_user_id==='test:12345');
 // Renewal invalidates earlier revision jobs safely; drain bounded stale records.
 for(let n=0;n<6;n++){const claim=await rpc(admin,'entitlement_claim_job',{target_tenant_id:tenant});if(claim){await rpc(admin,'entitlement_complete_job',{target_tenant_id:tenant,target_job_id:claim.id,lease_value:claim.lease_token,result_value:claim.operation==='invite'?{ok:true,invite_reference:'test:invite:'+randomUUID(),expires_at:claim.invite_expires_at}:{ok:true,membership:'left'}});}
  d=await ledger();if(d.access[0].status==='INVITED')break;}
 d=await ledger();check('restricted-test-invitation',d.access[0].status==='INVITED'&&d.access[0].invite_reference.startsWith('test:invite:')&&Date.parse(d.access[0].invite_expires_at)<=Date.now()+901000);
 const bad=await admin.rpc('entitlement_join_request',{target_tenant_id:tenant,target_access_id:a.id,user_id_value:'test:999',invite_value:d.access[0].invite_reference});check('wrong-telegram-account-denied',bad.error?.code==='42501');
 await rpc(admin,'entitlement_join_request',{target_tenant_id:tenant,target_access_id:a.id,user_id_value:'test:12345',invite_value:d.access[0].invite_reference});
 await processJob({ok:true,membership:'member'});d=await ledger();check('test-membership-confirmed',d.access[0].status==='MEMBER');
 const managerUi=await http('/admin/subscriptions',{cookie:manager.cookie()}),accessUi=await http('/admin/channel-access',{cookie:manager.cookie()}),detailUi=await http('/admin/subscriptions/'+sub,{cookie:manager.cookie()}),customerUi=await http('/admin/customers/'+customer,{cookie:manager.cookie()});
 check('authenticated-subscriptions-admin',managerUi.status===200&&managerUi.body.includes('YALNIZCA TEST kabulü'));
 check('authenticated-access-admin',accessUi.status===200&&accessUi.body.includes('test:12345'));
 check('customer360-entitlement-evidence',customerUi.status===200&&customerUi.body.includes('Ödemeler, abonelikler ve VIP'));
 check('customer-journey-preview-truthful',detailUi.status===200&&detailUi.body.includes('YALNIZCA TEST')&&!detailUi.body.includes('href="https://t.me/'));
 const supportUi=await http('/admin/subscriptions',{cookie:support.cookie()}),readonlyUi=await http('/admin/subscriptions',{cookie:readonly.cookie()});
 check('support-read-only-ui',supportUi.status===200&&!supportUi.body.includes('name="invoice_id"'));check('readonly-entitlement-ui-denied',[302,303,307].includes(readonlyUi.status));
 const supportWrite=await support.client.rpc('admin_subscription_control',{target_tenant_id:tenant,target_subscription_id:sub,action_value:'hold',request_id_value:randomUUID()});check('support-control-denied',supportWrite.error?.code==='42501');
 const cross=await manager.client.rpc('admin_entitlement_list',{target_tenant_id:otherTenant});check('cross-tenant-denied',cross.error?.code==='42501');
 await rpc(manager.client,'admin_subscription_control',{target_tenant_id:tenant,target_subscription_id:sub,action_value:'hold',request_id_value:randomUUID()});
 const held=await manager.client.rpc('admin_request_entitlement_access',{target_tenant_id:tenant,target_subscription_id:sub});check('hold-blocks-access',held.error?.code==='42501');
 await processJob({ok:true});d=await ledger();check('hold-revokes-test-membership',d.access[0].status==='REVOKED');
 await rpc(manager.client,'admin_subscription_control',{target_tenant_id:tenant,target_subscription_id:sub,action_value:'release',request_id_value:randomUUID()});await processJob({ok:false});d=await ledger();check('provider-failure-held-for-safe-retry',d.access[0].status==='REVIEW'&&d.jobs.some(j=>j.status==='PENDING'&&j.last_error==='PROVIDER_FAILURE'));
 await rpc(manager.client,'admin_subscription_control',{target_tenant_id:tenant,target_subscription_id:sub,action_value:'cancel',request_id_value:randomUUID()});
 // Pending old revision must never regain access. One stale drain then revoke.
 for(let n=0;n<4;n++){const cancelJob=await rpc(admin,'entitlement_claim_job',{target_tenant_id:tenant});if(cancelJob){await rpc(admin,'entitlement_complete_job',{target_tenant_id:tenant,target_job_id:cancelJob.id,lease_value:cancelJob.lease_token,result_value:{ok:true}});break;}}
 check('cancel-stays-held',(await ledger()).subscriptions[0].state==='CANCELLED');
 const noReceipts=await rpc(admin,'entitlement_conversation_receipts',{target_tenant_id:tenant,target_conversation_id:conversation,boundary_value:new Date().toISOString()});check('simulations-never-ai-action-receipts',noReceipts.length===0);
 await rpc(manager.client,'admin_payment_test_webhook_window',{target_tenant_id:tenant,seconds_value:0});const after=summary();afterEvidence=after;
 check('zero-real-payment-confirmations',after.real_payment_events===0&&baseline.real_payment_events===0);check('zero-paid-transitions',after.paid_customers===baseline.paid_customers&&after.history===baseline.history&&after.fixture_transitions===0);check('zero-live-subscriptions-access',!after.subscription_table&&!after.access_table);check('zero-unauthorized-messages',after.outbound_messages===baseline.outbound_messages);check('sandbox-windows-closed',after.test_windows===0);check('operating-flags-preserved',JSON.stringify(after.operating_flags)===JSON.stringify(baseline.operating_flags)&&JSON.stringify(after.conversation_controls)===JSON.stringify(baseline.conversation_controls));completed=true;
} finally {
 let cleanup=true;
 if(manager){const close=await manager.client.rpc('admin_payment_test_webhook_window',{target_tenant_id:tenant,seconds_value:0});if(close.error)cleanup=false;}
 for(const s of sessions){const {error}=await s.auth.signOut({scope:'global'});if(error)cleanup=false;}
 if(users.length){const {error}=await admin.from('tenant_members').update({status:'disabled'}).eq('tenant_id',tenant);if(error)cleanup=false;}
 for(const id of users){const {error}=await admin.auth.admin.updateUserById(id,{ban_duration:'876000h'});if(error)cleanup=false;}
 const closed=await admin.from('tenants').update({status:'suspended'}).in('id',[tenant,otherTenant]);if(closed.error)cleanup=false;
 const evidence={phase:11,commit:process.env.VALIDATED_SHA,status:completed&&cleanup?'PASS':'INCOMPLETE',checks:results,mode:'test',actual_telegram_api_test:'NOT RUN; owner private staging channel/account authorization required',cleanup_verified:cleanup,integrity:afterEvidence?{real_payment_events:afterEvidence.real_payment_events,paid_customers:afterEvidence.paid_customers,fixture_transitions:afterEvidence.fixture_transitions,outbound_before:baseline.outbound_messages,outbound_after:afterEvidence.outbound_messages}:null,final_flags:{live_payments:false,live_access:false,historical_import:'LOCKED',phase12:false,sandbox_windows:'closed',fixture_tenants:'suspended',fixture_memberships:'disabled',fixture_sessions:'revoked'},cost:{real_funds:0,telegram_api_calls:0,new_paid_services:0,ci_vercel_usage:'not independently metered'}};
 writeFileSync(out,JSON.stringify(evidence,null,2),{mode:0o600});if(!cleanup)throw Error('PHASE11_CLEANUP_NOT_VERIFIED');if(completed)console.log(JSON.stringify({phase:11,status:'PASS',checks:results.length,evidence:'sanitized artifact'}));
}
