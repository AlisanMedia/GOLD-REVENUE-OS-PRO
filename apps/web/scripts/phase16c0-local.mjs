// Local/CI synthetic HTTP acceptance ONLY. No hosted/staging fallback or provider.
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const dbUrl=process.env.PHASE16C0_LOCAL_DB_URL||process.env.PHASE10_LOCAL_DB_URL;
const base=process.env.PHASE16C0_LOCAL_APP_URL||process.env.PHASE10_LOCAL_APP_URL;
const api=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,secret=process.env.SUPABASE_SECRET_KEY;
const out=process.env.PHASE16C0_EVIDENCE_FILE||process.env.PHASE11_EVIDENCE_FILE;
if(!dbUrl||!base||!api||!key||!secret||!out||![dbUrl,base,api].every(v=>new URL(v).hostname==='127.0.0.1'))throw Error('PHASE16C0_LOCAL_ONLY');
const admin=createClient(api,secret,{auth:{persistSession:false,autoRefreshToken:false}}),run=randomUUID(),checks=[],users=[],sessions=[];
const mapped=s=>s.replace(/\b(?:e3|ec)[0-9a-f]{6}(?=-)/gu,p=>createHash('sha256').update(run+p).digest('hex').slice(0,8));
const tenant=mapped('e3200000-0000-4000-8000-000000000001'),other=mapped('e3200000-0000-4000-8000-000000000002');
const customer=mapped('ec020000-0000-4000-8000-000000000001'),oldest=mapped('ec030000-0000-4000-8000-000000000321');
const sql=text=>execFileSync('psql',[dbUrl,'-v','ON_ERROR_STOP=1','-Atq'],{input:text,encoding:'utf8',maxBuffer:8*1024*1024}).trim();
const check=(name,pass)=>{if(!pass)throw Error('PHASE16C0_ACCEPTANCE_FAILED:'+name);checks.push({name,status:'PASS'});};
function invariant(){return JSON.parse(sql(`select jsonb_build_object('live_subscriptions',(select count(*) from public.subscriptions where mode='live'),'live_access',(select count(*) from public.channel_access where mode='live'),'receipts',(select count(*) from private.verified_payment_receipts),'payment_confirmations',(select count(*) from public.domain_events where event_type='payment.confirmed'),'outbound',(select count(*) from public.messages where direction='outbound'),'manager_sent',(select count(*) from public.escalation_notifications where status='SENT'),'imports',(select count(*) from public.import_batches),'live_controls',(select count(*) from private.entitlement_controls where live_enabled));`));}
function readIntegrity(){return sql(`select jsonb_build_object('subscriptions',(select md5(string_agg(to_jsonb(x)::text,'' order by id)) from public.subscriptions x),'periods',(select md5(string_agg(to_jsonb(x)::text,'' order by id)) from public.subscription_payments x),'access',(select md5(string_agg(to_jsonb(x)::text,'' order by id)) from public.channel_access x),'jobs',(select md5(string_agg(to_jsonb(x)::text,'' order by id)) from public.entitlement_jobs x),'audit',(select md5(string_agg(to_jsonb(x)::text,'' order by id)) from public.entitlement_audit x));`);}
async function identity(role){const email=`bounded-${role}-${run}@example.test`,password=randomBytes(30).toString('base64url')+'Aa1!';
 const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true,role:'authenticated'});if(error)throw Error('LOCAL_AUTH_CREATE_FAILED');users.push(data.user.id);
 sql(`insert into public.tenant_members(tenant_id,user_id,role) values('${tenant}','${data.user.id}','${role}');`);
 let cookies=[];const client=createServerClient(api,key,{cookies:{getAll:()=>cookies,setAll:values=>{for(const v of values){cookies=cookies.filter(c=>c.name!==v.name);cookies.push(v);}}}});
 const login=await client.auth.signInWithPassword({email,password});if(login.error)throw Error('LOCAL_LOGIN_FAILED');sessions.push(client);
 return {id:data.user.id,client,cookie:()=>cookies.map(c=>`${c.name}=${c.value}`).join('; ')};
}
async function http(path,who){const r=await fetch(new URL(path,base),{headers:{cookie:who.cookie()},redirect:'manual',signal:AbortSignal.timeout(25000)});return {status:r.status,body:await r.text(),cacheControl:r.headers.get('cache-control')};}
const nextLink=body=>body.match(/<a\b[^>]*href="([^"<>]*cursor=[^"<>]+)"/u)?.[1]?.replaceAll('&amp;','&');
const subscriptions=body=>new Set([...body.matchAll(/href="\/admin\/subscriptions\/([a-f0-9-]{36})(?:\?|"|&)/gu)].map(x=>x[1]));
function preview(name,body){const dir=process.env.PHASE16C0_PREVIEW_DIR;if(!dir)return;mkdirSync(dir,{recursive:true});
 const safe=body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gu,'').replace('<head>','<head><base href="'+base+'/">');
 if(safe.includes('test:invite:PRIVATE')||safe.includes('lease_token'))throw Error('UNSAFE_PREVIEW_REJECTED');
 writeFileSync(dir+'/http-'+name+'.html',safe,{mode:0o600});
}
let seeded=false,done=false,cleanup=true,before;
try{
 before=invariant();
 const files=['phase11_fixtures.sql','phase16c0_fixtures.sql'].map(f=>readFileSync(new URL('../../../supabase/tests/helpers/'+f,import.meta.url),'utf8')).join('\n');
 const fixtures=mapped(files).replaceAll('phase11-sandbox-a','phase11-sandbox-a-'+run).replaceAll('phase11-sandbox-b','phase11-sandbox-b-'+run)
  .replaceAll('@example.test','+'+run+'@example.test').replaceAll('test:bounded:','test:bounded:'+run+':');
 sql('begin;\n'+fixtures+'\ncommit;');seeded=true;
 const manager=await identity('manager'),support=await identity('support'),analyst=await identity('analyst'),viewer=await identity('readonly');
 const readBefore=readIntegrity();
 const first=await http('/admin/subscriptions',manager);check('authenticated-subscriptions-tr',first.status===200&&first.body.includes('Abonelikler'));
 check('privileged-http-response-not-shared-cached',first.cacheControl?.includes('private')&&first.cacheControl?.includes('no-store'));
 check('first-page-only-25-subscriptions',subscriptions(first.body).size===25);
 const next=nextLink(first.body);check('next-cursor-visible',Boolean(next));
 const second=await http(next,manager);check('second-page-no-duplicate-subscriptions',second.status===200&&subscriptions(second.body).size===25&&![...subscriptions(first.body)].some(id=>subscriptions(second.body).has(id)));
 const detail=await http('/admin/subscriptions/'+oldest,manager);check('direct-detail-outside-first-100',detail.status===200&&detail.body.includes('Second synthetic plan'));
 check('customer-preview-English-under-Turkish-admin',detail.body.includes('lang="en"')&&detail.body.includes('This preview creates no real membership, payment or Telegram access.'));
 const scoped=await http('/admin/subscriptions?customer='+customer,manager);check('customer-filter-two-plans',scoped.status===200&&subscriptions(scoped.body).size===2);
 const customerPage=await http('/admin/customers/'+customer,manager);check('customer360-subscription-widget',customerPage.status===200&&customerPage.body.includes('Ödemeler, abonelikler ve VIP')&&customerPage.body.includes(oldest));
 const access=await http('/admin/channel-access',manager);check('channel-access-page-and-bounded-jobs-link',access.status===200&&access.body.includes('evidence=jobs'));
 preview('subscriptions-tr-TR',first.body);preview('detail-tr-TR',detail.body);preview('access-tr-TR',access.body);preview('customer-tr-TR',customerPage.body);
 check('no-private-invitation-in-rendered-pages',![first,second,detail,access,customerPage].some(p=>p.body.includes('test:invite:PRIVATE')||p.body.includes('lease_token')));
 const subscriptionId=mapped('ec030000-0000-4000-8000-000000000001');
 for(const evidence of ['payments','jobs','audit','access']){const p=await http('/admin/subscriptions/'+subscriptionId+'?evidence='+evidence,manager);check('detail-'+evidence+'-bounded-evidence',p.status===200&&p.body.includes('Abonelik kanıtları'));}
 const bad=await http('/admin/subscriptions?cursor=bad!',manager);check('invalid-cursor-readable-error',bad.status===200&&bad.body.includes('Sayfa bağlantısı geçersiz'));
 const replay=await http(next+'&customer='+customer,manager);check('cursor-cannot-cross-customer-filter',replay.status===200&&replay.body.includes('Sayfa bağlantısı geçersiz'));
 const supportPage=await http('/admin/subscriptions',support);check('support-read-without-management-forms',supportPage.status===200&&!supportPage.body.includes('name="invoice_id"')&&!supportPage.body.includes('name="action"'));
 const readonlyPage=await http('/admin/subscriptions',viewer);check('readonly-denied',readonlyPage.status>=300&&readonlyPage.status<400);
 for(const role of [support,analyst]){const d=await role.client.rpc('admin_entitlement_page_v1',{target_tenant_id:tenant,collection_value:'access'});check((role===support?'support':'analyst')+'-no-raw-invitation',!d.error&&d.data.items.every(x=>x.invite_reference===null));if(role===analyst)check('analyst-no-Telegram-identity',d.data.items.every(x=>x.telegram_user_id===null&&x.chat_id===null));}
 const lease=await manager.client.from('entitlement_jobs').select('lease_token').limit(1);check('raw-lease-read-denied',lease.error?.code==='42501');
 const foreign=await manager.client.rpc('admin_entitlement_page_v1',{target_tenant_id:other});check('cross-tenant-rpc-denied',foreign.error?.code==='42501');
 const preference=await manager.client.from('admin_preferences').upsert({user_id:manager.id,locale:'en-US'},{onConflict:'user_id'});check('per-account-English-preference-saved',!preference.error);
 const english=await http('/admin/subscriptions',manager);check('English-operator-pagination',english.status===200&&english.body.includes('Next records')&&english.body.includes('View payment periods'));
 const supportTr=await http('/admin/subscriptions',support);check('other-account-remains-Turkish',supportTr.body.includes('Sonraki kayıtlar'));
 const englishDetail=await http('/admin/subscriptions/'+oldest,manager);check('customer-English-independent-of-admin-English',englishDetail.body.includes('lang="en"')&&englishDetail.body.includes('This preview creates no real membership, payment or Telegram access.'));
 preview('subscriptions-en-US',english.body);preview('detail-en-US',englishDetail.body);
 if(process.env.PHASE16C0_PREVIEW_DIR){preview('access-en-US',(await http('/admin/channel-access',manager)).body);preview('customer-en-US',(await http('/admin/customers/'+customer,manager)).body);}
 const absent=await http('/admin/subscriptions/'+randomUUID(),manager);check('missing-direct-detail-honest-not-found',absent.status===404);
 check('read-only-business-evidence-integrity',readIntegrity()===readBefore);
 check('zero-financial-access-outbound-import-activation',JSON.stringify(invariant())===JSON.stringify(before));
 done=true;
}finally{
 for(const client of sessions){const r=await client.auth.signOut({scope:'global'});if(r.error)cleanup=false;}
 if(seeded){try{sql(`update public.tenant_members set status='disabled' where tenant_id in ('${tenant}','${other}');update public.tenants set status='suspended' where id in ('${tenant}','${other}');`);}catch{cleanup=false;}}
 for(const id of users){const r=await admin.auth.admin.updateUserById(id,{ban_duration:'876000h'});if(r.error)cleanup=false;}
 const record={phase:'16C-0',status:done&&cleanup?'PASS':'INCOMPLETE',commit:process.env.VALIDATED_SHA??'local-uncommitted',checks,cleanup_verified:cleanup,scope:'LOCAL_SYNTHETIC_ONLY',providers:'NOT CALLED',deployments:'NOT CREATED',financial_access_outbound_import_invariants:done};
 const existing=existsSync(out)?JSON.parse(readFileSync(out,'utf8')):{};writeFileSync(out,JSON.stringify({...existing,phase16c0:record},null,2),{mode:0o600});
 if(!cleanup)throw Error('PHASE16C0_LOCAL_CLEANUP_FAILED');
 if(done)console.log(JSON.stringify({phase:'16C-0',status:'PASS',checks:checks.length,cleanup:true,providers:0,deployments:0}));
}
