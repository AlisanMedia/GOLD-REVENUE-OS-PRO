import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { sendTelegramText } from "../../apps/web/src/lib/messaging/telegram-adapter";
const input = { botToken: "SYNTHETIC_NOT_A_CREDENTIAL", chatId: "7100000001", text: "Synthetic reply only" };
afterEach(() => vi.unstubAllGlobals());
describe("actual server Telegram adapter with offline fetch", () => {
  it("makes one fixed-host, no-redirect call and validates the matching ACK", async () => {
    const fake = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { message_id: 1, chat: { id: 7100000001 } } }), { status: 200 }));vi.stubGlobal("fetch", fake);
    expect(await sendTelegramText(input)).toMatchObject({ result: { kind: "sent" } });expect(fake).toHaveBeenCalledTimes(1);
    expect(fake.mock.calls[0]![0]).toMatch(/^https:\/\/api\.telegram\.org\/bot[^/]+\/sendMessage$/u);expect(fake.mock.calls[0]![1]).toMatchObject({ redirect: "error", cache: "no-store" });
  });
  it.each(["network", "partial", "oversized", "wrong-destination", "server-error"])("%s is UNKNOWN and never retryable", async kind => {
    const fake = vi.fn();if (kind === "network") fake.mockRejectedValue(Error("PRIVATE_NETWORK_TEXT"));else fake.mockImplementation(() => Promise.resolve(new Response(kind === "oversized" ? "x".repeat(65537) : kind === "partial" ? '{"ok":' : JSON.stringify({ ok: true, result: { message_id: 1, chat: { id: 8 } } }), { status: kind === "server-error" ? 500 : 200 })));
    vi.stubGlobal("fetch", fake);const r = await sendTelegramText(input);expect(r.result).toMatchObject({ errorCode: "TELEGRAM_DELIVERY_UNCERTAIN", retryable: false });expect(fake).toHaveBeenCalledTimes(1);expect(JSON.stringify(r)).not.toContain("PRIVATE");
  });
  it("rejects arbitrary destination URLs and empty messages before dispatch", async () => {
    const fake = vi.fn();vi.stubGlobal("fetch", fake);for (const changed of [{ chatId: "https://evil.test" }, { chatId: "@unverified" }, { text: " " }]) expect((await sendTelegramText({ ...input, ...changed })).result).toMatchObject({ errorCode: "TELEGRAM_REQUEST_INVALID" });expect(fake).not.toHaveBeenCalled();
  });
});

it("BUSINESS sends include the explicit connection and require the matching acknowledgement", async () => {
  const fake = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { message_id: 8, chat: { id: 7100000002 }, business_connection_id: "OPAQUE_BUSINESS_FIXTURE" } }), { status: 200, headers: { "content-type": "application/json" } })); vi.stubGlobal("fetch", fake);
  const result = await sendTelegramText({ botToken: "OFFLINE_TOKEN", chatId: "7100000002", text: "Synthetic message", businessConnectionId: "OPAQUE_BUSINESS_FIXTURE" }); expect(result.result).toMatchObject({ kind: "sent" }); expect(JSON.parse(fake.mock.calls[0][1].body)).toMatchObject({ business_connection_id: "OPAQUE_BUSINESS_FIXTURE", chat_id: "7100000002" }); expect(fake).toHaveBeenCalledTimes(1);
});
