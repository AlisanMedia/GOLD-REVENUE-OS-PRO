import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { writeFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { FakeSignalTransport, dispatchSyntheticSignalWakeup, type SignalFixtureStore } from "../../packages/domain/src/signal-distribution";
import { normalizeSignal } from "../../packages/domain/src/signals";
import { dispatchSyntheticSignalWave, type SignalWaveStore } from "../../packages/domain/src/signal-wave";
import type { SignalSourceEvent, SignalTransportResult } from "../../packages/contracts/src/index";
const url = process.env.SIGNAL_DISPOSABLE_DB_URL;
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
const id = (n: number, kind: string) => `51f1${kind}-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Bounded stdlib psql channel. An echo marker occurs only after psql has
 * consumed the previous statement's completion, including implicit COMMIT.
 * Thus no fake transport effect starts on a merely precommit DataRow. */
class PgChannel {
 private readonly child: ChildProcessWithoutNullStreams;
 private chain: Promise<unknown> = Promise.resolve(); private buffer = ""; private sequence = 0;
 private pending: { marker: string; lines: string[]; resolve: (v: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
 private closed = false;
 constructor() {
  const u = new URL(url!); if (u.protocol !== "postgresql:" || u.hostname !== "127.0.0.1" || !/^\/[A-Za-z0-9_]+$/u.test(u.pathname)) throw Error("SIGNAL_LOCAL_PG17_REQUIRED");
  this.child = spawn(process.env.SIGNAL_PSQL_BIN ?? "psql", [url!, "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate"], { stdio: ["pipe", "pipe", "pipe"] });
  this.child.stderr.on("data", () => {}); // No SQL, lease, URL or private payload in logs.
  this.child.stdout.on("data", (v: Buffer) => { this.buffer += v.toString("utf8"); if (this.buffer.length > 131072) { this.fail(); return; }
   let index: number; while ((index = this.buffer.indexOf("\n")) >= 0) { const line = this.buffer.slice(0, index).trim(); this.buffer = this.buffer.slice(index + 1);
    const p = this.pending; if (!p) continue;
    if (line === p.marker) { clearTimeout(p.timer); this.pending = null; p.resolve(p.lines.join("\n")); } else p.lines.push(line);
   }
  });
  this.child.on("error", () => this.fail()); this.child.on("exit", () => this.fail());
 }
 private fail() { this.closed = true; if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(Error("SIGNAL_PG_CHANNEL_FAILED")); this.pending = null; } }
 query(statement: string): Promise<string> {
  const result = this.chain.then(() => new Promise<string>((resolve, reject) => {
   if (this.closed) { reject(Error("SIGNAL_PG_CHANNEL_CLOSED")); return; }
   const marker = `SIGNAL_QUERY_DONE_${++this.sequence}`;
   const timer = setTimeout(() => { this.fail(); this.child.kill("SIGTERM"); reject(Error("SIGNAL_PG_QUERY_TIMEOUT")); }, 15000);
   this.pending = { marker, resolve, reject, timer, lines: [] }; this.child.stdin.write(statement + "\n\\echo " + marker + "\n");
  })); this.chain = result.catch(() => {}); return result;
 }
 async json(statement: string): Promise<unknown> { return JSON.parse((await this.query(statement)).split("\n").at(-1)!) as unknown; }
 close() { this.closed = true; this.child.stdin.end("\\q\n"); }
}
function source(n: number, k: number): SignalSourceEvent { return { version: 1, mode: "SYNTHETIC", tenant_id: id(n, "2000"), source_id: id(n, "3000"), message_key: `burst-${k}`, revision: 1, kind: "MESSAGE", observed_at: "2026-10-24T00:00:00Z", published_at: null, reply_to: null, original_text: "BUY XAUUSD LIMIT 2700.010 SL 2690.000 TP 2720.10", attachments: [], interpretation: { action: "OPEN", direction: "BUY", symbol: "XAUUSD", order_type: "LIMIT", entry: ["2700.010"], stop_loss: "2690.000", take_profits: ["2720.10"] } }; }
const summaries: unknown[] = [];
describe.runIf(Boolean(url))("actual committed SQL and event-driven domain fake transport benchmark", () => {
 it("compares strict vs opt-in width2 with identical 11x8 fixtures and2/150ms fake ACKs", async () => {
  const clients = Array.from({ length: 11 }, () => new PgChannel()); const seed = new PgChannel(); const owned: string[] = [];
  try {
   // Persistent connections are established before any source event receipt, as
   // in a running worker. Startup is measured separately, never hidden in a
   // before/after mismatch: both STRICT and WAVE2 use these same11 channels.
   const startup = performance.now(); const versions = await Promise.all([...clients, seed].map(c => c.query("select current_setting('server_version_num')::int/10000;")));versions.forEach(v => expect(v).toBe("17"));
   const startupMs = performance.now() - startup;
   for (const [offset, delay, width] of [[301, 2, 1], [321, 150, 1], [341, 2, 2], [361, 150, 2]] as const) {
    const ns = Array.from({ length: 11 }, (_, i) => offset + i), tenants = ns.map(n => id(n, "2000"));
    expect(await seed.query(`select count(*)from public.tenants where id in(${tenants.map(quote).join(",")});`)).toBe("0");
    await seed.query("begin;" + ns.map(n => `insert into public.tenants(id,name,slug)values(${quote(id(n,"2000"))},'Benchmark fixture','signal-sandbox-wave-node-${n}');select private.signal_fixture_configure_v1(${[id(n,"2000"),id(n,"4000"),id(n,"3000"),id(n,"5000"),id(n,"6000"),"Benchmark fixture",`fixture:node-source-${n}`,`fixture:node-destination-${n}`].map(quote).join(",")},true);${width===2?`select private.signal_wave_configure_fixture_v1(${quote(id(n,"2000"))},${quote(id(n,"5000"))},2);`:""}`).join("\n") + "commit;");
    owned.push(...tenants); const started = performance.now();
    const normalizationMs:number[]=[];
    const commands=ns.flatMap(n=>Array.from({length:8},(_,k)=>{const raw={...source(n,k+1),observed_at:new Date().toISOString()};const clock=performance.now();const normalized=normalizeSignal(raw);normalizationMs.push(performance.now()-clock);return `select private.signal_record_fixture_v1(${quote(normalized.canonical)});`;}));
    const commitStart=performance.now();await seed.query("begin;"+commands.join("\n")+"commit;");const batchCommitMs=performance.now()-commitStart;
    const outcomes = await Promise.all(ns.map(async (n, i) => {
     const c = clients[i]!, t = id(n,"2000"), transport = new FakeSignalTransport(Array.from({length:8},()=>({outcome:"ACK" as const,delay_ms:delay})));
     const finish = (tenant:string,job:string,token:string,r:SignalTransportResult) => c.json(`select private.signal_finish_fixture_v1(${[tenant,job,token,JSON.stringify(r)].map(quote).join(",")});`);
     let confirmed=0;
     if(width===1){const store:SignalFixtureStore={mode:"SYNTHETIC",claim:t=>c.json(`select private.signal_claim_fixture_v1(${quote(t)});`),begin:(t,j,k)=>c.json(`select private.signal_begin_fixture_v1(${[t,j,k].map(quote).join(",")});`),finish,reconcile:()=>Promise.reject(Error("NOT_A_BENCHMARK_ACTION"))};confirmed=(await dispatchSyntheticSignalWakeup({tenantId:t,store,transport,maxJobs:8})).confirmed;}
     else {const store:SignalWaveStore={mode:"SYNTHETIC",prepareWave:(t,d)=>c.json(`select private.signal_wave_prepare_fixture_v1(${[t,d].map(quote).join(",")});`),finish};for(let cycle=0;cycle<4;cycle++){const r=await dispatchSyntheticSignalWave({tenantId:t,destinationId:id(n,"5000"),store,transport});confirmed+=r.confirmed;expect(r.unknown).toBe(0);}}
     expect(transport.effects).toHaveLength(8); return confirmed;
    }));
    const totalMs=performance.now()-started;expect(outcomes.reduce((a,b)=>a+b,0)).toBe(88);
    const result=await seed.json(`with samples as(
     select 1000*extract(epoch from(h.evidence->>'acknowledged_at')::timestamptz-(e.original->>'observed_at')::timestamptz)latency,
      1000*extract(epoch from e.recorded_at-(e.original->>'observed_at')::timestamptz)ingest,1000*extract(epoch from j.enqueued_at-e.recorded_at)queue_insert,
      1000*extract(epoch from a.started_at-j.enqueued_at)queue_to_begin,1000*extract(epoch from(h.evidence->>'acknowledged_at')::timestamptz-a.started_at)dispatch_ack,
      1000*extract(epoch from h.recorded_at-(h.evidence->>'acknowledged_at')::timestamptz)persist_ack
     from private.signal_deliveries j join private.signal_events e on e.id=j.event_id and e.tenant_id=j.tenant_id join private.signal_attempts a on a.delivery_id=j.id and a.tenant_id=j.tenant_id join private.signal_delivery_history h on h.delivery_id=j.id and h.tenant_id=j.tenant_id and h.code='FAKE_ACK'
     where j.tenant_id in(${tenants.map(quote).join(",")})and j.status='FAKE_CONFIRMED')
     select jsonb_build_object('classification','SYNTHETIC_DOMAIN_SQL_FAKE_ACK','profile','${width===1?"STRICT":"WAVE2"}_${delay}MS','events',count(*),'tenants',11,'providers',11,'worker_connections',11,'seed_connections',1,'per_destination_width',${width},'fake_ack_delay_ms',${delay},
      'p50_ms',percentile_disc(.5)within group(order by latency),'p95_ms',percentile_disc(.95)within group(order by latency),'p99_ms',percentile_disc(.99)within group(order by latency),'max_ms',max(latency),'minimum_ms',min(latency),'target_met',percentile_disc(.95)within group(order by latency)<1000,
      'stage_p95_ms',jsonb_build_object('ingestion',percentile_disc(.95)within group(order by ingest),'queue_insert',percentile_disc(.95)within group(order by queue_insert),'queue_to_begin',percentile_disc(.95)within group(order by queue_to_begin),'dispatch_ack',percentile_disc(.95)within group(order by dispatch_ack),'persist_ack',percentile_disc(.95)within group(order by persist_ack)))from samples;`) as { events:number; minimum_ms:number; [key:string]:unknown };
    expect(result.events).toBe(88);expect(result.minimum_ms).toBeGreaterThanOrEqual(0);
    const summary={...result,source_batch_sql_and_commit_ms:batchCommitMs,normalization_cpu_ms:normalizationMs.sort((a,b)=>a-b)[Math.ceil(.95*normalizationMs.length)-1],time_basis:"first Node source receipt to fake API ACK; shared host clock; all88 samples",monotonic_total_ms:totalMs,throughput_per_second:88000/totalMs,startup_ms_separate:startupMs,percentiles:"NEAREST_RANK",samples_excluded:0,real_telegram_performance:"UNVERIFIED",financial_authority:"NONE"};summaries.push(summary);console.log(JSON.stringify(summary));
   }
   if(process.env.SIGNAL_BENCHMARK_OUTPUT)writeFileSync(process.env.SIGNAL_BENCHMARK_OUTPUT,JSON.stringify(summaries,null,2)+"\n");
  } finally { try { if(owned.length)await seed.query(`begin;update private.signal_controls set enabled=false where tenant_id in(${owned.map(quote).join(",")});update public.tenants set status='suspended'where id in(${owned.map(quote).join(",")});commit;`); } finally { for(const c of clients)c.close();seed.close(); } }
 },60000);
});
