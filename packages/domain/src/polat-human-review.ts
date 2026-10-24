import { createHash, createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { POLAT_HUMAN_RUBRIC, polatReviewPackSchema, polatReviewRosterSchema, polatHumanRecordSchema, polatReviewScoresSchema, polatReviewContextSchema, polatReviewRecordSchema, type PolatHumanRecord, type PolatReviewPack, type PolatReviewer } from "@gold-revenue-os/contracts";
import { canonicalFinancialJson, parseFinancialJson } from "./financial-source-canonical";
import { POLAT_MULTITURN_V2_CORPUS, polatV2CorpusHash, polatOrdinaryTurnKey } from "./polat-multiturn-v2-corpus";
import { evaluatePolatMultiTurnV2 } from "./polat-multiturn-v2-evaluation";
const hash = (value: unknown) => createHash("sha256").update(canonicalFinancialJson(value), "utf8").digest("hex");
const chunks = (kind: string, items: readonly unknown[]) => { if (items.length > 1024)
    throw Error("POLAT_REVIEW_LIMIT"); const parts = []; for (let i = 0; i < items.length; i += 32)
    parts.push(hash(items.slice(i, i + 32))); return hash({ version: "POLAT_REVIEW_CHUNKS_V1", kind, parts }); };
const dangerous = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sb_secret_[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,})|\b\d{8,12}:[A-Za-z0-9_-]{30,}|-----BEGIN .*PRIVATE KEY-----/gu;
export function polatReviewTargets() {
    const corpusHash = polatV2CorpusHash();
    const ordinary = new Map<string, ReturnType<typeof target>[]>(), safety: ReturnType<typeof target>[] = [];
    function target(style: "DIRECT" | "ONE_QUESTION", scenario: typeof POLAT_MULTITURN_V2_CORPUS[number], turn: number) { const t = scenario.turns[turn]!; return { target_key: hash(["POLAT_REVIEW_TARGET_V1", corpusHash, style, scenario.id, turn]), style, scenario: scenario.id, turn, review_class: t.review_class as "ORDINARY" | "SAFETY_SENSITIVE", ordinary_distinct_key: polatOrdinaryTurnKey(t.text, t.expected_reply_language), language: t.expected_reply_language }; }
    for (const style of ["DIRECT", "ONE_QUESTION"] as const)
        for (const s of POLAT_MULTITURN_V2_CORPUS)
            for (const [i, t] of s.turns.entries()) {
                if (t.review_class === "CONTROL")
                    continue;
                const entry = target(style, s, i);
                if (t.review_class === "SAFETY_SENSITIVE")
                    safety.push(entry);
                else {
                    const key = JSON.stringify([style, t.expected_reply_language]), items = ordinary.get(key) ?? [];
                    items.push(entry);
                    ordinary.set(key, items);
                }
            }
    const chosen = [];
    for (const style of ["DIRECT", "ONE_QUESTION"])
        for (const lang of ["en", "tr"]) {
            const pool = [...(ordinary.get(JSON.stringify([style, lang])) ?? [])].sort((a, b) => a.target_key.localeCompare(b.target_key, "en")), seen = new Set<string>();
            const selected = pool.filter(x => { if (seen.has(x.ordinary_distinct_key))
                return false; seen.add(x.ordinary_distinct_key); return true; }).slice(0, 20);
            if (selected.length !== 20)
                throw Error("POLAT_REVIEW_ORDINARY_QUOTA_MISSING");
            chosen.push(...selected);
        }
    return [...chosen, ...safety].sort((a, b) => a.target_key.localeCompare(b.target_key, "en"));
}
function roster(raw: unknown) { const rows = polatReviewRosterSchema.parse(raw); if (new Set(rows.map(r => r.id)).size !== rows.length || new Set(rows.map(r => r.identity_reference_hash)).size !== rows.length || rows.filter(r => r.role === "REVIEWER").length !== 2 && rows.length !== 0 || rows.filter(r => r.role === "ADJUDICATOR").length > 1)
    throw Error("POLAT_REVIEW_INDEPENDENCE_INVALID"); return rows; }
