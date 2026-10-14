import { describe, it, expect } from 'vitest';
// Standalone script intentionally has no production application imports.
// @ts-expect-error JavaScript administrative executable
import { run, SCOPE, APPROVAL, validateScope, sanitize } from '../../scripts/phase11-telegram-acceptance.mjs';
const me={id:8673054837,username:'gold_revenue_os_staging_bot',is_bot:true};
const chat={id:-1003944824067,type:'channel',title:'Gold Revenue OS — Private Staging'};
const owner={user:{id:6890052501},status:'creator'};
const bot={user:{id:8673054837},status:'administrator',can_invite_users:true,can_restrict_members:true};
const member={user:{id:8327046095},status:'member'};
describe('isolated Telegram acceptance scope',()=>{
 it('requires exact channel, bot, owner and non-admin target',()=>{
  expect(()=>validateScope(me,chat,owner,bot,member)).not.toThrow();
  for(const altered of [{...chat,id:-1001},{...chat,username:'public'},{...chat,type:'group'}]) expect(()=>validateScope(me,altered,owner,bot,member)).toThrow();
  expect(()=>validateScope({...me,id:1},chat,owner,bot,member)).toThrow();
  expect(()=>validateScope(me,chat,{...owner,status:'administrator'},bot,member)).toThrow();
  expect(()=>validateScope(me,chat,owner,{...bot,can_promote_members:true},member)).toThrow();
  for(const value of [{...member,status:'administrator'},{...member,user:{id:6890052501}}]) expect(()=>validateScope(me,chat,owner,bot,value)).toThrow();
 });
 it('redacts invitation URLs, message contents and names',()=>{
  const result=JSON.stringify(sanitize({invite_link:'https://t.me/+secret',text:'secret',user:{id:1,first_name:'private'},token:'secret'}));
  expect(result).not.toContain('secret');expect(result).not.toContain('private');expect(result).toContain('invite_sha256');
 });
 it('does not call provider without explicit approval',async()=>{
  let calls=0;
  await expect(run({token:'synthetic',approval:'wrong',sha:'a'.repeat(40),fetchImpl:()=>{calls++;}})).rejects.toThrow();
  expect(calls).toBe(0);
 });
 it('executes real-method sequence only for the fixed subscriber and restores membership',async()=>{
  let status='member';let invite=0;const calls:Array<{method:string;body:Record<string,unknown>}>=[];
  const result=await run({token:'synthetic',approval:APPROVAL,sha:'a'.repeat(40),sleep:async()=>{},fetchImpl:async(url:string,options:{body:string})=>{
   const method=url.split('/').at(-1)!;const body=JSON.parse(options.body);calls.push({method,body});let value:unknown;
   if(method==='getMe') value=me;
   else if(method==='getChat') value=chat;
   else if(method==='getChatMember') value=body.user_id===SCOPE.owner?owner:body.user_id===SCOPE.bot?bot:{...member,status};
   else if(method==='banChatMember'){status='kicked';value=true;}
   else if(method==='unbanChatMember'){status='left';value=true;}
   else if(method==='createChatInviteLink')value={invite_link:`https://t.me/+synthetic${++invite}`,creator:me,is_primary:false,is_revoked:false,creates_join_request:true,expire_date:body.expire_date};
   else if(method==='sendMessage')value={message_id:1,chat:{id:SCOPE.user},text:'private'};
   else if(method==='approveChatJoinRequest'){status='member';value=true;}
   else if(method==='revokeChatInviteLink')value={invite_link:body.invite_link,is_revoked:true};
   else throw Error('Unexpected method');
   return {ok:true,json:async()=>({ok:true,result:value})};
  }});
  expect(result.verdict).toBe('API_CYCLE_PASS_AWAITING_ADMIN_PROMOTION');
  expect(result.cleanup).toEqual({outstanding_invites:0,temporary_ban_pending:false,errors:[]});
  expect(calls.filter(c=>c.method==='banChatMember')).toHaveLength(2);
  expect(calls.filter(c=>c.method==='approveChatJoinRequest')).toHaveLength(2);
  for(const c of calls.filter(c=>['banChatMember','unbanChatMember','approveChatJoinRequest'].includes(c.method))) expect(c.body.user_id).toBe(SCOPE.user);
  expect(JSON.stringify(result)).not.toContain('https://t.me/');
 });
 it('unbans after an uncertain ban response and never claims success',async()=>{
  const methods:string[]=[];
  const result=await run({token:'synthetic',approval:APPROVAL,sha:'a'.repeat(40),fetchImpl:async(url:string,options:{body:string})=>{
   const method=url.split('/').at(-1)!;const body=JSON.parse(options.body);methods.push(method);
   if(method==='banChatMember')throw Error('secret transport details');
   const value=method==='getMe'?me:method==='getChat'?chat:method==='unbanChatMember'?true:body.user_id===SCOPE.owner?owner:body.user_id===SCOPE.bot?bot:member;
   return {ok:true,json:async()=>({ok:true,result:value})};
  }});
  expect(result.verdict).toBe('OPEN');expect(methods.at(-1)).toBe('unbanChatMember');
  expect(JSON.stringify(result)).not.toContain('secret transport');
 });
});
