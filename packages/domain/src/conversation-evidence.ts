import { z } from "zod";
import { SPEECH_ACTS, CONVERSATION_CAPABILITIES, inferredSpeechAct, validateServiceSpeechAct, isConversationalClarificationOffer, isMembershipClarificationQuestion, type ConversationCapability } from "./speech-acts";

export const CLAIM_GROUNDINGS = ["KNOWN_FROM_SYSTEM", "VERIFIED_BY_TOOL", "CUSTOMER_REPORTED", "INFERRED", "GENERAL_SAFE_STATEMENT", "UNKNOWN", "UNSUPPORTED_CLAIM"] as const;
export const ACTION_CATEGORIES = ["message_sent", "escalation_created", "forwarded", "payment_confirmed", "access_active", "account_checked", "team_contacted", "subscription_updated", "memory_written", "account_updated", "payment_checked"] as const;
export const responseClaimSchema = z.object({
  text: z.string().trim().min(1).max(4096),
  kind: z.enum(["social", "uncertainty", "question", "fact", "completed_action"]),
  speech_act: z.enum(SPEECH_ACTS).optional(),
  capability: z.enum(CONVERSATION_CAPABILITIES).nullable().optional(),
  grounding: z.enum(CLAIM_GROUNDINGS),
  evidence_refs: z.array(z.string().min(1).max(160)).max(12),
  action_category: z.enum(ACTION_CATEGORIES).nullable(),
}).strict();
export type ResponseClaim = z.infer<typeof responseClaimSchema>;
export type BackendEvidence = {
  id: string; tenantId: string; conversationId: string; occurredAt: string;
  status: "completed"; category: (typeof ACTION_CATEGORIES)[number] | "fact";
  // Exact authorized statement, supplied by deterministic services, never the model.
  statement: string;
};
export function normalizeConversationText(text: string): string {
  return text.normalize("NFKC").replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu, "")
    .toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ").replace(/\s+/gu, " ").trim();
}
export function splitResponseSentences(text: string): string[] {
  return text.trim().split(/(?<=[.!?؟。！])\s+/u).filter(Boolean);
}
const uncertaintyPattern = /(?:\b(?:don['’]t|do not|can['’]t|cannot|not available|not confirmed|unknown|unsure|needs? (?:review|verification)|need to (?:check|verify|escalate)|haven['’]t|have not)\b|bilgi.*(?:yok|mevcut değil)|bilmiyorum|göremiyorum|(?:detay|bilgi|fiyat)[^.!?؟]*(?:görünmüyor|görünmemekte)|elimizde.*yok|doğrulayam|henüz.*(?:yok|değil)|inceleme(?:si)? gerekiyor|kontrol etmek gerekir|netleştir|(?<!\p{L})(?:لا|ليس|ليست|غير)(?!\p{L})|يحتاج.*مراجعة|(?:нет|не имею|не могу|не знаю|не подтвержден|нужно проверить|требует проверки))/iu;
// An honest qualifier does not ground an affirmative product clause in the same
// sentence. These conservative predicates supplement claim typing, not replace it.
const unverifiedProductAssertion = /(?:\b(?:membership|subscription|plan|access)\s+(?:is|are|provides|includes|costs|renews|gives|grants)\b|\byou\s+(?:get|receive|gain|will get)\s+(?:access|signals|benefits|profits|returns)|(?:üyelik|abonelik|seçenek|plan)[^.!?؟]*(?:sağlar|içerir|yenilenir|ayrı bir plandır)|(?:العضوية\s+هي|الاشتراك\s+هو|اشتراك\s+يوفّر|العضوية\s+(?:تشمل|توفر))|(?:подписка|тариф)\s+(?:это|даёт|дает|включает|предоставляет|стоит))/iu;
const completedActions: ReadonlyArray<[(typeof ACTION_CATEGORIES)[number], RegExp]> = [
  ["message_sent", /(?:\b(?:I (?:have |already )?sent|I['’]ve sent)\b|gönderdim|أرسلت|ارسلت|я отправил)/iu],
  ["escalation_created", /(?:\b(?:I (?:have )?escalated|I['’]ve escalated|I['’]ve passed|I passed|has been escalated|was escalated)\b|ilettim|aktardım|صعّدت|تم تصعيد|передал.*(?:специалист|человек)|эскалиров)/iu],
  ["forwarded", /(?:\b(?:I (?:have )?forwarded|I['’]ve forwarded|has been forwarded|was forwarded)\b|yönlendirdim|تم تحويل|حوّلت|перенаправил)/iu],
  ["payment_confirmed", /(?:\b(?:payment (?:is |has been |was )?(?:confirmed|verified|received)|confirmed your payment)\b|ödemeniz.*(?:onaylandı|doğrulandı|alındı)|تم تأكيد.*(?:الدفع|دفعتك)|الدفع مؤكد|(?:платёж|платеж|оплата).*подтвержд)/iu],
  ["access_active", /(?:\b(?:access (?:is |has been |was )?(?:active|activated|granted)|activated your access)\b|erişiminiz.*(?:aktif|açıldı)|تم تفعيل.*(?:الوصول|دخول)|الوصول.*مفعل|доступ.*(?:активирован|открыт|предоставлен))/iu],
  ["account_checked", /(?:\b(?:I (?:have )?checked|I['’]ve checked|I (?:have )?reviewed|I['’]ve reviewed)\b|hesabınızı.*(?:kontrol ettim|inceledim)|راجعت.*حساب|تحققت.*حساب|проверил.*(?:аккаунт|счёт|счет))/iu],
  ["team_contacted", /(?:\b(?:I (?:have )?(?:spoken|spoke|talked|checked) (?:with|to) (?:the |my )?(?:team|colleague)|I['’]ve (?:spoken|talked) (?:with|to))\b|ekiple.*görüştüm|konuştum|تحدثت.*(?:الفريق|زميل)|поговорил.*(?:команд|коллег))/iu],
  ["subscription_updated", /(?:\b(?:I (?:have )?updated|I['’]ve updated|subscription (?:has been |was |is )?updated)\b|aboneliğinizi.*güncelledim|تم تحديث.*اشتراك|حدّثت.*اشتراك|подписк.*обновлен)/iu],
  ["memory_written", /(?:\b(?:I (?:have )?saved|I['’]ve saved|permanent preference.*saved)\b|tercih.*kaydetti|حفظت.*تفضيل|сохранил.*предпочтен)/iu],
  ["account_updated", /(?:updated your account|account (?:was|has been) updated|hesab.*güncelledim|تم تحديث.*حساب|аккаунт.*обновлен)/iu],
  ["payment_checked", /(?:checked your payment|payment (?:was|has been) checked|ödeme.*kontrol ettim|راجعت.*دفع|проверил.*оплат)/iu],
];
export function detectedCompletedActions(text: string): (typeof ACTION_CATEGORIES)[number][] {
  // Negation is local to its predicate. An uncertainty clause cannot launder an
  // affirmative "but I've escalated it" in the same sentence.
  const affirmative = text.replace(/\b(?:I (?:have not|haven['’]t)|I (?:did not|didn['’]t)|I never)\s+(?:sent|send|escalated|escalate|forwarded|forward|checked|check|updated|update)\b/giu, "")
    .replace(/\b(?:payment|access|subscription)\s+(?:is|was|has been)\s+(?:not|never)\s+(?:confirmed|verified|received|active|activated|granted|updated)\b/giu, "");
  return [...new Set(completedActions.filter(([, pattern]) => pattern.test(affirmative)).map(([category]) => category))];
}

export function reviewClaimGrounding(input: {
  response: string; claims: readonly ResponseClaim[]; modelConfidence: number;
  tenantId?: string | undefined; conversationId?: string | undefined; boundary?: string | undefined;
  messages: ReadonlyArray<{ id?: string; direction: string; content: string }>;
  backendEvidence?: readonly BackendEvidence[] | undefined;
  language?: string | undefined;
  availableCapabilities?: readonly ConversationCapability[] | undefined;
  guaranteedCommitments?: readonly ConversationCapability[] | undefined;
}) {
  const reasons: string[] = [];
  const normalized = normalizeConversationText(input.response);
  const covered = normalizeConversationText(input.claims.map((claim) => claim.text).join(" "));
  if (!input.claims.length || normalized !== covered) reasons.push("CLAIM_COVERAGE_INVALID");
  const evidence = (input.backendEvidence ?? []).filter((item) => item.tenantId === input.tenantId
    && item.conversationId === input.conversationId && item.status === "completed"
    && Boolean(input.boundary) && Date.parse(item.occurredAt) <= Date.parse(input.boundary ?? ""));
  const actionFailures = detectedCompletedActions(input.response).filter((category) => !input.claims.some((claim) =>
    claim.kind === "completed_action" && claim.action_category === category && evidence.some((item) =>
      item.category === category && claim.evidence_refs.includes(item.id)
      && normalizeConversationText(item.statement) === normalizeConversationText(claim.text))));
  if (actionFailures.length) reasons.push("ACTION_RECEIPT_REQUIRED");
  const claims = input.claims.map((claim) => {
    const speechAct = claim.speech_act ?? inferredSpeechAct(claim);
    let score = 0;
    let valid = false;
    if (claim.kind === "question") valid = /[?؟]\s*$/u.test(claim.text)
      || /^İsterseniz hangi üyelikten bahsettiğinizi yazın, daha net yardımcı olayım[.!]?$/iu.test(claim.text.normalize("NFKC").trim());
    if (claim.kind === "uncertainty") valid = uncertaintyPattern.test(claim.text)
      || /^(?:üyeliğin|aboneliğin) (?:fiyatı ve içeriğiyle|fiyatıyla|içeriğiyle) ilgili (?:net|kesin) bilgiye (?:şu an |henüz )?sahip değilim[.!]?$/iu.test(claim.text.normalize("NFKC").trim());
    if (claim.kind === "social") valid = !detectedCompletedActions(claim.text).length
      && (speechAct === "IDENTITY_RESPONSE"
        ? /\b(?:AI|automated)\b|yapay|اصطناعي|искусственн/iu.test(claim.text)
        : validateServiceSpeechAct({ act: speechAct, text: claim.text, language: input.language,
          capability: claim.capability, availableCapabilities: input.availableCapabilities ?? ["conversation.reply", "conversation.prepare_review"],
          guaranteedCommitments: input.guaranteedCommitments ?? [] }));
    const exactIdentity = speechAct === "IDENTITY_RESPONSE" && [
      "i m an ai assistant not a human", "i am an ai assistant not a human", "i m an ai assistant", "i am an ai assistant",
      "i m an ai not a real human", "i am an ai not a real human",
      "i m an ai not a human", "i am an ai not a human", "i m an ai", "i am an ai",
      "i m an ai assistant that helps answer questions and clarify what you need",
      "i am an ai assistant that helps answer questions and clarify what you need",
      "ben bir yapay zeka asistanıyım insan değilim", "ben bir yapay zeka asistanıyım",
      "أنا مساعد ذكاء اصطناعي ولست إنسانا", "я ии помощник а не человек",
    ].includes(normalizeConversationText(claim.text)) && ["KNOWN_FROM_SYSTEM", "GENERAL_SAFE_STATEMENT"].includes(claim.grounding);
    if (exactIdentity) { valid = true; score = 100; }
    else if (["fact", "completed_action"].includes(claim.kind)) {
      if (["KNOWN_FROM_SYSTEM", "VERIFIED_BY_TOOL"].includes(claim.grounding)) {
        valid = evidence.some((item) => claim.evidence_refs.includes(item.id)
          && normalizeConversationText(item.statement) === normalizeConversationText(claim.text)
          && item.category === (claim.kind === "completed_action" ? claim.action_category : "fact"));
        score = valid ? 100 : 0;
      } else if (claim.grounding === "CUSTOMER_REPORTED") {
        // Explicit attribution is required; customer-reported payment is never backend confirmation.
        valid = /(?:you (?:said|reported|mentioned|mean)|you['’]re (?:reporting|asking (?:about|for))|söyledi|belirtti|bildirdi|ذكرت|أفدت|сообщили|сказали)/iu.test(claim.text)
          && claim.evidence_refs.length > 0 && claim.evidence_refs.every((id) => input.messages.some((m) => m.id === id && m.direction === "inbound"));
        score = valid ? 70 : 0;
      } else if (claim.grounding === "INFERRED") {
        valid = /(?:may|might|appears|seems|olabilir|görün|ربما|يبدو|возможно|похоже)/iu.test(claim.text)
          && claim.evidence_refs.length > 0 && claim.evidence_refs.every((id) => input.messages.some((m) => m.id === id));
        score = valid ? 50 : 0;
      }
    } else score = valid ? 100 : 0; // Honesty/question safety, not certainty about the missing price.
    if (claim.kind !== "completed_action" && detectedCompletedActions(claim.text).length) valid = false;
    if (["uncertainty", "social", "question"].includes(claim.kind)
      && ((unverifiedProductAssertion.test(claim.text) && !(valid && ((claim.kind === "social" && isConversationalClarificationOffer(claim.text))
          || (claim.kind === "question" && isMembershipClarificationQuestion(claim.text)))))
        || /(?:[$€₽]\s*\p{N}|\p{N}\s*(?:usd|eur|tl|руб|دولار))/iu.test(claim.text))) valid = false;
    if (claim.grounding === "UNSUPPORTED_CLAIM") valid = false;
    if (claim.evidence_refs.some((ref) => !input.messages.some((message) => message.id === ref)
      && !evidence.some((item) => item.id === ref))) {
      valid = false; reasons.push("EVIDENCE_REFERENCE_NOT_ALLOWED");
    }
    if (speechAct === "COMPLETED_ACTION" && claim.kind !== "completed_action") valid = false;
    if (["BACKEND_FACT", "BUSINESS_FACT", "CUSTOMER_REPORTED_FACT"].includes(speechAct) && claim.kind !== "fact") valid = false;
    if (/\b(?:system|developer) (?:prompt|instructions)\s*:|سياست.*النظام\s*:|системн.*промпт\s*:/iu.test(claim.text)) { valid = false; reasons.push("HIDDEN_INSTRUCTION_DISCLOSURE"); }
    if (!valid) reasons.push("UNSUPPORTED_CLAIM");
    return { ...claim, speech_act: speechAct, validated: valid, evidence_confidence: valid ? score : 0 };
  });
  const asserted = claims.filter((claim) => ["fact", "completed_action"].includes(claim.kind));
  const factualConfidence = asserted.length ? Math.min(...asserted.map((claim) => claim.evidence_confidence)) : 100;
  return { model_confidence: input.modelConfidence, grounding_confidence: claims.length ? Math.min(...claims.map((claim) => claim.evidence_confidence)) : 0,
    factual_confidence: factualConfidence, factual_assertion_count: asserted.length, claims,
    grounded_assertion_score: asserted.length ? factualConfidence : null,
    verified_business_knowledge_available: evidence.some((item) => item.category === "fact"),
    unsupported_assertion_count: asserted.filter((claim) => !claim.validated).length,
    action_receipt_failures: actionFailures, reasons: [...new Set(reasons)], blocked: reasons.length > 0 };
}

export function validateMemoryProposals<T extends { key: string; classification: string; provenance_message_ids: string[] }>(proposals: readonly T[], messages: ReadonlyArray<{ id: string; direction: string; content: string }>) {
  const accepted: T[] = [];
  const rejected: Array<{ key: string; reason: string; provenance_message_ids: string[] }> = [];
  for (const proposal of proposals) {
    if (!proposal.provenance_message_ids.length || proposal.provenance_message_ids.some((id) => !messages.some((m) => m.id === id && m.direction === "inbound"))) {
      rejected.push({ key: proposal.key, reason: "PROVENANCE_NOT_IN_BOUNDED_INBOUND_CONTEXT", provenance_message_ids: proposal.provenance_message_ids });
      continue;
    }
    const languagePreference = /language|locale|dil|язык|لغة/iu.test(proposal.key);
    const explicitPreference = proposal.provenance_message_ids.some((id) => messages.some((m) => m.id === id
      && /(?:prefer.*(?:replies|responses|language)|always (?:speak|reply|respond)|please (?:speak|reply|respond)|hep.*(?:konuş|yaz)|(?:lütfen|lutfen).*(?:konuş|yaz)|تحدث.*(?:دائما|دائماً)|(?:всегда|пожалуйста).*(?:говори|отвечай))/iu.test(m.content)));
    accepted.push(languagePreference && proposal.classification === "explicit_customer_fact" && !explicitPreference
      ? { ...proposal, classification: "inferred_preference" } : proposal);
  }
  return { accepted, rejected };
}
