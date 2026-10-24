import {describe,it,expect,vi}from "vitest";
import {dispatchSyntheticSignalWave,type SignalWaveStore}from "./signal-wave";
import {FakeSignalTransport}from "./signal-distribution";
import type{SignalDispatchPayload,SignalTransportResult}from "@gold-revenue-os/contracts";
const tenant="51f02000-0000-4000-8000-000000000001",destination="51f05000-0000-4000-8000-000000000001";
const payload=(n:number):SignalDispatchPayload=>({version:1,mode:"SYNTHETIC",tenant_id:tenant,operation_key:String(n).repeat(64),operation:"SEND",destination_ref:"fixture:destination",message_ref:null,reply_ref:null,text:"XAUUSD BUY MARKET",attachments:[],fact_hash:"a".repeat(64),observed_at:"2026-10-24T00:00:00Z"});
const item=(n:number)=>({delivery_id:`51f07000-0000-4000-8000-${String(n).padStart(12,"0")}`,lease_token:`51f08000-0000-4000-8000-${String(n).padStart(12,"0")}`,payload:payload(n)});
const wave=()=>({version:1,mode:"SYNTHETIC",tenant_id:tenant,destination_id:destination,financial_authority:"NONE",live_operations_authorized:false,state:"PREPARED",items:[item(1),item(2)]});
function store(value:unknown=wave()):SignalWaveStore{return{mode:"SYNTHETIC",prepareWave:vi.fn(()=>Promise.resolve(value)),finish:vi.fn(()=>Promise.resolve({state:"FAKE_CONFIRMED",replay:false,financial_authority:"NONE"}))};}
describe("bounded independent signal wave",()=>{
 it("starts both independent fake dispatches before waiting for either",async()=>{
  let started=0;let release!:()=>void;const barrier=new Promise<void>(r=>{release=r;});
  class BarrierTransport extends FakeSignalTransport{override async dispatch(raw:unknown){started++;await barrier;return super.dispatch(raw);}}
  const t=new BarrierTransport(),s=store(),pending=dispatchSyntheticSignalWave({tenantId:tenant,destinationId:destination,store:s,transport:t});
  await vi.waitFor(()=>expect(started).toBe(2));release();const r=await pending;
  expect(r.confirmed).toBe(2);expect(r.attempted).toBe(2);expect(t.effects).toHaveLength(2);expect(r).toMatchObject({financial_authority:"NONE",live_operations_authorized:false});
 });
 it.each(["ORDERED_REQUIRED","RECOVERY_REQUIRED","PAUSED","NO_WORK","BUSY"])("%s does not send or fabricate completion",async state=>{
  const t=new FakeSignalTransport(),s=store({...wave(),state,items:[]});const r=await dispatchSyntheticSignalWave({tenantId:tenant,destinationId:destination,store:s,transport:t});expect(r.attempted).toBe(0);expect(t.effects).toHaveLength(0);expect(s.finish).not.toHaveBeenCalled();
 });
 it("records unknown and acknowledged siblings independently without a retry loop",async()=>{
  const t=new FakeSignalTransport([{outcome:"UNKNOWN_AFTER_EFFECT"},{outcome:"ACK"}]);const s=store();s.finish=vi.fn((_t:string,_j:string,_k:string,r:SignalTransportResult)=>Promise.resolve({state:r.outcome==="UNKNOWN"?"UNKNOWN":"FAKE_CONFIRMED",replay:false,financial_authority:"NONE"}));
  const r=await dispatchSyntheticSignalWave({tenantId:tenant,destinationId:destination,store:s,transport:t});expect(r.unknown).toBe(1);expect(r.confirmed).toBe(1);expect(t.effects).toHaveLength(2);expect(s.prepareWave).toHaveBeenCalledTimes(1);
 });
 it("lost finish acknowledgment remains unknown, never a blind resend",async()=>{
  const t=new FakeSignalTransport(),s=store();s.finish=vi.fn(()=>Promise.reject(Error("private-provider-detail")));const r=await dispatchSyntheticSignalWave({tenantId:tenant,destinationId:destination,store:s,transport:t});expect(r.unknown).toBe(2);expect(t.effects).toHaveLength(2);expect(s.prepareWave).toHaveBeenCalledTimes(1);
 });
 it.each([
  {items:[item(1),item(1)]},{items:[item(1),item(2),item(3)]},{items:[{...item(1),payload:{...payload(1),reply_ref:"fake-message:parent"}}]},
  {items:[{...item(1),payload:{...payload(1),operation:"EDIT",message_ref:"fake-message:old"}}]},
  {financial_authority:"LIVE"},{items:[{...item(1),payload:{...payload(1),tenant_id:destination}}]},
  {tenant_id:destination},{destination_id:tenant},
 ])("rejects duplicate, dependent, over-width, cross-scope or authority-forged prepare",async patch=>{
  const t=new FakeSignalTransport();await expect(dispatchSyntheticSignalWave({tenantId:tenant,destinationId:destination,store:store({...wave(),...patch}),transport:t})).rejects.toThrow();expect(t.effects).toHaveLength(0);
 });
 it("fake transport deduplicates an identical operation during concurrent delay",async()=>{
  const t=new FakeSignalTransport([{outcome:"ACK",delay_ms:5},{outcome:"ACK",delay_ms:5}]);const a=payload(1);const r=await Promise.all([t.dispatch(a),t.dispatch(a)]);expect(r[0]).toEqual(r[1]);expect(t.effects).toHaveLength(1);
 });
 it("conflicting concurrent operation facts cannot produce a second effect",async()=>{
  const t=new FakeSignalTransport([{outcome:"ACK",delay_ms:5},{outcome:"ACK",delay_ms:5}]);
  const r=await Promise.allSettled([t.dispatch(payload(1)),t.dispatch({...payload(1),text:"conflicting fixture"})]);
  expect(r.filter(v=>v.status==="fulfilled")).toHaveLength(1);expect(r.filter(v=>v.status==="rejected")).toHaveLength(1);expect(t.effects).toHaveLength(1);
 });
});
