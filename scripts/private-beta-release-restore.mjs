import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const identifier = value => {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > 63 || /[\0\r\n]/u.test(value)) throw Error('SOURCE_OWNER_REQUIRED');
  return '"' + value.replaceAll('"', '""') + '"';
};
/** Preserve initdb's public-schema ACL baseline. All actual dump ACL entries remain. */
export function privateBetaRestorePlan(toc, source) {
  if (typeof toc !== 'string' || Buffer.byteLength(toc) > 8388608 || !source || typeof source !== 'object') throw Error('BOUNDED_RESTORE_PLAN_REQUIRED');
  const databaseOwner = source.database_owner, schemaOwner = source.public_schema_owner;
  identifier(databaseOwner); const quoted = identifier(schemaOwner); let skipped = 0;
  const lines = toc.split('\n').map(line => {
    if (/^\d+;\s+\d+\s+\d+\s+SCHEMA\s+-\s+public(?:\s|$)/u.test(line)) { skipped++; return '; ' + line; }
    return line;
  });
  if (skipped !== 1) throw Error('EXACT_PUBLIC_SCHEMA_TOC_REQUIRED');
  return Object.freeze({ toc: lines.join('\n'), owner_sql: 'ALTER SCHEMA public OWNER TO ' + quoted + ';\n', database_owner: databaseOwner, public_schema_owner: schemaOwner, skipped_schema_creation_entries: 1 });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [tocPath, snapshotPath, directory] = process.argv.slice(2);
    if (process.argv.length !== 5 || !directory || statSync(tocPath).size > 8388608 || statSync(snapshotPath).size > 1048576) throw Error('BOUNDED_RESTORE_PLAN_REQUIRED');
    const plan = privateBetaRestorePlan(readFileSync(tocPath, 'utf8'), JSON.parse(readFileSync(snapshotPath, 'utf8')));
    writeFileSync(directory + '/restore.list', plan.toc, { mode: 0o600 });
    writeFileSync(directory + '/restore-owner.sql', plan.owner_sql, { mode: 0o600 });
    writeFileSync(directory + '/restore-plan.json', JSON.stringify({ database_owner: plan.database_owner, public_schema_owner: plan.public_schema_owner, skipped_schema_creation_entries: 1, acl_entries_skipped: 0 }), { mode: 0o600 });
  } catch { process.stderr.write('PRIVATE_BETA_RESTORE_PLAN_INVALID\n'); process.exitCode = 1; }
}