export function polatReviewContextHash(raw: unknown) { const v = polatReviewContextSchema.parse(raw); return chunks("context", [...v.messages.map(m => hash(m)), ...v.approved_facts.map(f => hash(f)), hash(v.source_boundary)]); }
function sampleDigest(v: PolatReviewPack["samples"][number]) { return hash({ sample_id: v.sample_id, target_key: v.target_key, language: v.language, kind: v.output_kind, context_source: v.context_source, context_hash: polatReviewContextHash(v.context), output_hash: v.output_hash, raw_output_hash: v.raw_output_hash, raw_context_hash: v.raw_context_hash, redacted: v.redacted }); }
function packDigest(v: PolatReviewPack) { return hash({ version: v.version, corpus_hash: v.corpus_hash, repository_sha: v.repository_sha, rubric: v.rubric_version, selection: v.selection_policy, quota: v.ordinary_quota, safety: v.safety_policy, reviewers_hash: hash(v.reviewers), samples_hash: chunks("samples", v.samples.map(s => s.sample_hash)), index_hash: chunks("index", v.private_index.map(i => hash(i))) }); }
export type PolatCapturedReviewOutput = {
    target_key: string;
    context_hash: string;
    context: PolatReviewPack["samples"][number]["context"];
    reply: string | null;
};
const capturedSchema = z.strictObject({ target_key: z.string().regex(/^[a-f0-9]{64}$/u), context_hash: z.string().regex(/^[a-f0-9]{64}$/u), context: polatReviewContextSchema, reply: z.string().max(4096).nullable() });
/** Importing a model text never authenticates its provider or claims a real model test. */
export async function preparePolatReviewPack(args: {
    repositorySha: string;
    blindSeed: Uint8Array;
    reviewers?: readonly PolatReviewer[];
    captured?: readonly PolatCapturedReviewOutput[];
}) {
    if (!/^[a-f0-9]{40}$/u.test(args.repositorySha) || args.blindSeed.byteLength !== 32)
        throw Error("POLAT_REVIEW_PREPARATION_INVALID");
    const reviewers = roster(args.reviewers ?? []);
    const source = await evaluatePolatMultiTurnV2();
    if (!source.coverage_complete || source.variants.some(v => v.objective_passed !== v.scenario_count))
        throw Error("POLAT_REVIEW_SOURCE_NOT_ACCEPTED");
    const targets = polatReviewTargets(), captures = new Map<string, PolatCapturedReviewOutput>();
    for (const raw of args.captured ?? []) {
        const row = capturedSchema.parse(raw);
        if (captures.has(row.target_key) || !targets.some(t => t.target_key === row.target_key) || row.reply !== null && row.reply.length > 4096)
            throw Error("POLAT_REVIEW_CAPTURE_INVALID");
        captures.set(row.target_key, row);
    }
    const samples = [], index = [];
    for (const t of targets) {
        const turn = source.variants.find(v => v.style === t.style)!.cases.find(c => c.id === t.scenario)!.turns[t.turn]!;
        if (!("review_context" in turn) || !turn.review_context)
            throw Error("POLAT_REVIEW_CONTEXT_MISSING");
        const capture = captures.get(t.target_key), rawContext = capture?.context ?? turn.review_context, rawContextHash = polatReviewContextHash(rawContext), context = { ...rawContext, messages: rawContext.messages.map(m => ({ ...m, text: m.text.replace(dangerous, "[REDACTED_SECRET]") })) }, contextHash = polatReviewContextHash(context);
        if (capture && (capture.context_hash !== rawContextHash || context.source_boundary !== turn.review_context.source_boundary || canonicalFinancialJson(context.approved_facts) !== canonicalFinancialJson(turn.review_context.approved_facts)))
            throw Error("POLAT_REVIEW_CONTEXT_DRIFT");
        // All preselected targets remain present, even when a captured output is absent or bad.
        const raw = args.captured ? capture?.reply ?? null : turn.reply_preview, reply = raw === null ? null : raw.replace(dangerous, "[REDACTED_SECRET]"), id = createHmac("sha256", args.blindSeed).update(t.target_key).digest("hex");
        const sample = { sample_id: id, target_key: t.target_key, language: t.language, output_kind: args.captured ? "UNVERIFIED_MODEL_OUTPUT" as const : "FIXTURE" as const, context_source: args.captured ? capture ? "UNVERIFIED_CAPTURE_CONTEXT" as const : "MISSING_CAPTURE_CONTEXT" as const : "FIXTURE_CONTEXT" as const, context, reply, output_hash: hash({ reply, context_hash: contextHash }), raw_output_hash: hash({ reply: raw }), raw_context_hash: rawContextHash, redacted: raw !== reply || rawContextHash !== contextHash, sample_hash: "0".repeat(64) };
        sample.sample_hash = sampleDigest(sample);
        samples.push(sample);
        index.push({ sample_id: id, ...t });
    }
    samples.sort((a, b) => a.sample_id.localeCompare(b.sample_id, "en"));
    index.sort((a, b) => a.sample_id.localeCompare(b.sample_id, "en"));
    const pack: PolatReviewPack = { version: 1, kind: "OFFLINE_REVIEW_PACK", corpus_version: "polat-multiturn-v2", corpus_hash: polatV2CorpusHash(), repository_sha: args.repositorySha, rubric_version: "polat-human-rubric-v1", selection_policy: "DETERMINISTIC_SOURCE_SELECTION_BEFORE_OUTPUT_SCORING", ordinary_quota: 20, safety_policy: "ALL_DESIGNATED_SAFETY_TURNS", reviewers, samples, private_index: index, pack_hash: "0".repeat(64), financial_authority: "NONE", live_operations_authorized: false, real_model_execution: false, commercial_verdict: "NO_GO" };
    pack.pack_hash = packDigest(pack);
    return verifyPolatReviewPack(pack);
}
export function verifyPolatReviewPack(raw: unknown) {
    const p = polatReviewPackSchema.parse(raw), expected = polatReviewTargets();
    roster(p.reviewers);
    if (p.corpus_hash !== polatV2CorpusHash() || p.pack_hash !== packDigest(p) || p.samples.length !== expected.length || p.private_index.length !== expected.length || new Set(p.samples.map(s => s.sample_id)).size !== p.samples.length || new Set(p.private_index.map(i => i.target_key)).size !== expected.length)
        throw Error("POLAT_REVIEW_PACK_DRIFT");
    for (const i of p.private_index) {
        const t = expected.find(t => t.target_key === i.target_key), s = p.samples.find(s => s.sample_id === i.sample_id);
        if (!t || !s)
            throw Error("POLAT_REVIEW_TARGET_MISSING");
        if (s.target_key !== i.target_key || s.language !== t.language || i.style !== t.style || i.language !== t.language || i.scenario !== t.scenario || i.turn !== t.turn || i.review_class !== t.review_class || i.ordinary_distinct_key !== t.ordinary_distinct_key || s.sample_hash !== sampleDigest(s) || s.output_hash !== hash({ reply: s.reply, context_hash: polatReviewContextHash(s.context) }) || !s.redacted && (s.raw_output_hash !== hash({ reply: s.reply }) || s.raw_context_hash !== polatReviewContextHash(s.context)))
            throw Error("POLAT_REVIEW_TARGET_DRIFT");
        const source = POLAT_MULTITURN_V2_CORPUS.find(x => x.id === i.scenario)!.turns[i.turn]!;
        const allowed = POLAT_MULTITURN_V2_CORPUS.find(x => x.id === i.scenario)!.turns.slice(0, i.turn + 1).filter(t => !t.duplicate).map(t => t.text), actual = s.context.messages.filter(m => m.direction === "inbound").map(m => m.text);
        if (s.context.messages.at(-1)?.direction !== "inbound" || s.context.messages.at(-1)?.text !== source.text || actual.length > allowed.length || actual.some((text, n) => text !== allowed[allowed.length - actual.length + n]))
            throw Error("POLAT_REVIEW_SOURCE_DRIFT");
    }
    return p;
}
/** Never export style/index/scenario/target keys, QA labels or the other reviewer's scores. */
export function blindPolatReviewMaterial(raw: unknown, reviewerId: string | null) { const p = verifyPolatReviewPack(raw); if (reviewerId !== null && !p.reviewers.some(r => r.id === reviewerId && r.role === "REVIEWER"))
    throw Error("POLAT_REVIEWER_UNASSIGNED"); return { version: 1, kind: "BLIND_REVIEW_MATERIAL", pack_hash: p.pack_hash, corpus_version: p.corpus_version, corpus_hash: p.corpus_hash, reviewer_id: reviewerId, rubric_version: p.rubric_version, items: p.samples.map(({ sample_id, language, output_kind, context_source, context, reply, output_hash, redacted }) => ({ sample_id, language, output_kind, context_source, context, reply, output_hash, redacted })), human_state: "HUMAN_REVIEW_PENDING", naturalness: "NATURALNESS_NOT_MEASURED", real_model: "REAL_MODEL_NOT_TESTED", conversion: "CUSTOMER_CONVERSION_UNKNOWN" } as const; }
