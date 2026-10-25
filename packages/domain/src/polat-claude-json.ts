/** Nonfinancial model JSON only. Does not relax the financial canonical/parser rules. */
export function parsePolatClaudeJson(raw: string, maximumBytes = 65536): unknown {
  const fail = () => new Error("CLAUDE_JSON_INVALID");
  if (Buffer.byteLength(raw, "utf8") > maximumBytes || Buffer.from(raw, "utf8").toString("utf8") !== raw) throw fail();
  let i = 0, nodes = 0;
  const ws = () => { while (/[\x20\t\r\n]/u.test(raw[i] ?? "!")) i++; };
  function string(): string {
    const start = i++;
    while (i < raw.length) {
      const c = raw[i++];
      if (c === "\\") { i++; continue; }
      if (c === '"') {
        const value: unknown = JSON.parse(raw.slice(start, i));
        if (typeof value !== "string" || Buffer.from(value, "utf8").toString("utf8") !== value) throw fail();
        return value;
      }
    }
    throw fail();
  }
  function value(depth: number): void {
    if (++nodes > 4096 || depth > 16) throw fail();
    ws(); const c = raw[i];
    if (c === '"') { string(); return; }
    if (c === "{" || c === "[") {
      i++; ws(); const end = c === "{" ? "}" : "]", keys = new Set<string>();
      if (raw[i] === end) { i++; return; }
      while (true) {
        ws();
        if (c === "{") {
          if (raw[i] !== '"') throw fail();
          const key = string();
          if (keys.has(key) || ["__proto__", "constructor", "prototype"].includes(key)) throw fail();
          keys.add(key); ws(); if (raw[i++] !== ":") throw fail();
        }
        value(depth + 1); ws();
        if (raw[i] === end) { i++; return; }
        if (raw[i++] !== ",") throw fail();
      }
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/u.exec(raw.slice(i))?.[0];
    if (!token) throw fail();
    if (!/^(true|false|null)$/u.test(token)) {
      const n = Number(token);
      if (/[eE]/u.test(token) || (token.split('.')[1]?.length ?? 0) > 18 || n === 0 && /[1-9]/u.test(token) || !Number.isFinite(n) || Number.isInteger(n) && !Number.isSafeInteger(n)) throw fail();
    }
    i += token.length;
  }
  value(0); ws(); if (i !== raw.length) throw fail();
  return JSON.parse(raw) as unknown;
}
