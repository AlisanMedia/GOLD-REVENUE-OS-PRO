import { describe, expect, it } from "vitest";
import { parseSpreadsheet } from "../../apps/web/src/lib/customer-os/import-parser";

const csv = (text: string) => new File([text], "invented.csv", { type: "text/csv" });
describe("bounded international campaign input files", () => {
  it("preserves quoted synthetic source records and explicit language/market without contacting anybody", async () => {
    const result = await parseSpreadsheet(csv('telegram_user_id,market,preferred_language,historical_relationship\n123456789,GB,en,"Invented, previous customer"\n'));
    expect(result.rows).toEqual([{ telegram_user_id: "123456789", market: "GB", preferred_language: "en", historical_relationship: "Invented, previous customer" }]);
  });
  it.each(["email,email\na@example.test,b@example.test", "email,EMAIL\na@example.test,b@example.test", 'email,name\n"unfinished,name', "email,name\na@example.test", "email\na@example.test,extra"])("rejects ambiguous or truncated CSV instead of silently changing the dataset", async text => {
    await expect(parseSpreadsheet(csv(text))).rejects.toThrow();
  });
  it("accepts exactly the maximum and rejects rather than truncates row 5001", async () => {
    const body = Array.from({ length: 5000 }, (_, n) => `invented-${n}@example.test`).join("\n");
    expect((await parseSpreadsheet(csv(`email\n${body}\n`))).rows).toHaveLength(5000);
    await expect(parseSpreadsheet(csv(`email\n${body}\ninvented-extra@example.test\n`))).rejects.toThrow("5000");
  });
  it("rejects oversized files and excessive columns before normalization", async () => {
    await expect(parseSpreadsheet(csv("x".repeat(4 * 1024 * 1024 + 1)))).rejects.toThrow("4 MB");
    await expect(parseSpreadsheet(csv(Array.from({ length: 101 }, (_, n) => `field${n}`).join(",")))).rejects.toThrow("bounded");
  });
});