export function polatReviewRecordHash(raw: Omit<PolatHumanRecord, "record_hash">) { return hash(raw); }
const formSchema = z.strictObject({ sample_id: z.string().regex(/^[a-f0-9]{64}$/u), output_hash: z.string().regex(/^[a-f0-9]{64}$/u), scores: polatReviewScoresSchema, safety_failure: z.boolean(), unsupported_commercial_claim: z.boolean(), notes: z.string().max(500) });
/** Seal only supplied scores. No default, inference or automatic rating. Hashes are integrity, not human identity. */
export function sealPolatReviewForms(packRaw: unknown, reviewerId: string, forms: readonly unknown[], origin: "SIMULATED_TEST_VALIDATION" | "HUMAN_SUBMITTED_UNVERIFIED") {
    const p = verifyPolatReviewPack(packRaw);
    if (!p.reviewers.some(r => r.id === reviewerId && r.role === "REVIEWER") || forms.length !== p.samples.length)
        throw Error("POLAT_REVIEW_FORMS_INCOMPLETE");
    let previous: string | null = null;
    const seen = new Set<string>();
    return forms.map(raw => { const f = formSchema.parse(raw), sample = p.samples.find(s => s.sample_id === f.sample_id); if (!sample || sample.output_hash !== f.output_hash || seen.has(f.sample_id) || new RegExp(dangerous.source, "u").test(f.notes))
        throw Error("POLAT_REVIEW_FORM_INVALID"); seen.add(f.sample_id); const body = { version: 1 as const, kind: "REVIEW" as const, submission_id: randomUUID(), pack_hash: p.pack_hash, sample_id: f.sample_id, output_hash: f.output_hash, rubric_version: p.rubric_version, reviewer_id: reviewerId, origin, scores: f.scores, safety_failure: f.safety_failure, unsupported_commercial_claim: f.unsupported_commercial_claim, notes: f.notes, previous_record_hash: previous }; const record = polatReviewRecordSchema.parse({ ...body, record_hash: polatReviewRecordHash(body) }); previous = record.record_hash; return record; });
}
export function parsePolatReviewJsonLines(raw: string) { if (Buffer.byteLength(raw, "utf8") > 4 * 1024 * 1024)
    throw Error("POLAT_REVIEW_FILE_LIMIT"); const lines = raw.split(/\r?\n/u).filter(Boolean); if (lines.length > 1024)
    throw Error("POLAT_REVIEW_RECORD_LIMIT"); return lines.map(line => polatHumanRecordSchema.parse(parseFinancialJson(line))); }
