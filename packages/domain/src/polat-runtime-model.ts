import { z } from "zod";
import { polatClaudeOfflineConfigSchema } from "@gold-revenue-os/contracts";
import { createPolatClaudeOfflineProvider } from "./polat-claude-adapter";
import { requestFingerprint, type ModelProvider, type ModelRequest } from "./agent-runtime";

export interface PolatOfflineRuntimeModel { readonly kind: "POLAT_OFFLINE_RUNTIME_MODEL" }
const schema = z.strictObject({ version: z.literal(1), mode: z.literal("OFFLINE_SYNTHETIC"), tenant_id: z.uuid(), conversation_id: z.uuid(), frames: z.array(polatClaudeOfflineConfigSchema).min(1).max(290) });
const models = new WeakMap<object, { tenant: string; conversation: string; provider: ModelProvider; evidence: () => { calls: number; consumed: number } }>();

/** Server-code-only, data-only fixture capability. An arbitrary ModelProvider/function/JSON flag is not accepted. */
export function createPolatOfflineRuntimeModel(raw: unknown): PolatOfflineRuntimeModel {
  const config = schema.parse(raw), consumed = new Set<string>(); let next = 0, calls = 0;
  const provider: ModelProvider = Object.freeze({ provider: "anthropic", model: "claude-haiku-5-5",
    async invoke(request: ModelRequest, signal?: AbortSignal) {
      if (request.context.tenantId !== config.tenant_id || request.context.conversationId !== config.conversation_id) throw Error("POLAT_OFFLINE_MODEL_SCOPE_DENIED");
      const hash = requestFingerprint(request);
      if (consumed.has(hash) || next >= config.frames.length) throw Error("POLAT_OFFLINE_MODEL_BUDGET_DENIED");
      consumed.add(hash); // Failures consume the reserved fixture; never retry or replace the actual output.
      const frame = config.frames[next++]!, adapter = createPolatClaudeOfflineProvider(frame);
      try { return await adapter.provider.invoke(request, signal); } finally { calls += adapter.evidence().calls; }
    },
  });
  const capability = Object.freeze({ kind: "POLAT_OFFLINE_RUNTIME_MODEL" as const });
  models.set(capability, { tenant: config.tenant_id, conversation: config.conversation_id, provider, evidence: () => ({ calls, consumed: consumed.size }) });
  return capability;
}
export function polatOfflineRuntimeProvider(capability: PolatOfflineRuntimeModel, tenant: string, conversation: string): ModelProvider {
  const model = models.get(capability);
  if (!model || model.tenant !== tenant || model.conversation !== conversation) throw Error("POLAT_OFFLINE_MODEL_CAPABILITY_DENIED");
  return model.provider;
}
export function polatOfflineRuntimeEvidence(capability: PolatOfflineRuntimeModel) {
  const model = models.get(capability); if (!model) throw Error("POLAT_OFFLINE_MODEL_CAPABILITY_DENIED");
  return { ...model.evidence(), external_requests: 0, actual_billed_cost: null, financial_authority: "NONE", live_operations_authorized: false } as const;
}
