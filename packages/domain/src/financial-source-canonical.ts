import { createHash } from "node:crypto";

export const FINANCIAL_RAW_MAX_BYTES = 16384;
const failure = () => new Error("FINANCIAL_JSON_INVALID");
function wellFormed(value: string): boolean { return Buffer.from(value, "utf8").toString("utf8") === value; }

// Deliberately small JSON domain: no prototypes, accessors, floats, sparse arrays,
// lone surrogates or implicit undefined. Monetary/opaque values are always strings.
export function canonicalFinancialJson(value: unknown): string {
  let nodes = 0;
  function encode(v: unknown, depth: number): string {
    if (++nodes > 4096 || depth > 16) throw failure();
    if (v === null) return "null";
    if (typeof v === "string") { if (!wellFormed(v)) throw failure(); return JSON.stringify(v); }
    if (typeof v === "boolean") return String(v);
    if (typeof v === "number") { if (!Number.isSafeInteger(v) || Object.is(v, -0)) throw failure(); return String(v); }
    if (Array.isArray(v)) {
      if (Object.getPrototypeOf(v) !== Array.prototype || Object.keys(v).length !== v.length || Reflect.ownKeys(v).length !== v.length + 1
        || Object.values(Object.getOwnPropertyDescriptors(v)).some(d => !("value" in d))) throw failure();
      return "[" + v.map(item => encode(item, depth + 1)).join(",") + "]";
    }
    if (typeof v !== "object" || Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw failure();
    const descriptors = Object.getOwnPropertyDescriptors(v);
    if (Reflect.ownKeys(v).length !== Object.keys(descriptors).length) throw failure();
    return "{" + Object.keys(descriptors).sort().map(key => {
      const d = descriptors[key]!;
      if (!wellFormed(key) || !d.enumerable || !("value" in d)) throw failure();
      return JSON.stringify(key) + ":" + encode(d.value as unknown, depth + 1);
    }).join(",") + "}";
  }
  const result = encode(value, 0);
  if (Buffer.byteLength(result, "utf8") > FINANCIAL_RAW_MAX_BYTES) throw failure();
  return result;
}
export function financialSha256(bytes: string | Uint8Array): string {
  if (typeof bytes === "string" && !wellFormed(bytes) || Buffer.byteLength(bytes) > FINANCIAL_RAW_MAX_BYTES) throw failure();
  return createHash("sha256").update(bytes).digest("hex");
}
export function financialTuple(namespace: string, parts: readonly (string | null)[]): string {
  return canonicalFinancialJson(["FS1", namespace, ...parts]);
}
export function financialTupleHash(namespace: string, parts: readonly (string | null)[]): string {
  return financialSha256(financialTuple(namespace, parts));
}

// JSON.parse alone accepts duplicate keys. Scan the bounded grammar first, checking
// decoded names at every nesting level, including escaped aliases such as \u0061.
export function parseFinancialJson(raw: string | Uint8Array): unknown {
  let text: string;
  if (typeof raw === "string") { financialSha256(raw); text = raw; }
  else {
    financialSha256(raw);
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(raw); } catch { throw failure(); }
  }
  let i = 0; let nodes = 0;
  const ws = () => { while (/[\x20\t\r\n]/u.test(text[i] ?? "!")) i++; };
  function string(): string {
    const start = i++;
    while (i < text.length) {
      const c = text[i++];
      if (c === "\\") { i++; continue; }
      if (c === '"') {
        let value: unknown;
        try { value = JSON.parse(text.slice(start, i)) as unknown; } catch { throw failure(); }
        if (typeof value !== "string" || !wellFormed(value)) throw failure();
        return value;
      }
    }
    throw failure();
  }
  function value(depth: number): void {
    if (++nodes > 4096 || depth > 16) throw failure();
    ws(); const c = text[i];
    if (c === '"') { string(); return; }
    if (c === "{" || c === "[") {
      i++; ws(); const close = c === "{" ? "}" : "]"; const keys = new Set<string>();
      if (text[i] === close) { i++; return; }
      while (true) {
        ws();
        if (c === "{") {
          if (text[i] !== '"') throw failure();
          const key = string(); if (keys.has(key)) throw failure(); keys.add(key);
          ws(); if (text[i++] !== ":") throw failure();
        }
        value(depth + 1); ws();
        if (text[i] === close) { i++; return; }
        if (text[i++] !== ",") throw failure();
      }
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/u.exec(text.slice(i))?.[0];
    if (!token) throw failure(); i += token.length;
  }
  value(0); ws(); if (i !== text.length) throw failure();
  let result: unknown;
  try { result = JSON.parse(text) as unknown; } catch { throw failure(); }
  canonicalFinancialJson(result); // Reject non-exact numeric metadata as well.
  return result;
}
