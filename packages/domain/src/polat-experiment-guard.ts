import { randomUUID } from "node:crypto";
import { polatGuardPolicySchema, polatOfflineTransportScriptSchema, polatModelObservationSchema, type PolatGuardPolicy, type PolatOfflineScript, type PolatGuardJournalRecord } from "@gold-revenue-os/contracts";
import { polatModelAcceptanceManifest } from "./polat-model-acceptance";
import { POLAT_MULTITURN_V2_CORPUS, polatV2CorpusPlan } from "./polat-multiturn-v2-corpus";
import { preparePolatConversation, PolatFixtureProvider, assessPolatDraft, POLAT_PROFILE } from "./polat-conversation";
import { polatFixture } from "./polat-conversation.fixtures";
import { assertSafeContext, requestFingerprint, ModelProviderError, type ModelRequest, type ModelResponse } from "./agent-runtime";
import { polatFixtureMeasurement } from "./polat-model-evaluation";
import { openPolatExperimentJournal, polatGuardDigest } from "./polat-experiment-journal";
/** Versioned nonfinancial measurement hash; monetary/financial canonical rules remain untouched. */
function modelEvidenceHash(value: unknown): string {
    const numbersAsTypedStrings = (v: unknown): unknown => {
        if (v === null)
            return ["NULL"];
        if (typeof v === "number") {
            if (!Number.isFinite(v))
                throw Error("POLAT_MEASUREMENT_INVALID");
            return ["FINITE_IEEE754_MEASUREMENT", String(v)];
        }
        if (typeof v === "string")
            return ["STRING", v];
        if (typeof v === "boolean")
            return ["BOOLEAN", v];
        if (Array.isArray(v))
            return ["ARRAY", v.map(numbersAsTypedStrings)];
        if (v && typeof v === "object")
            return ["OBJECT", Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, item]) => [k, numbersAsTypedStrings(item)])];
        throw Error("POLAT_MEASUREMENT_INVALID");
    };
    return polatGuardDigest({ version: "POLAT_MODEL_MEASUREMENT_HASH_V1", value: numbersAsTypedStrings(value) });
}
type StopReason = Extract<PolatGuardJournalRecord, {
    kind: "STOP";
}>["reason"];
const authority = { mode: "OFFLINE_SYNTHETIC", authorized_external_requests: 0, execution_enabled: false, financial_authority: "NONE", live_operations_authorized: false, real_model: "REAL_MODEL_NOT_TESTED" } as const;
const units = (s: string) => { const [a, b = ""] = s.split('.'); return BigInt(a!) * 10n ** 18n + BigInt(b.padEnd(18, '0')); };
const decimal = (n: bigint) => { const a = n / 10n ** 18n, b = (n % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/u, ''); return a.toString() + (b ? '.' + b : ''); };
/** Same accepted semantic eligibility as the v2 plan; fail closed on any count drift. No model call. */
export function polatGuardInvocationTargets() {
    const plan = polatV2CorpusPlan(), targets = [];
    for (const style of ["DIRECT", "ONE_QUESTION"] as const)
        for (const scenario of POLAT_MULTITURN_V2_CORPUS) {
            let owner = "AI_ACTIVE";
            for (const [index, t] of scenario.turns.entries()) {
                owner = t.ownership ?? owner;
                if (t.duplicate || owner !== "AI_ACTIVE" || ["TIMEOUT", "INVALID", "NO_GENERATION"].includes(t.expected) || t.unsafeModel)
                    continue;
                targets.push(Object.freeze({ style, scenario: scenario.id, turn: index, target_hash: polatGuardDigest(["POLAT_GUARD_TARGET_V1", plan.hash, style, scenario.id, index]) }));
            }
        }
    if (targets.length !== plan.proposed_external_semantic_requests)
        throw Error("POLAT_GUARD_PLAN_DRIFT");
    return Object.freeze(targets);
}
export type OfflinePolatTransport = Readonly<{
    kind: "REGISTERED_OFFLINE_FIXTURE";
    target_hash: string;
    request_hash: string;
}>;
type Port = {
    request: ModelRequest;
    script: PolatOfflineScript;
    calls: number;
    prepared: ReturnType<typeof preparePolatConversation>;
    invoke: (signal: AbortSignal) => Promise<ModelResponse>;
};
const offlinePorts = new WeakMap<object, Port>();
/** Accepts data, never an arbitrary callable/SDK. Internally reuses the accepted fixture ModelProvider. */
export function createPolatOfflineTransport(targetHash: string, rawScript: unknown = { status: "SUCCESS" }): OfflinePolatTransport {
    const target = polatGuardInvocationTargets().find(t => t.target_hash === targetHash);
    if (!target)
        throw Error("POLAT_GUARD_TARGET_DENIED");
    const scenario = POLAT_MULTITURN_V2_CORPUS.find(s => s.id === target.scenario)!, turn = scenario.turns[target.turn]!, prepared = preparePolatConversation(polatFixture(turn.text, turn.language ?? "en"));
    prepared.request.requestId = "polat-guard:" + targetHash;
    const request = structuredClone(prepared.request), provider = new PolatFixtureProvider(prepared), script = polatOfflineTransportScriptSchema.parse(rawScript);
    const publicPort = Object.freeze({ kind: "REGISTERED_OFFLINE_FIXTURE" as const, target_hash: targetHash, request_hash: requestFingerprint(request) });
    const port: Port = { request, script, calls: 0, prepared, invoke: async (signal) => {
            port.calls++;
            if (script.delay_ms)
                await new Promise<void>((resolve, reject) => {
                    const finish = () => { signal.removeEventListener('abort', cancel); resolve(); }, timer = setTimeout(finish, script.delay_ms), cancel = () => {
                        if (!script.ignore_abort) {
                            clearTimeout(timer);
                            signal.removeEventListener('abort', cancel);
                            reject(new ModelProviderError("PROVIDER_ERROR", "OFFLINE_ABORT_UNKNOWN", false));
                        }
                    };
                    signal.addEventListener('abort', cancel, { once: true });
                    if (signal.aborted)
                        cancel();
                });
            if (signal.aborted && !script.ignore_abort)
                throw new ModelProviderError("PROVIDER_ERROR", "OFFLINE_ABORT_UNKNOWN", false);
            if (script.status !== "SUCCESS")
                throw new ModelProviderError(script.status === "RATE_LIMITED" ? "RATE_LIMIT" : script.status === "TIMEOUT" ? "TIMEOUT" : script.status === "INVALID_OUTPUT" ? "INVALID_OUTPUT" : "PROVIDER_ERROR", script.status === "UNKNOWN" ? "OFFLINE_RESULT_UNKNOWN" : "OFFLINE_SIMULATED_ERROR", true);
            const response = await provider.invoke(request);
            return { ...response, output: script.output_mutation === "UNSUPPORTED_PAYMENT_CLAIM" ? { ...response.output, proposed_response: "I have verified your payment and activated VIP access." } : response.output, model: script.reported_model ?? response.model, usage: { inputTokens: script.usage.input_tokens, outputTokens: script.usage.output_tokens, totalTokens: script.usage.total_tokens, billedAmount: null, billedCurrency: null } };
        } };
    offlinePorts.set(publicPort, port);
    return publicPort;
}
export function polatOfflineTransportCalls(port: OfflinePolatTransport) {
    const p = offlinePorts.get(port);
    if (!p)
        throw Error("POLAT_GUARD_UNREGISTERED_TRANSPORT");
    return p.calls;
}
function validateBinding(manifest: ReturnType<typeof polatModelAcceptanceManifest>, raw: unknown) {
    const p = polatGuardPolicySchema.parse(raw), f = manifest.fields;
    if (manifest.missing_fields.length || p.manifest_hash !== manifest.proposal_hash || p.repository_sha !== f.approved_repository_sha || p.corpus_hash !== manifest.corpus_hash || p.corpus_version !== manifest.corpus_version || p.provider !== f.provider || p.model !== f.model || p.model_version !== f.model_version || p.model_version !== POLAT_PROFILE.version || p.currency !== f.budget.currency || p.simulation_request_limit > f.budget.maximum_requests! || units(p.maximum_attempt_liability) > units(f.budget.maximum_decimal_spend!))
        throw Error("POLAT_GUARD_BINDING_DENIED");
    if (p.account_state !== "SIMULATED_ENFORCED" || !p.account_cap_evidence_hash || !p.account_cap_amount || p.account_cap_evidence_hash !== f.budget.cap_enforcement_evidence?.sha256 || p.policy_evidence_hash !== f.data_policy.data_handling_approval?.sha256 || units(p.account_cap_amount) !== units(f.budget.maximum_decimal_spend!) || Date.parse(p.valid_until) <= Date.now() || Date.parse(p.valid_until) > Date.now() + 30 * 60 * 1000)
        throw Error("POLAT_GUARD_POLICY_UNAVAILABLE");
    return p;
}
function replay(records: readonly PolatGuardJournalRecord[]) {
    const header = records[0];
    if (!header || header.kind !== "HEADER" || records.slice(1).some(r => r.kind === "HEADER"))
        throw Error("POLAT_GUARD_HEADER_INVALID");
    const attempts = new Map<string, {
        reservation: Extract<PolatGuardJournalRecord, {
            kind: "RESERVED";
        }>;
        result: Extract<PolatGuardJournalRecord, {
            kind: "RESULT";
        }> | null;
    }>(), targets = new Set<string>();
    let stopped: StopReason | null = null;
    for (const r of records.slice(1)) {
        if (r.kind === "RESERVED") {
            if (stopped || attempts.has(r.attempt_id) || targets.has(r.target_hash) || attempts.size >= header.maximum_requests)
                throw Error("POLAT_GUARD_HISTORY_INVALID");
            attempts.set(r.attempt_id, { reservation: r, result: null });
            targets.add(r.target_hash);
        }
        else if (r.kind === "RESULT") {
            const old = attempts.get(r.attempt_id);
            if (!old || old.result)
                throw Error("POLAT_GUARD_HISTORY_INVALID");
            old.result = r;
            if (r.stop_reason)
                stopped = r.stop_reason;
        }
        else if (r.kind === "STOP") {
            if (stopped && stopped !== r.reason)
                throw Error("POLAT_GUARD_HISTORY_INVALID");
            stopped = r.reason;
        }
    }
    const unsettled = [...attempts.values()].filter(a => !a.result);
    if (unsettled.length && !stopped)
        stopped = "UNSETTLED_ATTEMPT";
    let spent = 0n, reserved = 0n, reported = 0n;
    for (const a of attempts.values()) {
        if (a.result?.billed_cost && a.result.billed_cost.currency === header.currency)
            reported += units(a.result.billed_cost.amount);
        if (a.result?.billed_cost && a.result.billed_cost.currency === header.currency && !a.result.stop_reason)
            spent += units(a.result.billed_cost.amount);
        else
            reserved += a.result?.billed_cost && a.result.billed_cost.currency === header.currency && units(a.result.billed_cost.amount) > units(a.reservation.liability) ? units(a.result.billed_cost.amount) : units(a.reservation.liability);
    }
    return { header, attempts, stopped, spent, reserved, reported };
}
/** Repository-only simulation. No credential resolver, network route, live adapter or approval writer exists here. */
export function openPolatOfflineExperiment(args: {
    directory: string;
    manifest: unknown;
    policy: unknown;
    create?: boolean;
}) {
    const manifest = polatModelAcceptanceManifest(args.manifest), policy = validateBinding(manifest, args.policy), bindingHash = polatGuardDigest(policy), journal = openPolatExperimentJournal(args.directory, args.create ?? false);
    try {
        if (args.create)
            journal.append({ kind: "HEADER", manifest_hash: manifest.proposal_hash, binding_hash: bindingHash, corpus_hash: policy.corpus_hash, repository_sha: policy.repository_sha, maximum_requests: policy.simulation_request_limit, maximum_spend: manifest.fields.budget.maximum_decimal_spend!, currency: policy.currency });
        const initial = replay(journal.read());
        if (initial.header.manifest_hash !== manifest.proposal_hash || initial.header.binding_hash !== bindingHash || initial.header.repository_sha !== policy.repository_sha || initial.header.corpus_hash !== policy.corpus_hash || initial.header.maximum_requests !== policy.simulation_request_limit || initial.header.maximum_spend !== manifest.fields.budget.maximum_decimal_spend || initial.header.currency !== policy.currency)
            throw Error("POLAT_GUARD_RESUME_SCOPE_DENIED");
    }
    catch (error) {
        journal.close();
        throw error;
    }
    let busy = false, closed = false, controller: AbortController | null = null;
    function summary() { const s = replay(journal.read()); return { ...authority, state: busy && s.stopped === "UNSETTLED_ATTEMPT" ? "OFFLINE_IN_FLIGHT" : s.stopped ? "STOPPED_REVIEW_REQUIRED" : "OFFLINE_READY", reason: busy && s.stopped === "UNSETTLED_ATTEMPT" ? null : s.stopped, attempts: s.attempts.size, completed: [...s.attempts.values()].filter(a => a.result !== null).length, simulated_settled_cost: decimal(s.spent), simulated_reported_billing: decimal(s.reported), simulated_reserved_liability: decimal(s.reserved), actual_billed_cost: null, currency: policy.currency, automatic_retries: 0, hidden_qa_regenerations: 0 } as const; }
    function stop(reason: StopReason) {
        if (closed)
            throw Error("POLAT_GUARD_CLOSED");
        const s = replay(journal.read());
        if (!s.stopped || s.stopped === "UNSETTLED_ATTEMPT")
            journal.append({ kind: "STOP", reason });
        controller?.abort();
        return summary();
    }
    return Object.freeze({
        summary, close: () => {
            if (busy)
                throw Error("POLAT_GUARD_IN_FLIGHT");
            if (!closed) {
                closed = true;
                journal.close();
            }
        },
        cancel: () => stop("OWNER_CANCELLED"),
        exhaustBudget: () => stop("BUDGET_EXHAUSTED"),
        attempt: async (transport: OfflinePolatTransport, currentPolicy: unknown, expectedRequestHash: string) => {
            if (closed || busy)
                throw Error("POLAT_GUARD_CLOSED_OR_BUSY");
            const port = offlinePorts.get(transport);
            if (!port)
                throw Error("POLAT_GUARD_UNREGISTERED_TRANSPORT");
            const state = replay(journal.read());
            if (state.stopped)
                return { ...authority, disposition: "STOPPED", summary: summary(), observation: null, response: null };
            const previous = [...state.attempts.values()].find(a => a.reservation.target_hash === transport.target_hash);
            if (previous)
                return { ...authority, disposition: "ALREADY_RECORDED", summary: summary(), observation: null, response: null };
            if (expectedRequestHash !== transport.request_hash || port.request.rewriteFeedback !== undefined || requestFingerprint(port.request) !== transport.request_hash)
                throw Error("POLAT_GUARD_REQUEST_DRIFT");
            let latest: PolatGuardPolicy;
            try {
                latest = validateBinding(manifest, currentPolicy);
            }
            catch {
                stop("POLICY_UNAVAILABLE");
                return { ...authority, disposition: "STOPPED", summary: summary(), observation: null, response: null };
            }
            if (polatGuardDigest(latest) !== bindingHash) {
                stop("POLICY_DRIFT");
                return { ...authority, disposition: "STOPPED", summary: summary(), observation: null, response: null };
            }
            if (state.attempts.size >= state.header.maximum_requests) {
                stop("REQUEST_LIMIT_REACHED");
                return { ...authority, disposition: "STOPPED", summary: summary(), observation: null, response: null };
            }
            if (state.spent + state.reserved + units(policy.maximum_attempt_liability) > units(state.header.maximum_spend)) {
                stop("BUDGET_EXHAUSTED");
                return { ...authority, disposition: "STOPPED", summary: summary(), observation: null, response: null };
            }
            assertSafeContext(port.request.context);
            busy = true;
            controller = new AbortController();
            const attemptId = randomUUID();
            try {
                journal.append({ kind: "RESERVED", attempt_id: attemptId, target_hash: transport.target_hash, request_hash: polatGuardDigest({ fingerprint: transport.request_hash, timeout_ms: policy.timeout_ms, model_version: policy.model_version }), liability: policy.maximum_attempt_liability });
                const started = performance.now();
                let response: ModelResponse | null = null, failure: ModelProviderError | null = null, unknown = false;
                let timer: ReturnType<typeof setTimeout> | undefined;
                try {
                    const signal = controller.signal;
                    response = await Promise.race([port.invoke(signal), new Promise<never>((_, reject) => { timer = setTimeout(() => { unknown = true; reject(new ModelProviderError("TIMEOUT", "OFFLINE_DEADLINE_UNKNOWN", false)); controller?.abort(); }, policy.timeout_ms); signal.addEventListener('abort', () => { unknown = true; reject(new ModelProviderError("PROVIDER_ERROR", "OFFLINE_ABORT_UNKNOWN", false)); }, { once: true }); })]);
                }
                catch (error) {
                    failure = error instanceof ModelProviderError ? error : new ModelProviderError("PROVIDER_ERROR", "OFFLINE_FAILURE_REDACTED", false);
                    unknown ||= failure.code === "OFFLINE_RESULT_UNKNOWN" || failure.kind === "TIMEOUT";
                }
                finally {
                    if (timer)
                        clearTimeout(timer);
                }
                const elapsed = performance.now() - started, snapshot = replay(journal.read());
                let reason: StopReason | null = snapshot.stopped && snapshot.stopped !== "UNSETTLED_ATTEMPT" ? snapshot.stopped : unknown ? "RESULT_UNKNOWN" : null;
                if (!reason) {
                    try {
                        const after = validateBinding(manifest, currentPolicy);
                        if (polatGuardDigest(after) !== bindingHash)
                            reason = "POLICY_DRIFT";
                    }
                    catch {
                        reason = "POLICY_DRIFT";
                    }
                }
                if (!Number.isFinite(elapsed) || elapsed < 0)
                    reason = "CLOCK_INVALID";
                if (response && (response.provider !== policy.provider || response.model !== policy.model)) {
                    reason = "MODEL_MISMATCH";
                    failure = new ModelProviderError("INVALID_OUTPUT", "OFFLINE_MODEL_MISMATCH", false);
                    response = null;
                }
                const cost = unknown || reason === "OWNER_CANCELLED" ? null : port.script.billed_cost;
                if (!reason) {
                    if (!cost)
                        reason = "BILLING_UNKNOWN";
                    else if (cost.currency !== policy.currency)
                        reason = "CURRENCY_MISMATCH";
                    else if (units(cost.amount) > units(policy.maximum_attempt_liability))
                        reason = "COST_BOUND_BREACH";
                }
                const scope = { tenantId: port.prepared.input.tenant_id, conversationId: port.prepared.input.conversation_id, invocationId: attemptId, promptVersion: port.request.versions?.prompt ?? "unknown", personaVersion: POLAT_PROFILE.version };
                let observation = polatFixtureMeasurement(scope, Math.max(0, Number.isFinite(elapsed) ? elapsed : 0), response, failure);
                const quality = response ? assessPolatDraft(port.prepared, response.output) : null;
                const target = polatGuardInvocationTargets().find(t => t.target_hash === transport.target_hash)!;
                const expected = POLAT_MULTITURN_V2_CORPUS.find(s => s.id === target.scenario)!.turns[target.turn]!.expected;
                const critical = quality && (quality.qa.grounding.blocked || quality.reasons.some(r => ["POLAT_AI_DISCLOSURE_REQUIRED", "POLAT_IMPERSONATION_OR_FAMILIARITY", "POLAT_ACTION_PROPOSAL_DENIED", "POLAT_SECRET_OUTPUT_DENIED", "POLAT_OWNERSHIP_OR_CONTACT_BLOCK"].includes(r)));
                if (!reason && response && (critical || quality?.action !== "SAFE_PREVIEW" && expected !== "HOLD"))
                    reason = "QA_REVIEW_REQUIRED";
                observation = polatModelObservationSchema.parse({ ...observation, elapsed_ms: Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null, retry: "NONE", qa: quality?.action === "SAFE_PREVIEW" ? "APPROVED" : quality ? "HELD" : "NOT_EVALUATED", billing: cost && cost.currency === policy.currency ? { amount: cost.amount, currency: cost.currency, basis: "SIMULATED_PROVIDER_REPORT" } : null });
                const earlier = [...snapshot.attempts.values()].flatMap(a => a.result ? [a.result] : []);
                const errors = earlier.filter(r => r.status !== "SUCCEEDED").length + (observation.status === "SUCCEEDED" ? 0 : 1);
                const held = earlier.filter(r => r.qa === "HELD").length + (observation.qa === "HELD" ? 1 : 0);
                const evaluated = earlier.filter(r => r.qa !== "NOT_EVALUATED").length + (observation.qa === "NOT_EVALUATED" ? 0 : 1);
                if (!reason && errors * 10000 > manifest.fields.thresholds.errors_max_basis_points! * snapshot.attempts.size)
                    reason = "ERROR_THRESHOLD_REACHED";
                if (!reason && evaluated > 0 && held * 10000 > manifest.fields.thresholds.qa_holds_max_basis_points! * evaluated)
                    reason = "QA_THRESHOLD_REACHED";
                journal.append({ kind: "RESULT", attempt_id: attemptId, status: unknown ? "UNKNOWN" : observation.status, elapsed_ms: Number.isFinite(elapsed) && elapsed >= 0 ? String(elapsed) : null, observation_hash: modelEvidenceHash(observation), output_hash: response ? modelEvidenceHash(response.output) : null, pricing_estimate: port.script.pricing_estimate, billed_cost: cost, stop_reason: reason, qa: observation.qa, retry: "NONE" });
                return { ...authority, disposition: reason ? "STOPPED" : "RECORDED", summary: summary(), observation, response: reason ? null : response };
            }
            finally {
                busy = false;
                controller = null;
            }
        },
    });
}
