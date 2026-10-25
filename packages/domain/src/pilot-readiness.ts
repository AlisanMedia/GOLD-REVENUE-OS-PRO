import { z } from "zod";

// Offline evidence consistency, never a release/merchant/financial authority.
export const PILOT_GATES=["C01","C02","C03","C04","C05","C06","C07","C08","C09","C10"] as const;
const sha=z.string().regex(/^[a-f0-9]{40}$/u);
const checkName=z.enum(["Application","Database"]);
const checkSchema=z.strictObject({name:checkName,id:z.number().int().positive(),run_id:z.number().int().positive(),app_id:z.number().int().positive(),head_sha:sha,
 status:z.enum(["queued","in_progress","completed"]),conclusion:z.enum(["success","failure","cancelled","skipped","neutral","timed_out","action_required","stale"]).nullable(),
 url:z.string().regex(/^https:\/\/github\.com\/AlisanMedia\/GOLD-REVENUE-OS-PRO\/actions\/runs\/[0-9]+\/job\/[0-9]+$/u),
});
export const pilotSnapshotSchema=z.strictObject({version:z.literal(1),observed_at:z.iso.datetime({offset:true}),main_sha:sha,protected:z.boolean(),
 ruleset:z.strictObject({id:z.number().int().positive(),active:z.boolean(),bypass_count:z.number().int().nonnegative(),strict:z.boolean(),pull_requests:z.boolean(),block_force_push:z.boolean(),block_deletion:z.boolean(),required_checks:z.array(z.strictObject({name:checkName,app_id:z.number().int().positive()})).max(10)}),
 checks:z.array(checkSchema).max(10),deployments_since_start:z.number().int().nonnegative().nullable(),
 // Hashes/references are not authenticated approvals, even if named "legal".
 external_references:z.array(z.strictObject({gate:z.enum(PILOT_GATES),kind:z.enum(["UNVERIFIED_REFERENCE","SYNTHETIC_ONLY"]),reference_hash:z.string().regex(/^[a-f0-9]{64}$/u)})).max(40),
});
const localSchema=z.strictObject({target_sha:sha,working_tree_clean:z.boolean(),branch_deployment_disabled:z.boolean(),main_deployment_disabled:z.boolean(),deployment_policy_preserved:z.boolean()});
type Status="PASS"|"FAIL"|"BLOCKED"|"NOT_TESTED"|"DEFERRED";
const gates={
 C01:{title:"Ürün, pazar ve dağıtım hakları",status:"BLOCKED",reason:"Owner ve yetkili hukuk/supplier kanıtı gerekiyor."},
 C02:{title:"Satış kanalı ve merchant uygunluğu",status:"BLOCKED",reason:"Merchant/provider ve satış yüzeyi ayrıca onaylanmalı."},
 C03:{title:"Gerçek finansal kaynak ve receipt",status:"BLOCKED",reason:"Sentetik evidence NONE yetkisindedir; genuine writer ve provider kabulü yok."},
 C04:{title:"Gerçek abonelik ve VIP teslimi",status:"BLOCKED",reason:"Fake transport gerçek join/revoke/repair kabulünün yerine geçmez."},
 C05:{title:"Fiyat, vergi ve tüketici koşulları",status:"BLOCKED",reason:"Onaylı terms/refund/cancel/marketing şartları gerekiyor."},
 C06:{title:"Consent, privacy ve saklama",status:"BLOCKED",reason:"Gerçek cohort, lawful contact ve retention kararı yok; imports kilitli."},
 C07:{title:"İnsan operasyonu ve sorumluluk",status:"BLOCKED",reason:"Primary/backup, coverage ve sayısal yanıt hedefi onayı gerekiyor."},
 C08:{title:"Production izolasyonu ve kurtarma",status:"BLOCKED",reason:"Hosted restore/MFA/RPO/RTO bu repository kabulüyle doğrulanmaz."},
 C09:{title:"Gerçek maliyet, bütçe ve kapasite",status:"NOT_TESTED",reason:"Kaynaklı ücretler ve owner-approved sayısal caps eksik; missing cost sıfır değildir."},
 C10:{title:"Exact release ve cohort GO",status:"DEFERRED",reason:"Gerçek pilot ve10→25→50→100 kapıları ayrı açık owner yetkisi gerektirir."},
} as const;
export function assessPilotReadiness(raw:unknown,localRaw:unknown,now:string){
 const snapshot=pilotSnapshotSchema.parse(raw),local=localSchema.parse(localRaw);
 const clock=z.iso.datetime({offset:true}).parse(now);const reasons:string[]=[];
 const age=Date.parse(clock)-Date.parse(snapshot.observed_at);
 let missing=false;
 if(age<0)reasons.push("FUTURE_SNAPSHOT");
 // Artifact freshness only, not an approved LIVE source, SLA or retention policy.
 if(age>30*60*1000){reasons.push("EXPIRED_OFFLINE_SNAPSHOT");missing=true;}
 if(snapshot.main_sha!==local.target_sha)reasons.push("EXACT_HEAD_MISMATCH");
 if(!local.working_tree_clean)reasons.push("WORKTREE_NOT_CLEAN");
 const rule=snapshot.ruleset;
 if(!snapshot.protected||rule.id!==25348710||!rule.active||rule.bypass_count!==0||!rule.strict||!rule.pull_requests||!rule.block_force_push||!rule.block_deletion)reasons.push("GOVERNANCE_NOT_CONFIRMED");
 for(const name of ["Application","Database"] as const){
  const required=rule.required_checks.filter(c=>c.name===name);
  if(required.length!==1||required[0]?.app_id!==15368)reasons.push(name+"_NOT_MANDATORY");
  const checks=snapshot.checks.filter(c=>c.name===name);
  if(!checks.length){reasons.push(name+"_MISSING");missing=true;continue;}
  if(checks.length!==1){reasons.push(name+"_AMBIGUOUS");continue;}
  const check=checks[0]!;
  if(check.app_id!==15368||check.head_sha!==local.target_sha||check.url!==`https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/actions/runs/${check.run_id}/job/${check.id}`)reasons.push(name+"_SOURCE_MISMATCH");
  if(check.status!=="completed"||check.conclusion!=="success")reasons.push(name+"_NOT_SUCCESS");
 }
 if(!local.branch_deployment_disabled||!local.main_deployment_disabled||!local.deployment_policy_preserved)reasons.push("DEPLOYMENT_SUPPRESSION_NOT_CONFIRMED");
 if(snapshot.deployments_since_start===null){reasons.push("DEPLOYMENT_INVENTORY_UNAVAILABLE");missing=true;}
 else if(snapshot.deployments_since_start!==0)reasons.push("UNAUTHORIZED_DEPLOYMENT_OBSERVED");
 const technicalStatus:Status=!reasons.length?"PASS":missing&&reasons.every(r=>r.endsWith("_MISSING")||r==="EXPIRED_OFFLINE_SNAPSHOT"||r==="DEPLOYMENT_INVENTORY_UNAVAILABLE")?"NOT_TESTED":"FAIL";
 return {version:1 as const,classification:"REPOSITORY_ONLY" as const,evidence_validation:"OFFLINE_CONSISTENCY_ONLY" as const,financial_authority:"NONE" as const,
  live_operations_authorized:false as const,commercial_verdict:"NO_GO" as const,evaluated_at:clock,target_sha:local.target_sha,
  repository_controls:{status:technicalStatus,reasons},
  gates:PILOT_GATES.map(id=>({id,...gates[id],unverified_reference_count:snapshot.external_references.filter(r=>r.gate===id).length})),
 };
}
export type PilotReadiness=ReturnType<typeof assessPilotReadiness>;

