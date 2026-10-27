import { request as httpsRequest } from "node:https";
import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { preparePolatClaudeRequest, decodePolatClaudeResponse, PolatClaudeFailure } from "./polat-claude-adapter";
import { requirePolatNetworkPermit } from "./polat-experiment-execution-gate";
import { type ModelRequest, type ModelResponse } from "./agent-runtime";

export const POLAT_ANTHROPIC_ENDPOINT="https://api.anthropic.com/v1/messages" as const;
const consumedContexts=new WeakSet<object>();
/** Fixed HTTPS implementation. No default permit exists; only independently verified private-UAT authority may issue one. Tests replace the node:https boundary. */
export async function sendPolatClaudeHttpsOnce(permit: unknown, request: ModelRequest, signal?: AbortSignal) {
  const context=requirePolatNetworkPermit(permit); // Before credential use, codec, timer or socket creation.
  if (context.binding.provider !== "anthropic") throw new PolatClaudeFailure("PROVIDER_ERROR", "CLAUDE_RESERVED_PROVIDER_MISMATCH");
  if(consumedContexts.has(context))throw new PolatClaudeFailure("PROVIDER_ERROR","CLAUDE_RESERVED_ATTEMPT_REPLAY_DENIED");
  consumedContexts.add(context); // Failure/unknown result never makes this one-shot context reusable.
  const snapshot=structuredClone(request),wire=preparePolatClaudeRequest(snapshot,context.binding.maximum_output_tokens);
  if (wire.request_hash!==context.request_hash || wire.body_hash!==context.body_hash || context.binding.timeout_ms!==request.timeoutMs || Date.parse(context.binding.expires_at)<=Date.now()) throw new PolatClaudeFailure("PROVIDER_ERROR","CLAUDE_RESERVED_REQUEST_DRIFT");
  if (signal?.aborted) throw new PolatClaudeFailure("PROVIDER_ERROR","CLAUDE_ABORT_BEFORE_ATTEMPT");
  const start=performance.now(), body=JSON.stringify(wire.body);
  const raw=await new Promise<{body:string;provider_request_id_hash:string|null}>((resolve,reject)=>{
    let settled=false;const deadline={timer:null as ReturnType<typeof setTimeout>|null};
    const finish=(error:PolatClaudeFailure|null,value?:{body:string;provider_request_id_hash:string|null})=>{
      if(settled)return;settled=true;if(deadline.timer)clearTimeout(deadline.timer);signal?.removeEventListener("abort",cancel);
      if(error){socket.destroy();reject(error);}else resolve(value!);
    };
    const cancel=()=>finish(new PolatClaudeFailure("PROVIDER_ERROR","CLAUDE_ABORT_UNKNOWN",true));
    const socket=httpsRequest({protocol:"https:",hostname:"api.anthropic.com",port:443,path:"/v1/messages",method:"POST",maxHeaderSize:8192,rejectUnauthorized:true,minVersion:"TLSv1.2",
      headers:{...wire.headers,"x-api-key":context.credential,"x-client-request-id":context.attempt_id,"content-length":Buffer.byteLength(body)},
    },response=>{
      const status=response.statusCode??0;
      if(status!==200){response.resume();finish(new PolatClaudeFailure(status===429?"RATE_LIMIT":status===408||status===504?"TIMEOUT":"PROVIDER_ERROR",status>=300&&status<400?"CLAUDE_REDIRECT_DENIED":status===401||status===403?"CLAUDE_AUTH_DENIED":status===429?"CLAUDE_RATE_LIMIT":"CLAUDE_HTTP_FAILURE",status>=500||status===408));return;}
      const echoed=response.headers["x-client-request-id"], contentType=response.headers["content-type"];
      if(context.workspace_id!==undefined&&response.headers["anthropic-workspace-id"]!==context.workspace_id){response.resume();finish(new PolatClaudeFailure("INVALID_OUTPUT","CLAUDE_RESPONSE_WORKSPACE_INVALID",true));return;}
      if(echoed!==undefined&&echoed!==context.attempt_id||typeof contentType!=="string"||!/^application\/json(?:\s*;|$)/iu.test(contentType)){response.resume();finish(new PolatClaudeFailure("INVALID_OUTPUT","CLAUDE_RESPONSE_CORRELATION_INVALID",true));return;}
      const chunks:Buffer[]=[];let bytes=0;
      response.on("data",(chunk:Buffer)=>{if(settled)return;bytes+=chunk.length;if(bytes>65536){finish(new PolatClaudeFailure("INVALID_OUTPUT","CLAUDE_RESPONSE_BOUND",true));return;}chunks.push(chunk);});
      response.on("aborted",()=>finish(new PolatClaudeFailure("PROVIDER_ERROR","CLAUDE_PARTIAL_RESPONSE_UNKNOWN",true)));
      response.on("error",()=>finish(new PolatClaudeFailure("PROVIDER_ERROR","CLAUDE_CONNECTION_UNKNOWN",true)));
      response.on("end",()=>{if(settled)return;try{
        const text=new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)),id=response.headers["request-id"];
        if(id!==undefined&&(typeof id!=="string"||!/^[a-zA-Z0-9_-]{1,160}$/u.test(id)))throw Error("invalid");
        finish(null,{body:text,provider_request_id_hash:typeof id==="string"?createHash("sha256").update(id,"utf8").digest("hex"):null});
      }catch{finish(new PolatClaudeFailure("INVALID_OUTPUT","CLAUDE_RESPONSE_ENCODING_INVALID",true));}});
    });
    socket.on("error",()=>finish(new PolatClaudeFailure("PROVIDER_ERROR","CLAUDE_CONNECTION_UNKNOWN",true)));
    deadline.timer=setTimeout(()=>finish(new PolatClaudeFailure("TIMEOUT","CLAUDE_TIMEOUT_UNKNOWN",true)),context.binding.timeout_ms);
    signal?.addEventListener("abort",cancel,{once:true});
    // https.request does not follow redirects and this code never retries, falls back or regenerates.
    try{socket.end(body);}catch{finish(new PolatClaudeFailure("PROVIDER_ERROR","CLAUDE_REQUEST_START_UNKNOWN",true));}
  }).catch((error:unknown)=>{throw error instanceof PolatClaudeFailure?error:new PolatClaudeFailure("PROVIDER_ERROR","CLAUDE_REQUEST_START_UNKNOWN",true);});
  const decoded=decodePolatClaudeResponse(raw.body,snapshot,context.binding.maximum_output_tokens),elapsed=performance.now()-start;
  if(!Number.isFinite(elapsed)||elapsed<0)throw new PolatClaudeFailure("PROVIDER_ERROR","CLAUDE_CLOCK_INVALID",true);
  const response:ModelResponse={provider:"anthropic",model:context.binding.model,providerRequestId:decoded.providerRequestId,output:decoded.output,evidenceResolution:decoded.evidenceResolution,latencyMs:elapsed,
    usage:{inputTokens:decoded.usage?.input_tokens??null,outputTokens:decoded.usage?.output_tokens??null,totalTokens:null,billedAmount:null,billedCurrency:null}};
  return {response,provider_usage:decoded.usage,response_hash:decoded.response_hash,provider_request_id_hash:raw.provider_request_id_hash,metadata:decoded.metadata,actual_billed_amount:null,automatic_retries:0 as const};
}
