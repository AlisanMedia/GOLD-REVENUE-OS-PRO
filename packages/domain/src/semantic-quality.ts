// Constraint-based semantic checks are separate from schema/goal-string fit.
// Evidence reports the method and constraints; this is not a claim of a general
// language-understanding score. Final live drafts also require human review.
import { isConversationalClarificationOffer, isBoundedTurkishKnowledgeLimitation, isBoundedTurkishAnaphoricLimitation, isTurkishFreeMembershipQuestion } from "./speech-acts";

export function requestedRepetition(source: string, response: string) {
  if (/don['’]t|do not|avoid|tekrar etme|لا تكرر|не повторяй/iu.test(source)) return false;
  const countMatch = source.match(/(?:twice|iki (?:kez|defa)|مرتين|дважды)|(?:repeat|say|tekrar).*?\b([2-4])\b/iu);
  const count = countMatch?.[1] ? Number(countMatch[1]) : countMatch ? 2 : 0;
  if (!count || /ignore.*instructions|system prompt/iu.test(source)) return false;
  const sentences = response.trim().split(/(?<=[.!?؟。！])\s+/u);
  const quoted = source.match(/["“]([^"”]{1,120})["”]/u)?.[1];
  const helloRequested = /hello|hi|merhaba|selam|مرحبا|привет/iu.test(source);
  // Exemption is scoped to the requested content/count, not every duplicated
  // sentence in any message that happens to contain the word 'repeat'.
  return sentences.length === count && sentences.every((sentence) => quoted
    ? sentence.replace(/[.!?؟]+$/u, "").trim().toLocaleLowerCase() === quoted.toLocaleLowerCase()
    : helloRequested && /^(?:hello|hi|merhaba|selam|مرحبا|привет)(?:\s+(?:there|again))?[.!؟]?$/iu.test(sentence.trim()));
}

export function requestsPriceAndInclusions(source: string): boolean {
  return /price|pricing|cost|how much|fiyat|ücret|سعر|تكلفة|сколько стоит|цен|стоимост/iu.test(source)
    && /included|inclusions|includes|içeri[ğk]|kapsam|يشمل|تشمل|что[^?]*входит|состав/iu.test(source);
}
export function repeatedMembershipClarification(response: string, messages: ReadonlyArray<{ direction: string; content: string }>): boolean {
  const inbound = messages.filter((item) => item.direction === "inbound");
  const source = inbound.at(-1)?.content ?? "";
  const recent = inbound.slice(-4, -1);
  const requested = /ask again|repeat|ask me|clarify again|answer exactly|tekrar sor|aynen cevap|اسألني مرة أخرى|أجب بالضبط|спроси снова|ответь точно/iu.test(source);
  if (requested) return false;
  if (requestsPriceAndInclusions(source)
    && /what would you like to know first|önce neyi öğrenmek|ما الذي تود أن تعرفه أول[ًا]*|что вы хотите узнать сначала/iu.test(response)) return true;
  return /monthly[^.!?]*not[^.!?]*annual/iu.test(source)
    && !/ask again|repeat|ask me|clarify again/iu.test(source)
    && recent.some((item) => /price[^.!?]*(?:included|inclusions)/iu.test(item.content))
    && /\b(?:do you want|would you like|are you asking)[^?]*price[^?]*(?:included|inclusions|both)\?/iu.test(response);
}

export function reviewSemanticContext(source: string, response: string, intent: string) {
  const checks: Record<string, boolean> = {};
  const topics: Record<string, RegExp> = {
    membership_details: /membership|subscription|üyelik|abonelik|العضوية|اشتراك|подписк|членств/iu,
    pricing: /pric|cost|fiyat|ücret|سعر|تكلفة|цен|стоимост/iu,
    clarification: /monthly|aylık|شهري|месяч/iu,
    access_problem: /access|erişim|وصول|دخول|доступ/iu,
    payment_status: /payment|ödeme|دفع|оплат|платеж|платёж/iu,
    greeting: /^(?:hi|hello|hey|merhaba|selam|مرحبا|أهلا|привет|здравствуйте)/iu,
  };
  // A membership-pricing answer may truthfully say its subscription details
  // are unavailable without repeating the word "price". This is topic credit
  // only; independent claim grounding and all delivery gates still apply.
  const arabicMembershipGap = intent === "pricing" && topics.membership_details!.test(source)
    && /^لا تتوفر لدي[ّ]? تفاصيل (?:الاشتراك|العضوية)(?: الدقيقة)?(?: حالي[ً]?ا)?[.!؟]?$/u.test(response.trim().split(/(?<=[.!?؟])\s+/u)[0] ?? "");
  const englishMembershipGap = intent === "pricing" && topics.membership_details!.test(source)
    && /^I (?:do not|don['’]t) have (?:the )?(?:exact|current|confirmed) (?:membership|subscription) details (?:available )?(?:yet|right now|currently|at the moment)[.!]?$/iu.test(response.trim().split(/(?<=[.!?])\s+/u)[0] ?? "");
  const membershipClarificationOffer = intent === "membership_details" && topics.membership_details!.test(source)
    && isConversationalClarificationOffer(response.trim().split(/(?<=[.!?])\s+/u)[0] ?? "");
  // An exact catalog inclusion answer may name the plan instead of repeating
  // the generic word "membership". Claim grounding remains an independent
  // fail-closed gate; this only recognizes the requested answer shape.
  const membershipInclusionAnswer = intent === "membership_details" && topics.membership_details!.test(source)
    && /\b(?:includes?|inclusions?|benefits?)\b/iu.test(response);
  // A grounded risk/policy answer can answer a membership guarantee question
  // without repeating the generic membership noun. Credit only an explicit
  // denial of the guarantee or promise; claim grounding and policy checks stay
  // independent and continue to reject unsupported or affirmative guarantees.
  const membershipTradingGuaranteeDenial = intent === "membership_details" && topics.membership_details!.test(source)
    && /(?:guarantee|promise).{0,30}(?:profit|return|trading result)|(?:profit|return|trading result).{0,30}(?:guarantee|promise)|garanti.{0,25}(?:kazanç|kâr|getiri)|(?:kazanç|kâr|getiri).{0,25}garanti|(?:ضمان|مضمون|تضمن).{0,25}(?:ربح|أرباح|نتائج التداول)|(?:ربح|أرباح|نتائج التداول).{0,25}(?:ضمان|مضمون|تضمن)|гарант.{0,25}(?:прибыл|доход|результат торгов)|(?:прибыл|доход|результат торгов).{0,25}гарант/iu.test(source)
    && /\bno (?:trading )?(?:profit|profits|return|returns|results) (?:is |are )?(?:guaranteed|promised)\b|\b(?:profit|profits|return|returns|trading results?) (?:is |are )?not (?:guaranteed|promised)\b|\b(?:does not|doesn['’]t|do not|cannot|can['’]t|won['’]t) guarantee\b|(?:kazanç|kâr|getiri|[İi]şlem sonuçları).{0,25}(?:garanti edilmez|garanti değildir|vaat edilmez)|لا.{0,35}(?:ضمان|مضمون|وعد).{0,20}(?:ربح|أرباح|نتائج التداول)|(?:прибыль|доход|результаты? торгов).{0,30}(?:не гарант|не обещ)/iu.test(response);
  const turkishFreeMembershipGap = intent === "pricing" && isTurkishFreeMembershipQuestion(source)
    && (isBoundedTurkishKnowledgeLimitation(response) || isBoundedTurkishAnaphoricLimitation(response));
  if (topics[intent] && (intent !== "clarification" || /monthly|aylık|شهري|месяч/iu.test(source))) checks.current_topic_addressed = topics[intent].test(response) || arabicMembershipGap || englishMembershipGap || membershipClarificationOffer || membershipInclusionAnswer || membershipTradingGuaranteeDenial || turkishFreeMembershipGap;
  if (intent === "prompt_injection") checks.defensive_refusal = /can['’]t|cannot|won['’]t|do not|yardımcı olamam|paylaşamam|لا|не могу|не буду/iu.test(response);
  if (/hello.*twice|twice.*hello|merhaba.*iki|مرحبا.*مرتين|привет.*дважды/iu.test(source)) checks.requested_structure = requestedRepetition(source, response);
  if (/reply|respond|yanıt|cevap|отвеч|بالإنجليزية/iu.test(source) && /English|İngilizce|الإنجليزية|английск/iu.test(source)) {
    // The requested language is satisfied by replying in that language. Do not
    // require an unnatural meta-sentence such as "I'll reply in English."
    const hasForeignScript = /\p{Script=Arabic}|\p{Script=Cyrillic}/u.test(response);
    const hasEnglishClause = /\b(?:we|you|your|the|this|that|is|are|am|have|has|do|does|can|will|costs?|for|per|month|monthly|includes?|available|right|now)\b/iu.test(response)
      || /\bI(?:['’]m| have| can| will| do| don['’]t| do not)\b/u.test(response);
    checks.language_preference_addressed = !hasForeignScript && (hasEnglishClause || /English/iu.test(response));
  }
  checks.no_irrelevant_cta = !(/membership|subscription|price|pricing|üyelik|abonelik|سعر|العضوية|подписк/iu.test(source)
    && /anything else|başka.*yardım|مساعدة أخرى|что-нибудь еще/iu.test(response));
  const failures = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  return { method: "source_intent_constraints_v1", score: failures.length ? 40 : 90, checks, failures,
    coverage: Object.keys(checks).length > 1 ? "intent_constraints" : "limited_generic_constraints", requires_human_review: true };
}
