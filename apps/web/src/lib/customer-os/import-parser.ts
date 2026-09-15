import { inflateRawSync } from "node:zlib";

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ROWS = 5000;

export type ParsedSpreadsheet = { headers: string[]; rows: Array<Record<string, string>> };

function decodeXml(value: string): string {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function parseCsv(text: string): ParsedSpreadsheet {
  const rows: string[][] = [];
  let current: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === "," && !quoted) { current.push(cell); cell = ""; continue; }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      current.push(cell); cell = "";
      if (current.some((value) => value.trim() !== "")) rows.push(current);
      current = [];
      continue;
    }
    cell += char;
  }
  if (cell.length > 0 || current.length > 0) { current.push(cell); rows.push(current); }
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0]!.map((header, index) => header.replace(/^\ufeff/, "").trim() || `column_${index + 1}`);
  const data = rows.slice(1, MAX_ROWS + 1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
  return { headers, rows: data };
}

function zipEntries(input: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  for (let offset = 0; offset + 46 <= input.length; offset += 1) {
    if (input.readUInt32LE(offset) !== 0x02014b50) continue;
    const compression = input.readUInt16LE(offset + 10);
    const compressedSize = input.readUInt32LE(offset + 20);
    const nameLength = input.readUInt16LE(offset + 28);
    const extraLength = input.readUInt16LE(offset + 30);
    const commentLength = input.readUInt16LE(offset + 32);
    const localOffset = input.readUInt32LE(offset + 42);
    const name = input.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (!name || name.endsWith("/")) { offset += 45 + nameLength + extraLength + commentLength; continue; }
    if (localOffset + 30 > input.length || input.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Invalid XLSX local entry");
    const localNameLength = input.readUInt16LE(localOffset + 26);
    const localExtraLength = input.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = input.subarray(start, start + compressedSize);
    if (start < 0 || start + compressedSize > input.length) throw new Error("Invalid XLSX entry bounds");
    const value = compression === 0 ? compressed : compression === 8 ? inflateRawSync(compressed) : (() => { throw new Error("Unsupported XLSX compression"); })();
    if (value.length > MAX_BYTES * 4) throw new Error("XLSX entry is too large");
    entries.set(name, value);
    offset += 45 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function xmlAttribute(attributes: string, name: string): string | null {
  const match = attributes.match(new RegExp(`${name}="([^"]*)"`));
  return match?.[1] ?? null;
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "A";
  let index = 0;
  for (const char of letters) index = index * 26 + char.charCodeAt(0) - 64;
  return index - 1;
}

function parseXlsx(input: Buffer): ParsedSpreadsheet {
  const entries = zipEntries(input);
  const sheetName = [...entries.keys()].find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (!sheetName) throw new Error("XLSX worksheet not found");
  const sharedStrings = [...(entries.get("xl/sharedStrings.xml")?.toString("utf8").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g) ?? [])]
    .map((match) => decodeXml([...match[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => part[1]).join("")));
  const xml = entries.get(sheetName)!.toString("utf8");
  const parsed: Array<Map<number, string>> = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = new Map<number, string>();
    for (const cellMatch of rowMatch[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cellMatch[1]!;
      const body = cellMatch[2] ?? "";
      if (/<f\b/i.test(body)) throw new Error("Formula cells are not accepted in imports");
      const reference = xmlAttribute(attributes, "r");
      if (!reference) continue;
      const type = xmlAttribute(attributes, "t");
      const valueMatch = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
      const inlineMatch = body.match(/<is\b[^>]*>[\s\S]*?<t\b[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/);
      const rawValue = inlineMatch?.[1] ?? valueMatch?.[1] ?? "";
      const value = type === "s" ? sharedStrings[Number(rawValue)] ?? "" : decodeXml(rawValue);
      cells.set(columnIndex(reference), value);
    }
    parsed.push(cells);
    if (parsed.length > MAX_ROWS + 1) throw new Error(`Import exceeds ${MAX_ROWS} rows`);
  }
  if (parsed.length === 0) return { headers: [], rows: [] };
  const width = Math.max(...parsed.map((row) => Math.max(-1, ...row.keys()))) + 1;
  const headers = Array.from({ length: width }, (_, index) => parsed[0]!.get(index)?.trim() || `column_${index + 1}`);
  const rows = parsed.slice(1).map((record) => Object.fromEntries(headers.map((header, index) => [header, record.get(index) ?? ""])));
  return { headers, rows };
}

export async function parseSpreadsheet(file: File): Promise<ParsedSpreadsheet> {
  if (file.size > MAX_BYTES) throw new Error("Import file exceeds the 4 MB safety limit");
  const bytes = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLocaleLowerCase("en-US");
  if (name.endsWith(".csv") || file.type === "text/csv") return parseCsv(bytes.toString("utf8"));
  if (name.endsWith(".xlsx") || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return parseXlsx(bytes);
  throw new Error("Only CSV and XLSX files are accepted");
}
