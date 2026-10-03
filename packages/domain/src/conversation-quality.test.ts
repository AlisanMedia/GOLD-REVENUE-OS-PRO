import { describe, expect, it } from "vitest";
import {
  PHASE7_EVALUATION_CASES,
  QA_THRESHOLDS,
  conversationModelOutputSchema,
  directConversation,
  evaluateConversationQuality,
  inferConversationLanguage,
  inferStyleProfile,
  renderNaturalResponse,
  textChangeMetadata,
  type ConversationModelOutput,
} from "./conversation-quality";

const messages = (content: string, outbound?: string) => [
  ...(outbound ? [{ direction: "outbound", content: outbound }] : []),
  { direction: "inbound", content },
];

function output(overrides?: Partial<ConversationModelOutput>): ConversationModelOutput {
  return conversationModelOutputSchema.parse({
    classification: "information_request",
    semantic_response: {
      response_goal: "Address the customer's primary request concisely.",
      key_points: ["Answer briefly"],
      factual_grounding: { classification: "inferred", evidence_refs: ["message-1"], missing_information: [] },
    },
    proposed_response: "Kısaca yardımcı olabilirim. Hangi konuyu netleştirelim?",
    confidence: 0.82,
    escalation_recommended: false,
    escalation_category: null,
    memory_proposals: [],
    proposed_tool_calls: [],
    ...overrides,
  });
}

describe("Phase 7 conversation quality", () => {
  it("infers formal, casual and very casual styles from bounded message evidence", () => {
    expect(inferStyleProfile(messages("Bilgi verebilir misiniz rica ederim?")).formality).toBe("formal");
    expect(inferStyleProfile(messages("Selam, fiyat nedir?")).formality).toBe("casual");
    expect(inferStyleProfile(messages("knk bu iş nasıl 😄")).formality).toBe("very_casual");
  });

  it("uses English as the primary fallback and detects supported customer languages", () => {
    expect(inferConversationLanguage("Hi, can you help me with pricing?")).toBe("en");
    expect(inferConversationLanguage("Merhaba, fiyat nedir?")).toBe("tr");
    expect(inferConversationLanguage("مرحباً، هل يمكنك مساعدتي؟")).toBe("ar");
    expect(inferConversationLanguage("Привет, можете помочь?")).toBe("ru");
    expect(inferConversationLanguage("Hola, ¿cuál es el precio?")).toBe("es");
    expect(inferConversationLanguage("Hallo, wie ist der Preis?")).toBe("de");
    expect(inferConversationLanguage("Bonjour, quel est le prix ?")).toBe("fr");
  });

  it("propagates the detected language into the bounded style profile", () => {
    expect(inferStyleProfile(messages("Hi, I need help")).language).toBe("en");
    expect(inferStyleProfile(messages("مرحباً، أحتاج إلى مساعدة")).language).toBe("ar");
  });

  it("keeps short messages short and bounds the renderer to three sentences", () => {
    const short = inferStyleProfile(messages("Selam"));
    expect(renderNaturalResponse("Bir. İki. Üç. Dört.", short)).toBe("Bir. İki.");
    const medium = { ...short, preferred_message_length: "medium" as const };
    expect(renderNaturalResponse("Bir. İki. Üç. Dört.", medium)).toBe("Bir. İki. Üç.");
  });

  it("detects high-risk escalation categories deterministically", () => {
    for (const [text, expected] of [
      ["Ödedim ama sistemde görünmüyor", "payment_not_reflected"],
      ["Sinyal yüzünden para kaybettim", "financial_loss_complaint"],
      ["Bir insanla konuşmak istiyorum", "user_requests_human"],
    ] as const) {
      const style = inferStyleProfile(messages(text));
      const director = directConversation(messages(text), style);
      expect(director.primary_intent).toBe(expected);
      expect(director.should_escalate).toBe(true);
    }
  });

  it("never sets a sales objective in the Phase 7 director", () => {
    const style = inferStyleProfile(messages("Hemen bana bir paket sat"));
    expect(directConversation(messages("Hemen bana bir paket sat"), style).should_sell).toBe(false);
  });

  it("blocks deception, guaranteed-profit claims and escalation-needed output", () => {
    const style = inferStyleProfile(messages("Sen yapay zeka mısın?"));
    const director = directConversation(messages("Sen yapay zeka mısın?"), style);
    const deceptive = output({ proposed_response: "Ben insanım ve kişisel deneyimim garanti kazanç sağlar." });
    const result = evaluateConversationQuality({ response: deceptive.proposed_response, output: deceptive, director, style, recentMessages: [] });
    expect(result.scores.policy_risk).toBe(100);
    expect(result.action).toBe("block");
    expect(result.customerFacingBlocked).toBe(true);
  });

  it("detects robotic language, repetition and excessive length", () => {
    const context = messages("Detay verir misiniz?", "Değerli müşterimiz, mesajınız alındı.");
    const style = inferStyleProfile(context);
    const director = directConversation(context, style);
    const draft = "Değerli müşterimiz, mesajınız alındı. Değerli müşterimiz, mesajınız alındı. İlgili birim memnuniyetle yardımcı olacaktır. Son şans, hemen satın al.";
    const result = evaluateConversationQuality({ response: draft, output: output({ proposed_response: draft }), director, style, recentMessages: context });
    expect(result.scores.robotic_language).toBeGreaterThan(QA_THRESHOLDS.roboticRewrite);
    expect(result.scores.sales_pressure).toBeGreaterThan(QA_THRESHOLDS.salesPressureRewrite);
    expect(result.action).toBe("rewrite");
  });

  it("routes unsupported facts to verification instead of fabrication", () => {
    const context = messages("Geçen ay kesin kazanç oranınız neydi?");
    const style = inferStyleProfile(context);
    const director = directConversation(context, style);
    const unknown = output({
      confidence: 0.5,
      proposed_response: "Bu bilgi bağlamımda yok; doğrulanmış kaynağı kontrol etmek gerekir.",
      semantic_response: {
        response_goal: director.response_goal,
        key_points: ["Do not fabricate"],
        factual_grounding: { classification: "unknown", evidence_refs: [], missing_information: ["verified_performance_data"] },
      },
    });
    const result = evaluateConversationQuality({ response: unknown.proposed_response, output: unknown, director, style, recentMessages: context });
    expect(result.action).toBe("verify_or_escalate");
    expect(result.scores.factual_confidence).toBe(50);
  });

  it("preserves honest AI identity language", () => {
    const context = messages("Sen yapay zeka mısın?");
    const style = inferStyleProfile(context);
    const director = directConversation(context, style);
    const honest = output({ proposed_response: "Evet, AI destekli bir asistanım." });
    const result = evaluateConversationQuality({ response: honest.proposed_response, output: honest, director, style, recentMessages: context });
    expect(result.scores.policy_risk).toBe(0);
  });

  it("captures structured human edit magnitude without storing a fake score", () => {
    expect(textChangeMetadata("Merhaba, yardımcı olayım.", "Selam, nasıl yardımcı olayım?")).toEqual({
      original_length: 25,
      final_length: 29,
      length_delta: 4,
      changed_word_count: 4,
      change_ratio: 1,
    });
  });

  it("ships all required behavior-oriented evaluation cases", () => {
    expect(PHASE7_EVALUATION_CASES).toHaveLength(18);
    expect(new Set(PHASE7_EVALUATION_CASES.map((item) => item.key)).size).toBe(18);
    expect(PHASE7_EVALUATION_CASES.every((item) => item.expected.length > 0)).toBe(true);
  });
});
