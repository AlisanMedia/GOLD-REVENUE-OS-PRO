import { it,expect } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeSignal } from "../../packages/domain/src/signals";
import { signalLatencySummary } from "../../packages/domain/src/signal-distribution";
it("measures bounded strict normalization/hash cost without claiming Telegram parsing or network latency",()=>{
 const samples:number[]=[],ids=new Set<string>();let bytes=0;
 for(let n=0;n<1000;n++){
  const input={version:1,mode:"SYNTHETIC",tenant_id:`51bc2000-0000-4000-8000-${String(n%11+1).padStart(12,"0")}`,source_id:`51bc3000-0000-4000-8000-${String(n%11+1).padStart(12,"0")}`,message_key:`benchmark-${n}`,revision:1,kind:"MESSAGE",observed_at:"2026-10-23T12:00:00Z",published_at:null,reply_to:null,original_text:"BUY XAUUSD LIMIT 2700.010 SL 2690.000 TP1 2720.10 TP2 2730.001",attachments:[],interpretation:{action:"OPEN",direction:"BUY",symbol:"XAUUSD",order_type:"LIMIT",entry:["2700.010","2701.010"],stop_loss:"2690.000",take_profits:["2720.10","2730.001"]}};
  const start=performance.now(),result=normalizeSignal(input);samples.push(performance.now()-start);ids.add(result.identity);bytes+=Buffer.byteLength(result.canonical);
 }
 expect(ids.size).toBe(1000);const result=signalLatencySummary(samples);expect(result.excluded).toBe(0);
 const evidence=JSON.stringify({...result,profile:"V1_STRICT_NORMALIZATION_AND_SHA256_ONLY",clock:"performance.now monotonic",mean_payload_bytes:bytes/1000,real_telegram_decode:"NOT_IMPLEMENTED"});
 if(process.env.SIGNAL_BENCHMARK_DIR)writeFileSync(join(process.env.SIGNAL_BENCHMARK_DIR,"signal-normalization.json"),evidence+"\n",{mode:0o600});
});