/** Inventory of the existing release, not a new approval engine. No JSON field can authorize execution. */
export const masterReleaseInventorySchema=z.strictObject({
 version:z.literal(1),repository_sha:sha,classification:z.literal("REPOSITORY_ONLY"),
 staging:z.strictObject({team_id:z.literal("team_fOlNA2ASqhGzUplTDUFGCEDM"),project_id:z.literal("prj_iax5OhGUbLL3s6BemMLqQAHFDAHl"),preserved_deployment:z.literal("dpl_CawCdTno5JkGjB6b6w1ey1qrCDGw"),preserved_sha:z.literal("fe823267365d7f0c554737081a7ff667cc730ae1"),technical_target:z.literal("production"),commercial_production:z.literal(false)}),
 migrations:z.array(z.strictObject({path:z.string().regex(/^supabase\/migrations\/[0-9]{12}(?:[0-9]{2})?_[a-z0-9_]+\.sql$/u),sha256:z.string().regex(/^[a-f0-9]{64}$/u)})).min(1).max(256),
 // Null = an outstanding approval/evidence dependency, never an invented policy or budget.
 prerequisites:z.strictObject({hosted_release_approval:z.null(),hosted_migration_approval:z.null(),backup_restore_evidence:z.null(),approved_rpo_seconds:z.null(),approved_rto_seconds:z.null(),monitoring_owner:z.null(),backup_operator:z.null(),infrastructure_cost_cap:z.null(),account_controls:z.null(),anthropic_canary_grant:z.null(),telegram_allowlist_grant:z.null(),payment_provider_eligibility:z.null()}),
 financial_authority:z.literal("NONE"),live_operations_authorized:z.literal(false),model_requests:z.literal(0),telegram_sends:z.literal(0),deployment_enabled:z.literal(false),commercial_verdict:z.literal("NO_GO"),
}).superRefine((v,c)=>{if(new Set(v.migrations.map(m=>m.path)).size!==v.migrations.length||v.migrations.some((m,i)=>i>0&&v.migrations[i-1]!.path>=m.path))c.addIssue({code:"custom",message:"RELEASE_MIGRATION_ORDER_INVALID"});});
export function masterReleaseInventory(repositorySha:string,migrations:Array<{path:string;sha256:string}>){
 return masterReleaseInventorySchema.parse({version:1,repository_sha:repositorySha,classification:"REPOSITORY_ONLY",staging:{team_id:"team_fOlNA2ASqhGzUplTDUFGCEDM",project_id:"prj_iax5OhGUbLL3s6BemMLqQAHFDAHl",preserved_deployment:"dpl_CawCdTno5JkGjB6b6w1ey1qrCDGw",preserved_sha:"fe823267365d7f0c554737081a7ff667cc730ae1",technical_target:"production",commercial_production:false},migrations,
 prerequisites:{hosted_release_approval:null,hosted_migration_approval:null,backup_restore_evidence:null,approved_rpo_seconds:null,approved_rto_seconds:null,monitoring_owner:null,backup_operator:null,infrastructure_cost_cap:null,account_controls:null,anthropic_canary_grant:null,telegram_allowlist_grant:null,payment_provider_eligibility:null},financial_authority:"NONE",live_operations_authorized:false,model_requests:0,telegram_sends:0,deployment_enabled:false,commercial_verdict:"NO_GO"});
}
export function pilotReadinessMarkdown(report:PilotReadiness):string{
 return ["# GOLD REVENUE OS — Pilot giriş kanıtı","",`Commit: \`${report.target_sha}\``, `Değerlendirme: ${report.evaluated_at}`,
 "","Bu çıktı çevrimdışı girdi tutarlılığı kontrolüdür. GitHub/Vercel veya hukuki/finansal dış kaynak kimlik doğrulaması yerine geçmez.",
 "Sentetik geliştirme gerçek ticari kabul değildir. Finansal yetki NONE; canlı operasyon yetkisi yok; ticari pilot NO-GO.","",
 `Repository kontrolü: **${report.repository_controls.status}**`,
 ...report.repository_controls.reasons.map(r=>`- ${r}`),"",
 "| Kapı | Konu | Durum | Eksik kanıt |", "| --- | --- | --- | --- |",
 ...report.gates.map(g=>`| ${g.id} | ${g.title} | ${g.status} | ${g.reason} Referans: ${g.unverified_reference_count} (doğrulanmamış). |`),
 "","Her10→25→50→100 artışı ayrı owner GO gerektirir. Bu araç hiçbir gate açmaz, worker/receipt/event üretmez veya ayar değiştirmez.",""].join("\n");
}
