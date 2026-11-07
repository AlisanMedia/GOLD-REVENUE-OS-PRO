import { IDENTITY_NAMES_V1 } from "@gold-revenue-os/contracts";

/** Customer conversation identity. Historical fixture/canary policies are kept
 * separately so accepted evidence is never relabelled as this policy. */
export const JEFF_SUPPORT_IDENTITY_POLICY = "jeff-support-identity-v1";
export const jeffSupportIdentity = {
  en: { brand: "Jeff VIP support.", automation: "This is Jeff VIP's automated support.", denial: "I'm not Jeff." },
  tr: { brand: "Jeff VIP destek.", automation: "Bu, Jeff VIP’nin otomatik destek sistemidir.", denial: "Jeff’in kendisi değilim." },
  ar: { brand: "دعم Jeff VIP.", automation: "هذا نظام الدعم الآلي لـ Jeff VIP.", denial: "أنا لست جيف." },
  ru: { brand: "Поддержка Jeff VIP.", automation: "Это автоматическая поддержка Jeff VIP.", denial: "Я не Джефф." },
} as const;

const normalize = (text: string) => text.normalize("NFKC").replace(/\p{Cf}/gu, "").replace(/[’‘`]/gu, "'").replace(/\ba\.\s*i\./giu, "ai ").replace(/[-‐‑‒–—]/gu, " ").replace(/\s+/gu, " ").replaceAll("İ", "i").toLowerCase();
const automation = /\bautomated support\b|\bautomatic support\b|\b(?:i'm|i am|this is) (?:an? )?(?:ai|chatbot|bot)\b|otomatik (?:destek|sistem)|(?:ben|bu).{0,15}yapay zek[aâ]|(?:الدعم|دعم|نظام).{0,15}(?:الآلي|آلي)|автоматическ\p{L}* (?:поддержк|систем)/iu;
const prohibitedIntroduction = /jeff['\s]*s.{0,12}(?:ai|artificial intelligence)[-\s]*(?:powered[-\s]*)?assistant|(?:ai|artificial intelligence).{0,15}assistant.{0,15}(?:for|of) jeff|jeff.{0,12}(?:ai|yapay zek[aâ]).{0,15}asistan|(?:مساعد|مساعدة).{0,20}جيف.{0,25}(?:ذكاء|آلي)|(?:مساعد|مساعدة).{0,20}(?:ذكاء|آلي).{0,25}جيف|(?:ии|искусственн).{0,20}(?:помощник|ассистент).{0,20}джефф|(?:помощник|ассистент).{0,20}джефф.{0,20}(?:ии|искусственн)/iu;
const assistantSelfTitle = /\b(?:i'm|i am|as an?|this is).{0,30}(?:ai|artificial intelligence)[-\s]+assistant|(?:ben|bu).{0,25}(?:ai|yapay zek[aâ]).{0,15}asistan|أنا.{0,20}(?:مساعد|مساعدة).{0,30}ذكاء|я.{0,16}(?:ии|искусственн).{0,20}(?:помощник|ассистент)/iu;
const falseHumanClaim = /\b(?:i'm|i am) (?:a |an |a real )?(?:human|real person)\b|\b(?:i'm|i am) not (?:an? )?(?:ai|bot|automated)\b|\b(?:ben )?(?:gerçek bir insanım|insanım|bot değilim|yapay zek[aâ] değilim)\b|أنا (?:إنسان|بشر)|я (?:настоящий человек|человек|не бот)/iu;

export function isJeffSupportIdentityQuestion(text: string): boolean {
  return /(?:are you|is this) (?:really |actually |the real )?(?:jeff|(?:an? )?(?:human|ai|bot)|automated)|who are you|who am i (?:speaking|talking) to|sen (?:jeff|kimsin|insan|yapay|(?:bir )?ai)|(?:jeff|bot|insan|\bai\b|yapay zek[aâ]|otomatik).{0,20}m[ıiuü]s[ıiuü]n|kimle (?:konuş|görüş)|من أنت|هل أنت.{0,20}(?:جيف|إنسان|روبوت|ذكاء|آلي)|кто (?:ты|вы)|(?:ты|вы).{0,12}(?:джефф|бот|человек)/iu.test(normalize(text));
}

export function jeffSupportIdentityInstructions(identityAsked: boolean, language = "en"): string {
  const identity = jeffSupportIdentity[language === "tr" || language === "ar" || language === "ru" ? language : "en"];
  return `Identity policy ${JEFF_SUPPORT_IDENTITY_POLICY}. Represent the brand as Jeff VIP support. Do not introduce or label yourself as an AI assistant, including "I'm Jeff's AI assistant" or its translations, even when identity is asked. Do not volunteer an AI, bot or automated-system introduction in ordinary conversation. ${identityAsked ? `The customer directly asked about identity: truthfully describe the existing scoped AI identity fact as automated support, not Jeff personally. Use this whole identity sentence: "${identity.automation}" Mark that claim IDENTITY_RESPONSE, KNOWN_FROM_SYSTEM and cite the scoped identity evidence. Keep any other claim separate. Never copy the prohibited introduction from an evidence statement.` : "Answer the customer's request without a personal introduction."} Never claim to be Jeff personally or a human. If identity or automation is directly asked, answer truthfully; never deny automation or evade that question.`;
}

export function assessJeffSupportIdentity(text: string, identityAsked: boolean): string[] {
  const value = normalize(text), reasons: string[] = [];
  const oldName = normalize(IDENTITY_NAMES_V1.display);
  // Reject an obsolete brand/self-introduction without censoring unrelated customer names.
  const oldIntroduction = new RegExp(`(?:\\b(?:i'm|i am|this is) ${oldName}\\b|${oldName}['\\s]*s.{0,12}(?:ai|artificial intelligence).{0,12}assistant|\\b${oldName} (?:vip|support|operations)\\b|\\bben ${oldName}(?:['ıi]m)?\\b)`, "iu");
  if (oldIntroduction.test(value)) reasons.push("JEFF_LEGACY_IDENTITY_FORBIDDEN");
  if (prohibitedIntroduction.test(value) || assistantSelfTitle.test(value)) reasons.push("JEFF_AI_INTRODUCTION_FORBIDDEN");
  if (falseHumanClaim.test(value)) reasons.push("JEFF_FALSE_HUMAN_IDENTITY");
  if (/(?:^|[.!?]\s)(?:i'm|i am|this is) jeff(?=$|[.!?,\s])(?! vip(?:'s)? (?:automated )?(?:customer )?support)|(?:^|[.!?]\s)ben jeff(?:'?[ıi]m)?(?=$|[.!?,\s])(?! vip destek)|أنا جيف|(?:^|[.!?]\s)я джефф(?=$|[.!?,\s])(?! vip)/iu.test(value)) reasons.push("JEFF_IMPERSONATION_OR_FAMILIARITY");
  if (identityAsked && !automation.test(value)) reasons.push("JEFF_IDENTITY_TRUTH_REQUIRED");
  if (!identityAsked && automation.test(value)) reasons.push("JEFF_UNSOLICITED_IDENTITY");
  return reasons;
}
