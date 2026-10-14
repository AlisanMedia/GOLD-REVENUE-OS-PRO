import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Deliberately independent of the application, database and live entitlement worker.
export const SCOPE = Object.freeze({ channel: -1003944824067, owner: 6890052501, user: 8327046095, bot: 8673054837, botUsername: 'gold_revenue_os_staging_bot', title: 'Gold Revenue OS — Private Staging' });
export const APPROVAL = 'PHASE11_PRIVATE_STAGING_8327046095';
export function validateScope(me, chat, owner, bot, member) {
  if (me.id !== SCOPE.bot || me.username !== SCOPE.botUsername || me.is_bot !== true) throw Error('BOT_IDENTITY_DENIED');
  if (chat.id !== SCOPE.channel || chat.type !== 'channel' || chat.username || chat.title !== SCOPE.title) throw Error('CHANNEL_SCOPE_DENIED');
  if (owner.user?.id !== SCOPE.owner || owner.status !== 'creator') throw Error('OWNER_IDENTITY_DENIED');
  if (bot.user?.id !== SCOPE.bot || bot.status !== 'administrator' || !bot.can_invite_users || !bot.can_restrict_members) throw Error('BOT_PERMISSIONS_REQUIRED');
  if (['can_promote_members','can_change_info','can_post_messages','can_edit_messages','can_delete_messages','can_manage_video_chats','can_post_stories','can_edit_stories','can_delete_stories','can_manage_direct_messages'].some(k => bot[k] === true)) throw Error('EXCESS_BOT_PERMISSIONS');
  if (member.user?.id !== SCOPE.user || !['member','left','kicked'].includes(member.status)) throw Error('NON_ADMIN_TEST_ACCOUNT_REQUIRED');
}
export function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'invite_link') result.invite_sha256 = createHash('sha256').update(String(entry)).digest('hex');
    else if (['first_name','last_name','photo','bio','text'].includes(key)) continue;
    else if (['id','username','is_bot','status','type','title','user','creator','is_primary','is_revoked','creates_join_request','expire_date','pending_join_request_count','date','message_id','chat','can_be_edited','is_anonymous'].includes(key) || key.startsWith('can_')) result[key] = sanitize(entry);
  }
  return result;
}
export async function run({ token, approval, sha, evidencePath, fetchImpl = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now, waitMs = 300000, mode = 'acceptance' }) {
  if (!token || approval !== APPROVAL || !/^[a-f0-9]{40}$/.test(sha ?? '') || !['preflight','acceptance','final-status'].includes(mode) || waitMs > 300000 || waitMs < 0) throw Error('EXPLICIT_APPROVAL_REQUIRED');
  const evidence = { sha, scope: SCOPE, mode, started_at: new Date(now()).toISOString(), results: [], verdict: 'OPEN', production_effects: 'No application or database writes; no payment or entitlement activation.' };
  const links = new Set();
  let banPending = false;
  const save = async () => { if (evidencePath) await writeFile(evidencePath, JSON.stringify(evidence, null, 2), { mode: 0o600 }); };
  async function call(method, body = {}, allowMissing = false) {
    let response, payload;
    try {
      response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000), redirect: 'error' });
      payload = await response.json();
    } catch { throw Error(`TELEGRAM_TRANSPORT_${method}`); }
    // Never retain provider descriptions, raw request URLs, tokens or invitation URLs.
    const entry = { method, at: new Date(now()).toISOString(), ok: payload.ok === true && response.ok, result: sanitize(payload.result), error_code: payload.ok ? undefined : payload.error_code };
    evidence.results.push(entry); await save();
    if (!entry.ok) {
      if (allowMissing && payload.error_code === 400 && /HIDE_REQUESTER_MISSING|USER_NOT_PARTICIPANT/.test(payload.description ?? '')) return null;
      throw Error(`TELEGRAM_REJECTED_${method}_${payload.error_code ?? 'UNKNOWN'}`);
    }
    return payload.result;
  }
  const membership = id => call('getChatMember', { chat_id: SCOPE.channel, user_id: id });
  async function requireMember(statuses) {
    const value = await membership(SCOPE.user);
    if (value.user?.id !== SCOPE.user || !statuses.includes(value.status)) throw Error('MEMBERSHIP_STATUS_MISMATCH');
    return value;
  }
  async function revoke(link) {
    const result = await call('revokeChatInviteLink', { chat_id: SCOPE.channel, invite_link: link });
    if (result.invite_link !== link || result.is_revoked !== true) throw Error('INVITE_REVOCATION_UNCONFIRMED');
    links.delete(link);
  }
  async function remove() {
    await requireMember(['member']);
    // Set before the request so a response lost after a successful ban still triggers unban cleanup.
    banPending = true;
    if (await call('banChatMember', { chat_id: SCOPE.channel, user_id: SCOPE.user, until_date: Math.floor(now()/1000)+120 }) !== true) throw Error('BAN_UNCONFIRMED');
    await requireMember(['kicked']);
    if (await call('unbanChatMember', { chat_id: SCOPE.channel, user_id: SCOPE.user, only_if_banned: true }) !== true) throw Error('UNBAN_UNCONFIRMED');
    banPending = false;
    await requireMember(['left']);
  }
  async function inviteAndJoin(label) {
    const expiry = Math.floor(now()/1000) + 360;
    const invite = await call('createChatInviteLink', { chat_id: SCOPE.channel, name: `Phase11 ${label}`, expire_date: expiry, creates_join_request: true });
    if (typeof invite.invite_link === 'string') links.add(invite.invite_link);
    if (!/^https:\/\/t\.me\/\+[A-Za-z0-9_-]+$/.test(invite.invite_link ?? '') || invite.creator?.id !== SCOPE.bot || invite.is_primary !== false || invite.is_revoked !== false || invite.creates_join_request !== true || invite.expire_date !== expiry) throw Error('RESTRICTED_INVITE_UNCONFIRMED');
    const sent = await call('sendMessage', { chat_id: SCOPE.user, text: `Phase 11 PRIVATE STAGING TEST — ${label}. Please request to join using this 6-minute link. No payment or production access is involved.\n${invite.invite_link}`, disable_notification: true, protect_content: true });
    if (sent.chat?.id !== SCOPE.user) throw Error('INVITE_RECIPIENT_MISMATCH');
    const end = now() + waitMs;
    do {
      const approved = await call('approveChatJoinRequest', { chat_id: SCOPE.channel, user_id: SCOPE.user }, true);
      if (approved === true) { await requireMember(['member']); await revoke(invite.invite_link); return; }
      await sleep(5000);
    } while (now() < end);
    throw Error(`OWNER_ACTION_REQUIRED_${label}`);
  }
  try {
    const me = await call('getMe');
    const chat = await call('getChat', { chat_id: SCOPE.channel });
    const owner = await membership(SCOPE.owner);
    const bot = await membership(SCOPE.bot);
    const member = await membership(SCOPE.user);
    if (mode === 'final-status') {
      validateScope(me, chat, owner, bot, { ...member, status: 'member' });
      if (member.status !== 'administrator' || member.user?.id !== SCOPE.user) throw Error('ADMIN_PROMOTION_NOT_CONFIRMED');
      evidence.verdict = 'ADMIN_STATUS_VERIFIED';
    } else {
      validateScope(me, chat, owner, bot, member);
      if (mode === 'preflight') evidence.verdict = 'PREFLIGHT_PASS';
      else {
        if (member.status === 'member') await remove();
        else if (member.status === 'kicked') throw Error('PREEXISTING_BAN_REQUIRES_REVIEW');
        await inviteAndJoin('join-test');
        await remove();
        await inviteAndJoin('restore');
        await requireMember(['member']);
        const finalOwner = await membership(SCOPE.owner);
        if (finalOwner.user?.id !== SCOPE.owner || finalOwner.status !== 'creator') throw Error('OWNER_CHANGED');
        evidence.verdict = 'API_CYCLE_PASS_AWAITING_ADMIN_PROMOTION';
      }
    }
  } catch (error) {
    evidence.blocker = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'SANITIZED_EXECUTION_FAILURE';
  } finally {
    const cleanupErrors = [];
    for (const link of links) { try { await revoke(link); } catch { cleanupErrors.push('INVITE_REVOKE_FAILED'); } }
    if (banPending) { try { if (await call('unbanChatMember', { chat_id: SCOPE.channel, user_id: SCOPE.user, only_if_banned: true }) !== true) throw Error(); banPending = false; } catch { cleanupErrors.push('UNBAN_FAILED'); } }
    evidence.cleanup = { outstanding_invites: links.size, temporary_ban_pending: banPending, errors: cleanupErrors };
    if (cleanupErrors.length) evidence.verdict = 'OPEN';
    evidence.finished_at = new Date(now()).toISOString(); await save();
  }
  return evidence;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const evidence = await run({ token: process.env.TELEGRAM_BOT_TOKEN, approval: process.env.PHASE11_APPROVAL, sha: process.env.GITHUB_SHA, evidencePath: process.env.PHASE11_EVIDENCE_FILE, mode: process.env.PHASE11_MODE });
    console.log(JSON.stringify({ verdict: evidence.verdict, blocker: evidence.blocker, cleanup: evidence.cleanup }));
    if (evidence.verdict === 'OPEN') process.exitCode = 1;
  } catch { console.error('PHASE11_CONFIGURATION_DENIED'); process.exitCode = 1; }
}
