// Node24, offline only. No deployment, network, writer, or activation path.
import {readFileSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assessPilotReadiness,pilotSnapshotSchema,pilotReadinessMarkdown} from '../packages/domain/src/pilot-readiness.ts';
import {parseFinancialJson,canonicalFinancialJson} from '../packages/domain/src/financial-source-canonical.ts';
try{
 const args=process.argv.slice(2);if(args.length!==4||args[0]!=='--snapshot'||args[2]!=='--branch'||!/^[A-Za-z0-9._/-]{1,200}$/.test(args[3]))throw Error();
 const cwd=fileURLToPath(new URL('..',import.meta.url));
 const path=args[1];if(!statSync(path).isFile()||statSync(path).size>16384)throw Error();
 const snapshot=pilotSnapshotSchema.parse(parseFinancialJson(readFileSync(path)));
 const git=(...argv)=>execFileSync('git',argv,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const target=git('rev-parse','HEAD'),policy=JSON.parse(readFileSync(cwd+'/vercel.json','utf8'));
 const before=JSON.parse(git('show',snapshot.main_sha+':vercel.json'));
 const withoutBranch=structuredClone(policy);delete withoutBranch.git.deploymentEnabled[args[3]];
 const preserved=canonicalFinancialJson(before)===canonicalFinancialJson(policy)||canonicalFinancialJson(before)===canonicalFinancialJson(withoutBranch);
 const report=assessPilotReadiness(snapshot,{target_sha:target,working_tree_clean:git('status','--porcelain')==='',branch_deployment_disabled:policy.git?.deploymentEnabled?.[args[3]]===false,main_deployment_disabled:policy.git?.deploymentEnabled?.main===false,deployment_policy_preserved:preserved},new Date().toISOString());
 process.stdout.write(pilotReadinessMarkdown(report));
 // Producing a NO-GO assessment is a successful report, never release authority.
}catch{process.stderr.write('PILOT_READINESS_INPUT_INVALID — no source content printed\n');process.exitCode=2;}
