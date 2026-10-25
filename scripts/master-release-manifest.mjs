// Read-only inventory. No credential access, network, workflow dispatch, migration application or deployment.
import{readFileSync,statSync}from'node:fs';
import{createHash}from'node:crypto';
import{execFileSync}from'node:child_process';
import{fileURLToPath}from'node:url';
import{masterReleaseInventory,masterReleaseInventorySchema}from'../packages/domain/src/pilot-readiness.ts';
import{parsePolatClaudeJson}from'../packages/domain/src/polat-claude-json.ts';
const root=fileURLToPath(new URL('..',import.meta.url));
try{
 const args=process.argv.slice(2);if(args.length&&!(args.length===2&&args[0]==='--check'))throw Error('INVALID_ARGUMENTS');
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:2*1024*1024});
 const sha=git('rev-parse','HEAD').trim();
 // Read committed blobs, so a dirty working tree can never relabel uncommitted SQL as an accepted SHA.
 const migrations=git('ls-tree','-r','--name-only',sha,'--','supabase/migrations').trim().split('\n').filter(n=>/^supabase\/migrations\/[0-9]{14}_[a-z0-9_]+\.sql$/.test(n)).sort().map(path=>({path,sha256:createHash('sha256').update(git('show',sha+':'+path)).digest('hex')}));
 const expected=masterReleaseInventory(sha,migrations);
 if(args.length){if(!statSync(args[1]).isFile()||statSync(args[1]).size>65536)throw Error('BOUNDED_MANIFEST_REQUIRED');const supplied=masterReleaseInventorySchema.parse(parsePolatClaudeJson(readFileSync(args[1],'utf8'),65536));if(JSON.stringify(supplied)!==JSON.stringify(expected))throw Error('RELEASE_SHA_OR_MIGRATION_DRIFT');process.stdout.write(JSON.stringify({artifact_consistency:'PASS',repository_sha:sha,migrations:migrations.length,hosted_acceptance:'NOT_TESTED',execution_authority:'NONE',commercial_verdict:'NO_GO'})+'\n');}
 else process.stdout.write(JSON.stringify(expected,null,2)+'\n');
}catch{process.stderr.write('MASTER_RELEASE_MANIFEST_INVALID — no source or secret content printed\n');process.exitCode=2;}
