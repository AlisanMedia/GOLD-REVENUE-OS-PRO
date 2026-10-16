import { afterEach,beforeEach,describe,it,expect,vi } from "vitest";
const mocks=vi.hoisted(()=>({success:vi.fn(),agent:vi.fn(),escalations:vi.fn(),replies:vi.fn()}));
vi.mock("@/lib/customer-success/worker",()=>({drainCustomerSuccess:mocks.success}));
vi.mock("@/lib/agent-runtime/worker",()=>({runDeterministicWorker:mocks.agent}));
vi.mock("@/lib/escalations/service",()=>({drainEscalations:mocks.escalations}));
vi.mock("@/lib/messaging/automatic-replies",()=>({drainAutomaticReplies:mocks.replies}));
import { GET } from "../../apps/web/src/app/api/internal/agent-worker/route";
const secret="synthetic-test-worker-secret-not-a-deployment-credential";
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("CRON_SECRET",secret);mocks.success.mockResolvedValue({processed:1,tenants:1,mode:"PREVIEW_ONLY"});mocks.agent.mockResolvedValue({processed:0});});
afterEach(()=>vi.unstubAllEnvs());
describe("existing authenticated worker with isolated Customer Success workload",()=>{
 it("rejects missing or incorrect authorization before touching a worker",async()=>{for(const token of [null,"wrong"]){const r=await GET(new Request("https://staging.example.test/api/internal/agent-worker?workload=customer-success",{headers:token?{authorization:"Bearer "+token}:{}}));expect(r.status).toBe(401);}expect(mocks.success).not.toHaveBeenCalled();expect(mocks.agent).not.toHaveBeenCalled();});
 it("runs the Phase13-only path without AI, Telegram or escalation sends",async()=>{const r=await GET(new Request("https://staging.example.test/api/internal/agent-worker?workload=customer-success",{headers:{authorization:"Bearer "+secret}}));expect(r.status).toBe(200);expect((await r.json()).customer_success.mode).toBe("PREVIEW_ONLY");expect(mocks.agent).not.toHaveBeenCalled();expect(mocks.escalations).not.toHaveBeenCalled();expect(mocks.replies).not.toHaveBeenCalled();});
 it("keeps the existing default worker operations and adds bounded CS draining",async()=>{const r=await GET(new Request("https://staging.example.test/api/internal/agent-worker",{headers:{authorization:"Bearer "+secret}}));expect(r.status).toBe(200);expect(mocks.agent).toHaveBeenCalledTimes(1);expect(mocks.escalations).toHaveBeenCalledTimes(1);expect(mocks.replies).toHaveBeenCalledTimes(1);expect(mocks.success).toHaveBeenCalledTimes(1);});
 it("does not claim a failed CS drain succeeded",async()=>{mocks.success.mockRejectedValue(Error("synthetic failure"));const r=await GET(new Request("https://staging.example.test/api/internal/agent-worker?workload=customer-success",{headers:{authorization:"Bearer "+secret}}));expect(r.status).toBe(500);expect(await r.json()).toEqual({error:"WORKER_EXECUTION_FAILED"});});
 it("rejects an invalid workload without executing unrelated work",async()=>{const r=await GET(new Request("https://staging.example.test/api/internal/agent-worker?workload=unknown",{headers:{authorization:"Bearer "+secret}}));expect(r.status).toBe(400);expect(mocks.agent).not.toHaveBeenCalled();});
});
