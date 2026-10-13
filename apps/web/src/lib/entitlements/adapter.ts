import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
export const accessJobSchema=z.object({id:z.uuid(),tenant_id:z.uuid(),subscription_id:z.uuid(),lease_token:z.uuid(),mode:z.enum(["test","live"]),operation:z.enum(["invite","join","revoke","reconcile"]),telegram_user_id:z.string(),chat_id:z.string(),invite_reference:z.string().nullable(),invite_expires_at:z.string()});
export type AccessJob=z.infer<typeof accessJobSchema>;
export type AccessResult={ok:boolean;invite_reference?:string;expires_at?:string;membership?:"member"|"left"|"kicked"};
export interface TelegramAccessAdapter { execute(job:AccessJob):Promise<AccessResult> }
export class TestTelegramAccessAdapter implements TelegramAccessAdapter {
 constructor(private readonly scenario:"success"|"failure"|"missing"="success"){}
 async execute(job:AccessJob):Promise<AccessResult>{
  if(job.mode!=="test"||!/^test:\d+$/u.test(job.telegram_user_id)||!job.chat_id.startsWith("test:"))throw Error("TEST_ACCESS_SCOPE_DENIED");
  if(this.scenario==="failure")return {ok:false};
  if(job.operation==="invite")return {ok:true,invite_reference:"test:invite:"+randomUUID(),expires_at:job.invite_expires_at};
  if(job.operation==="revoke")return {ok:true};return {ok:true,membership:this.scenario==="missing"?"left":"member"};
 }
}
// Dormant real API adapter. Its allowlist is server-owned and never derived from browser/AI input.
// Not registered by the deployed worker: no real channel/API test is claimed.
export class AuthorizedTelegramAccessAdapter implements TelegramAccessAdapter {
 constructor(private readonly config:{enabled:boolean;botToken:string;botUserId:string;channelId:string;userId:string;ownerApproval:string},private readonly transport:typeof fetch=fetch){}
 private async call(method:string,body:Record<string,unknown>):Promise<unknown>{
  try {const r=await this.transport(`https://api.telegram.org/bot${this.config.botToken}/${method}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(10000),cache:"no-store"});const p=z.object({ok:z.boolean(),result:z.unknown().optional()}).parse(await r.json());if(!r.ok||!p.ok)throw Error();return p.result;}catch{throw Error("TELEGRAM_ACCESS_PROVIDER_FAILURE");}
 }
 async execute(job:AccessJob):Promise<AccessResult>{
  if(!this.config.enabled||!this.config.ownerApproval||job.mode!=="live"||job.chat_id!==this.config.channelId||job.telegram_user_id!==this.config.userId||!/^-[1-9]\d+$/u.test(job.chat_id)||!/^\d+$/u.test(job.telegram_user_id))throw Error("TELEGRAM_ACCESS_NOT_AUTHORIZED");
  const chat=z.object({type:z.literal("channel"),username:z.string().optional()}).parse(await this.call("getChat",{chat_id:job.chat_id}));if(chat.username)throw Error("PRIVATE_CHANNEL_REQUIRED");
  z.object({status:z.literal("administrator"),can_invite_users:z.literal(true),can_restrict_members:z.literal(true)}).parse(await this.call("getChatMember",{chat_id:job.chat_id,user_id:this.config.botUserId}));
  if(job.operation==="invite"){
   await this.call("unbanChatMember",{chat_id:job.chat_id,user_id:job.telegram_user_id,only_if_banned:true});
   const expiry=Math.floor(Date.parse(job.invite_expires_at)/1000);if(!Number.isFinite(expiry)||expiry<=Date.now()/1000||expiry>Date.now()/1000+901)throw Error("INVALID_INVITE_EXPIRY");
   const link=z.object({invite_link:z.string().regex(/^https:\/\/t\.me\/\+[A-Za-z0-9_-]+$/u),creates_join_request:z.literal(true),is_primary:z.literal(false),is_revoked:z.literal(false),expire_date:z.number().int()}).parse(await this.call("createChatInviteLink",{chat_id:job.chat_id,name:job.id.slice(0,32),expire_date:expiry,creates_join_request:true}));if(link.expire_date!==expiry)throw Error("INVITE_EXPIRY_MISMATCH");return {ok:true,invite_reference:link.invite_link,expires_at:new Date(expiry*1000).toISOString()};
  }
  if(job.operation==="revoke"){
   if(job.invite_reference)await this.call("revokeChatInviteLink",{chat_id:job.chat_id,invite_link:job.invite_reference});
   if(await this.call("banChatMember",{chat_id:job.chat_id,user_id:job.telegram_user_id})!==true)throw Error("REVOKE_NOT_CONFIRMED");return {ok:true};
  }
  if(job.operation==="join"){
   if(await this.call("approveChatJoinRequest",{chat_id:job.chat_id,user_id:job.telegram_user_id})!==true)throw Error("JOIN_NOT_CONFIRMED");
   if(job.invite_reference)await this.call("revokeChatInviteLink",{chat_id:job.chat_id,invite_link:job.invite_reference});
  }
  const member=z.object({status:z.string(),user:z.object({id:z.number().int()})}).parse(await this.call("getChatMember",{chat_id:job.chat_id,user_id:job.telegram_user_id}));if(String(member.user.id)!==job.telegram_user_id)throw Error("TELEGRAM_IDENTITY_MISMATCH");
  if(!["member","left","kicked"].includes(member.status))throw Error("MEMBERSHIP_REVIEW_REQUIRED");return {ok:true,membership:member.status as "member"|"left"|"kicked"};
 }
}
