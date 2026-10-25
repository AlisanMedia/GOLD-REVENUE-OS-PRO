import { z } from "zod";
import { polatBridgeBindingSchema, polatBridgeReservationSchema, polatBridgeOutcomeSchema, polatBridgeHashSchema } from "@gold-revenue-os/contracts";
import { polatGuardDigest } from "./polat-experiment-journal";

/** Trusted server-code dependency. The bridge never creates a connection or loads DB credentials. */
export interface PolatExperimentSql { execute(statement: string, values: readonly unknown[]): Promise<unknown> }
const id=z.uuid();
const preparedSchema=z.strictObject({run_id:id,binding_hash:polatBridgeHashSchema,replay:z.boolean(),financial_authority:z.literal("NONE"),execution_enabled:z.literal(false)});
const beginSchema=z.union([
  z.strictObject({dispatch:z.literal(false),state:z.literal("ALREADY_STARTED_REVIEW_REQUIRED"),financial_authority:z.literal("NONE")}),
  z.strictObject({dispatch:z.literal(true),state:z.literal("FIXTURE_DISPATCH_RECORDED"),evidence_hash:polatBridgeHashSchema,financial_authority:z.literal("NONE"),authorized_external_requests:z.literal(0)}),
]);
const resultSchema=z.strictObject({recorded:z.literal(true),replay:z.boolean(),stage:z.string().max(40),evidence_hash:polatBridgeHashSchema,actual_billed_amount:z.null()});
const readSchema=z.strictObject({version:z.literal(1),mode:z.literal("OFFLINE_SYNTHETIC"),run_id:id,binding_hash:polatBridgeHashSchema,request_count:z.number().int().min(0).max(290),reserved_liability:z.string().max(64),currency:z.string().regex(/^[A-Z]{3}$/u),stop_reason:z.string().max(80).nullable(),actual_billed_amount:z.null(),financial_authority:z.literal("NONE"),authorized_external_requests:z.literal(0),execution_enabled:z.literal(false),reserved_not_dispatched:z.number().int().min(0).max(290),completion_unresolved:z.number().int().min(0).max(290),anchor:z.number().int().min(0).max(1024),has_newer:z.boolean(),items:z.array(z.strictObject({sequence:z.number().int().min(1).max(1024),attempt_id:id,stage:z.string().max(40),evidence_hash:polatBridgeHashSchema,previous_hash:polatBridgeHashSchema.nullable(),created_at:z.string().max(64),status:z.string().max(40).nullable()})).max(100),has_more:z.boolean(),next:z.number().int().min(1).max(1024).nullable()});

/** Private fixture backend of the existing experiment evidence model; no public RPC or service-role writer. */
export function createPolatExperimentPgFixtureStore(tenantId: string, sql: PolatExperimentSql) {
  id.parse(tenantId);
  return Object.freeze({
    tenant_id:tenantId,
    async prepare(runId:string,rawBinding:unknown){
      const b=polatBridgeBindingSchema.parse(rawBinding), result=preparedSchema.parse(await sql.execute("select private.polat_experiment_prepare_fixture($1::uuid,$2::uuid,$3::text)",[tenantId,id.parse(runId),JSON.stringify(b)]));
      if(result.binding_hash!==polatGuardDigest(b))throw Error("POLAT_BRIDGE_STORE_BINDING_DRIFT");return result;
    },
    async reserve(runId:string,attemptId:string,target:string,requestHash:string,bodyHash:string,bindingHash:string){
      const r=polatBridgeReservationSchema.parse(await sql.execute("select private.polat_experiment_reserve_fixture($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::text)",[tenantId,id.parse(runId),id.parse(attemptId),polatBridgeHashSchema.parse(target),polatBridgeHashSchema.parse(requestHash),polatBridgeHashSchema.parse(bodyHash),polatBridgeHashSchema.parse(bindingHash)]));
      if(r.run_id!==runId||r.binding_hash!==bindingHash||r.target_hash!==target||r.request_hash!==requestHash||r.body_hash!==bodyHash)throw Error("POLAT_BRIDGE_STORE_RESERVATION_DRIFT");return r;
    },
    async begin(runId:string,attemptId:string,bindingHash:string,key:string,workerId:string){
      return beginSchema.parse(await sql.execute("select private.polat_experiment_begin_fixture($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid)",[tenantId,id.parse(runId),id.parse(attemptId),polatBridgeHashSchema.parse(bindingHash),id.parse(key),id.parse(workerId)]));
    },
    async record(runId:string,attemptId:string,bindingHash:string,key:string|null,raw:unknown){
      const p=polatBridgeOutcomeSchema.parse(raw);
      return resultSchema.parse(await sql.execute("select private.polat_experiment_record_fixture($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::text)",[tenantId,id.parse(runId),id.parse(attemptId),polatBridgeHashSchema.parse(bindingHash),key===null?null:id.parse(key),JSON.stringify(p)]));
    },
    async read(runId:string,after=0,limit=25,anchor:number|null=null){
      z.number().int().min(0).max(1024).parse(after);z.number().int().min(1).max(100).parse(limit);if(anchor!==null)z.number().int().min(after).max(1024).parse(anchor);
      return readSchema.parse(await sql.execute("select private.polat_experiment_read_fixture($1::uuid,$2::uuid,$3::integer,$4::integer,$5::integer)",[tenantId,id.parse(runId),after,limit,anchor]));
    },
  });
}
export type PolatExperimentFixtureStore=ReturnType<typeof createPolatExperimentPgFixtureStore>;
