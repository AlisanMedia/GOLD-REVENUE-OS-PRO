import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { IDENTITY_NAMES_V1 } from '../packages/contracts/src/historical/identity-names-v1.ts';

export const identityCensusPath = 'docs/identity-legacy-reference-inventory.json';
const previous = IDENTITY_NAMES_V1.display.toLowerCase();
const pattern = new RegExp(previous, 'giu');
export function identityLegacyReason(path) {
  if (path === identityCensusPath) return 'Inventory references to the enumerated historical filenames; counts include this inventory itself.';
  if (path === previous.toUpperCase() + '_TO_JEFF_IDENTITY_MIGRATION.md') return 'Owner-required migration note naming the old identity and historical compatibility.';
  if (path.startsWith('supabase/migrations/20261107091336_')) return 'Additive in-place namespace migration, frozen domains, read aliases and old RPC forwarding; no historical row rewrite.';
  if (path.startsWith('supabase/migrations/')) return 'Already-applied immutable historical migration; original file retained.';
  if (path.startsWith('docs/phases/') || path.startsWith('docs/source-of-truth/') || path.startsWith('docs/adr/') || /(?:REPORT|MANIFEST)\.md$/u.test(path)) return 'Accepted historical evidence/design/decision document; not current execution or activation authority.';
  if (path.startsWith('docs/historical/') || path.startsWith('supabase/tests/helpers/historical/') || path.startsWith('packages/contracts/src/historical/')) return 'Explicit frozen historical fixture, serialized alias, hash domain or previous signed header data, retained for continuity.';
  if (path === 'apps/web/next.config.ts') return 'Only the permanent fixed-destination redirect for old Admin bookmarks.';
  if (path === 'vercel.json') return 'Historical branch names remain deployment-disabled; no old active product route or identity.';
  if (path === 'infra/sql/private-beta-recovery-fingerprint.sql') return 'Read-only pre-migration catalog namespace detection; never changes a held program or permits a retry.';
  if (path === 'supabase/tests/helpers/jeff_identity_after.sql') return 'Negative/preservation assertions for immutable pre-rename rows, original ACLs and unrelated people.';
  if (path === 'supabase/tests/private_beta_founder_continuation.test.sql') return 'Production-shaped pre-rename notice fixture; fresh owner continuation normalizes the notice while preserving the original configuration in audit history.';
  if (path === 'tests/integration/jeff-identity-migration.test.ts') return 'Negative source-identity guard and explicit old-route redirect acceptance tests.';
  if (path === '.github/workflows/private-beta-uat.yml' || path === '.github/workflows/staging.yml') return 'Temporary exact old stored secret/variable aliases in protected bootstrap; all runtime environment keys are Jeff.';
  if (['README.md', 'docs/MASTER_PRODUCT_CONTEXT.md', 'docs/NEXT_EXECUTION_BACKLOG.md', 'infra/runbooks/master-genuine-acceptance.md'].includes(path)) return 'Links to preserved historical evidence or the owner-required migration note; current product identity is Jeff.';
  return null;
}
export function buildIdentityCensus() {
  const paths = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0'))].filter(path => path && path !== identityCensusPath && existsSync(path)).sort();
  const entries = [];
  for (const path of paths) {
    const raw = readFileSync(path), value = raw.toString('utf8'), occurrences = [...value.matchAll(pattern)].length;
    if (!occurrences) continue;
    const reason = identityLegacyReason(path);
    if (!reason) throw Error('UNEXPLAINED_LEGACY_IDENTITY:' + path);
    entries.push({ path, occurrences, reason, sha256: createHash('sha256').update(raw).digest('hex') });
  }
  const self = { path: identityCensusPath, occurrences: 0, reason: identityLegacyReason(identityCensusPath), sha256: null };
  const result = { version: 1, baseline: '96aa1c83dab1ffaff0975dfa0f62d33c38c48d8f', scope: 'Case-insensitive content occurrences in tracked and non-ignored source files, including this inventory; Git history and external immutable artifacts excluded.', unexplained: 0, total_occurrences: 0, files: entries.length + 1, entries: [...entries, self] };
  self.occurrences = [...JSON.stringify(result, null, 2).matchAll(pattern)].length;
  result.total_occurrences = entries.reduce((n, row) => n + row.occurrences, self.occurrences);
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const actual = buildIdentityCensus();
  if (process.argv[2] === '--write') writeFileSync(identityCensusPath, JSON.stringify(actual, null, 2) + '\n');
  else if (JSON.stringify(actual) !== JSON.stringify(JSON.parse(readFileSync(identityCensusPath, 'utf8')))) throw Error('IDENTITY_CENSUS_CHANGED_REVIEW_REQUIRED');
  console.log(JSON.stringify({ total_occurrences: actual.total_occurrences, files: actual.files, unexplained: actual.unexplained }));
}
