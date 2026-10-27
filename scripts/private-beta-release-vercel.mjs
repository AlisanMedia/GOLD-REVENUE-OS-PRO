import { writeFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PRIVATE_BETA_VERCEL = Object.freeze({ team: 'team_fOlNA2ASqhGzUplTDUFGCEDM', project: 'prj_iax5OhGUbLL3s6BemMLqQAHFDAHl', name: 'gold-revenue-os-staging', aliases: ['gold-revenue-os-staging.vercel.app', 'gold-revenue-os-staging-gold-revenue-os-staging.vercel.app'] });
const assert = (condition, code) => { if (!condition) throw Error(code); };
export function validatePrivateBetaVercelProject(project, team) {
  assert(project?.id === PRIVATE_BETA_VERCEL.project && project.name === PRIVATE_BETA_VERCEL.name && project.accountId === PRIVATE_BETA_VERCEL.team && team?.id === PRIVATE_BETA_VERCEL.team && team.slug === PRIVATE_BETA_VERCEL.name, 'EXACT_ISOLATED_STAGING_REQUIRED');
  assert(project.ssoProtection?.enabled === true && project.ssoProtection.deploymentType === 'all_except_custom_domains', 'EXISTING_SSO_REQUIRED');
  assert(project.link?.type === 'github' && project.link.org === 'AlisanMedia' && project.link.repo === 'GOLD-REVENUE-OS-PRO', 'EXISTING_GITHUB_CONNECTION_REQUIRED');
  return Object.freeze({ id: project.id, name: project.name, account_id: project.accountId, team_slug: team.slug, sso: project.ssoProtection, git: { type: 'github', org: project.link.org, repo: project.link.repo }, prior_deployment: project.targets?.production?.id ?? null });
}
/** Build sees no model key, Telegram credential, account admin key, relay or backup passphrase. */
export function privateBetaBuildEnvironment(env) {
  assert(env.NEXT_PUBLIC_SUPABASE_URL === 'https://xqvwkghpmezcpgugetqc.supabase.co' && typeof env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY === 'string' && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.length >= 20, 'EXACT_STAGING_BUILD_CONFIGURATION_REQUIRED');
  return ['NEXT_PUBLIC_APP_URL=' + JSON.stringify('https://gold-revenue-os-staging.vercel.app'), 'NEXT_PUBLIC_SUPABASE_URL=' + JSON.stringify(env.NEXT_PUBLIC_SUPABASE_URL), 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=' + JSON.stringify(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)].join('\n') + '\n';
}
export function validatePrivateBetaDeployment(deployment, sha) {
  assert(typeof sha === 'string' && /^[a-f0-9]{40}$/u.test(sha), 'ACCEPTED_SHA_REQUIRED');
  assert((deployment?.projectId ?? deployment?.project?.id) === PRIVATE_BETA_VERCEL.project && deployment.name === PRIVATE_BETA_VERCEL.name && deployment.target === 'production' && (deployment.readyState ?? deployment.state) === 'READY', 'READY_ISOLATED_STAGING_REQUIRED');
  assert((deployment.gitSource?.sha ?? deployment.meta?.githubCommitSha) === sha, 'DEPLOYED_SHA_MISMATCH');
  return Object.freeze({ id: deployment.id, url: deployment.url, sha, state: 'READY', technical_target: 'production', commercial_production: false });
}
async function api(path, token, method = 'GET', body) {
  const response = await fetch('https://api.vercel.com' + path + (path.includes('?') ? '&' : '?') + 'teamId=' + PRIVATE_BETA_VERCEL.team, { method, redirect: 'error', signal: AbortSignal.timeout(15000), headers: { authorization: 'Bearer ' + token, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert(response.ok, 'VERCEL_CONTROL_READ_OR_WRITE_UNAVAILABLE');
  const raw = await response.text(); assert(Buffer.byteLength(raw) <= 1048576, 'VERCEL_RESPONSE_BOUND'); return JSON.parse(raw);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [command] = process.argv.slice(2), env = process.env;
    assert(process.argv.length === 3 && ['baseline', 'build-env', 'runtime-env', 'staged', 'published'].includes(command), 'RELEASE_COMMAND_INVALID');
    assert(env.GITHUB_REPOSITORY === 'AlisanMedia/GOLD-REVENUE-OS-PRO' && env.GITHUB_REF === 'refs/heads/main' && env.VERCEL_ORG_ID === PRIVATE_BETA_VERCEL.team && env.VERCEL_PROJECT_ID === PRIVATE_BETA_VERCEL.project && env.RUNNER_TEMP, 'PROTECTED_EXACT_TARGET_REQUIRED');
    assert(env.VALIDATED_SHA === env.GITHUB_SHA && /^[a-f0-9]{40}$/u.test(env.VALIDATED_SHA ?? ''), 'EXACT_RELEASE_SHA_REQUIRED');
    if (command === 'build-env') {
      writeFileSync('.vercel/.env.production.local', privateBetaBuildEnvironment(env), { mode: 0o600 });
    } else {
      assert(env.VERCEL_TOKEN, 'PROTECTED_VERCEL_CREDENTIAL_REQUIRED');
      const [project, team] = await Promise.all([api('/v9/projects/' + PRIVATE_BETA_VERCEL.project, env.VERCEL_TOKEN), api('/v2/teams/' + PRIVATE_BETA_VERCEL.team, env.VERCEL_TOKEN)]);
      const identity = validatePrivateBetaVercelProject(project, team);
      if (command === 'baseline') writeFileSync(env.RUNNER_TEMP + '/private-beta-vercel-before.json', JSON.stringify(identity, null, 2) + '\n', { mode: 0o600 });
      else if (command === 'runtime-env') {
        const required = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY'];
        privateBetaBuildEnvironment(env); assert(required.every(k => env[k]), 'STAGING_RUNTIME_CONFIGURATION_REQUIRED');
        // This closed allowlist never transfers account-admin, backup, unrelated bot or production secrets.
        const optional = ['OPENAI_API_KEY', 'POLAT_UAT_ANTHROPIC_API_KEY', 'POLAT_UAT_TELEGRAM_BOT_TOKEN', 'POLAT_UAT_TELEGRAM_WEBHOOK_SECRET', 'POLAT_UAT_RELAY_SECRET', 'POLAT_UAT_STARS_TEST_BOT_TOKEN', 'POLAT_UAT_STARS_TEST_WEBHOOK_SECRET', 'POLAT_UAT_STARS_RELAY_SECRET'];
        const ids = ['POLAT_UAT_TENANT_ID', 'POLAT_UAT_PROGRAM_ID'];
        assert(ids.every(k => !env[k]) || ids.every(k => /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(env[k] ?? '')), 'UAT_SCOPE_CONFIGURATION_INVALID');
        const names = ['NEXT_PUBLIC_APP_URL', ...required, ...optional.filter(k => env[k]), ...ids.filter(k => env[k]), 'POLAT_UAT_RELEASE_SHA'];
        for (const key of names) await api('/v10/projects/' + PRIVATE_BETA_VERCEL.project + '/env?upsert=true', env.VERCEL_TOKEN, 'POST', { key, value: key === 'NEXT_PUBLIC_APP_URL' ? 'https://gold-revenue-os-staging.vercel.app' : key === 'POLAT_UAT_RELEASE_SHA' ? env.VALIDATED_SHA : env[key], type: key.startsWith('NEXT_PUBLIC_') || ids.includes(key) || key === 'POLAT_UAT_RELEASE_SHA' ? 'plain' : 'sensitive', target: ['production'] });
        writeFileSync(env.RUNNER_TEMP + '/private-beta-runtime-env-names.json', JSON.stringify({ project: identity.id, target: 'isolated_staging_production_target', updated_names: names, external_requests_enabled_by_configuration: false, account_admin_credential_copied: false }, null, 2) + '\n', { mode: 0o600 });
      } else {
        const url = new URL(env.PRIVATE_BETA_DEPLOYMENT_URL ?? '');
        assert(url.protocol === 'https:' && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash && url.hostname.endsWith('.vercel.app'), 'FIXED_VERCEL_DEPLOYMENT_REQUIRED');
        const deployment = await api('/v13/deployments/' + encodeURIComponent(url.hostname), env.VERCEL_TOKEN), observed = validatePrivateBetaDeployment(deployment, env.VALIDATED_SHA);
        const before = JSON.parse(readFileSync(env.RUNNER_TEMP + '/private-beta-vercel-before.json', 'utf8'));
        assert(JSON.stringify(identity.sso) === JSON.stringify(before.sso) && JSON.stringify(identity.git) === JSON.stringify(before.git), 'SSO_OR_GIT_DRIFT');
        if (command === 'published') for (const name of PRIVATE_BETA_VERCEL.aliases) {
          const alias = await api('/v4/aliases/' + encodeURIComponent(name), env.VERCEL_TOKEN);
          assert((alias.deploymentId ?? alias.deployment?.id) === observed.id && (alias.projectId === undefined || alias.projectId === PRIVATE_BETA_VERCEL.project), 'CANONICAL_ALIAS_MISMATCH');
        }
        writeFileSync(env.RUNNER_TEMP + '/private-beta-vercel-' + command + '.json', JSON.stringify({ ...observed, sso: identity.sso, git: identity.git, ...(command === 'published' ? { canonical_aliases: PRIVATE_BETA_VERCEL.aliases } : {}), real_model_requests: 0, telegram_sends: 0, financial_authority: 'NONE', commercial_pilot: 'NO_GO' }, null, 2) + '\n', { mode: 0o600 });
      }
    }
    process.stdout.write('PASS: ' + command + ' exact isolated staging boundary; no provider inference or Telegram action.\n');
  } catch (error) { process.stderr.write('PRIVATE_BETA_RELEASE_BLOCKED: ' + (error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message) ? error.message : 'VERCEL_CONTROL_UNAVAILABLE') + '\n'); process.exitCode = 1; }
}