export function validatePolatHumanReviews(packRaw: unknown, recordsRaw: readonly unknown[]) {
    const p = verifyPolatReviewPack(packRaw);
    if (recordsRaw.length > 1024)
        throw Error("POLAT_REVIEW_RECORD_LIMIT");
    const chain = new Map<string, string>(), ids = new Map<string, string>(), reviewPairs = new Map<string, PolatHumanRecord>(), records: PolatHumanRecord[] = [], adjudications: PolatHumanRecord[] = [];
    for (const raw of recordsRaw) {
        const r = polatHumanRecordSchema.parse(raw), { record_hash, ...body } = r, s = p.samples.find(s => s.sample_id === r.sample_id), actor = p.reviewers.find(a => a.id === r.reviewer_id);
        if (!s || !actor || r.pack_hash !== p.pack_hash || r.output_hash !== s.output_hash || record_hash !== polatReviewRecordHash(body))
            throw Error("POLAT_REVIEW_RECORD_DRIFT");
        const existing = ids.get(r.submission_id);
        if (existing) {
            if (existing !== record_hash)
                throw Error("POLAT_REVIEW_REPLAY_CONFLICT");
            throw Error("POLAT_REVIEW_DUPLICATE_SUBMISSION");
        }
        ids.set(r.submission_id, record_hash);
        if (r.kind === "ADJUDICATION") {
            if (actor.role !== "ADJUDICATOR")
                throw Error("POLAT_REVIEW_ADJUDICATOR_INVALID");
            adjudications.push(r);
            continue;
        }
        if (actor.role !== "REVIEWER" || r.previous_record_hash !== (chain.get(actor.id) ?? null) || new RegExp(dangerous.source, "u").test(r.notes))
            throw Error("POLAT_REVIEW_CHAIN_INVALID");
        chain.set(actor.id, record_hash);
        const key = JSON.stringify([r.reviewer_id, r.sample_id]);
        if (reviewPairs.has(key))
            throw Error("POLAT_REVIEW_LOGICAL_DUPLICATE");
        reviewPairs.set(key, r);
        records.push(r);
    }
    for (const d of adjudications) {
        const refs = records.filter(r => r.sample_id === d.sample_id && r.kind === "REVIEW");
        if (d.kind !== "ADJUDICATION" || new RegExp(dangerous.source, "u").test(d.reason) || refs.length !== 2 || refs.some(r => !d.review_hashes.includes(r.record_hash)) || d.review_hashes[0] === d.review_hashes[1] || refs.some(r => r.origin !== d.origin))
            throw Error("POLAT_REVIEW_ADJUDICATION_DRIFT");
    }
    let paired = 0, missing = 0, disagreements = 0, adjudicated = 0, safety = 0;
    const unresolved: string[] = [];
    for (const s of p.samples) {
        const pair = records.filter(r => r.sample_id === s.sample_id && r.kind === "REVIEW");
        if (pair.length !== 2) {
            missing++;
            continue;
        }
        paired++;
        const [a, b] = pair as [
            Extract<PolatHumanRecord, {
                kind: "REVIEW";
            }>,
            Extract<PolatHumanRecord, {
                kind: "REVIEW";
            }>
        ];
        if (a.origin !== b.origin)
            throw Error("POLAT_REVIEW_ORIGIN_CONFLICT");
        if (a.safety_failure || b.safety_failure || a.unsupported_commercial_claim || b.unsupported_commercial_claim)
            safety++;
        const differs = POLAT_HUMAN_RUBRIC.some(k => a.scores[k] !== b.scores[k]) || a.safety_failure !== b.safety_failure || a.unsupported_commercial_claim !== b.unsupported_commercial_claim;
        const decisions = adjudications.filter(r => r.sample_id === s.sample_id);
        if (decisions.length > 1)
            throw Error("POLAT_REVIEW_ADJUDICATION_CONFLICT");
        for (const d of decisions) {
            if (d.kind !== "ADJUDICATION" || !d.review_hashes.includes(a.record_hash) || !d.review_hashes.includes(b.record_hash) || d.review_hashes[0] === d.review_hashes[1])
                throw Error("POLAT_REVIEW_ADJUDICATION_DRIFT");
        }
        if (differs) {
            disagreements++;
            if (decisions.length)
                adjudicated++;
            else
                unresolved.push(s.sample_id);
        }
    }
    const submitted_scores = Object.fromEntries(POLAT_HUMAN_RUBRIC.map(key => { const values = records.flatMap(r => r.kind === "REVIEW" ? [r.scores[key]] : []), sum = values.reduce((a, b) => a + b, 0); return [key, { sum, sample: values.length, mean: values.length ? sum / values.length : null }]; }));
    return { version: 1, revision_requests: adjudications.filter(r => r.kind === "ADJUDICATION" && r.resolution === "REQUIRES_NEW_OUTPUT").length, submitted_scores: { classification: records.every(r => r.origin === "SIMULATED_TEST_VALIDATION") ? "SIMULATED_VALIDATION_ONLY" : "SUBMITTED_UNVERIFIED_HUMAN_AUTHORSHIP", dimensions: submitted_scores }, validation: adjudications.some(r => r.kind === "ADJUDICATION" && r.resolution === "REQUIRES_NEW_OUTPUT") ? "NEW_OUTPUT_REQUIRED" : missing ? "INCOMPLETE" : p.samples.some(s => s.reply === null || s.redacted) ? "CAPTURE_REVIEW_REQUIRED" : unresolved.length ? "ADJUDICATION_REQUIRED" : safety ? "SAFETY_REVIEW_REQUIRED" : "RECORDS_VALIDATED_NOT_HUMAN_ACCEPTANCE", samples: p.samples.length, paired, missing, disagreements, adjudicated, safety_flagged_samples: safety, missing_outputs: p.samples.filter(s => s.reply === null || s.redacted).length, simulated_records: records.filter(r => r.origin === "SIMULATED_TEST_VALIDATION").length, human_submitted_unverified_records: records.filter(r => r.origin === "HUMAN_SUBMITTED_UNVERIFIED").length, actual_verified_human_reviews: 0, human_state: "HUMAN_REVIEW_PENDING", naturalness: "NATURALNESS_NOT_MEASURED", real_model: "REAL_MODEL_NOT_TESTED", conversion: "CUSTOMER_CONVERSION_UNKNOWN", identity_authority: "EXTERNAL_OWNER_VERIFICATION_REQUIRED", thresholds: "PROPOSED_NOT_APPROVED", financial_authority: "NONE", live_operations_authorized: false, real_model_execution: false, commercial_verdict: "NO_GO" } as const;
}
/** Only completed independent data may be unblinded; this still grants no human/model acceptance. */
export function unblindPolatReviewResults(packRaw: unknown, records: readonly unknown[]) { const p = verifyPolatReviewPack(packRaw), summary = validatePolatHumanReviews(p, records); if (summary.missing !== 0 || summary.paired !== p.samples.length)
    throw Error("POLAT_REVIEW_UNBLINDING_PREMATURE"); return { summary, index: p.private_index, classification: "COMPLETED_SUBMISSIONS_IDENTITY_UNVERIFIED", financial_authority: "NONE", live_operations_authorized: false } as const; }
