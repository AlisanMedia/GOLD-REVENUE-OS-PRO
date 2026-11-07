import { openSync, closeSync, writeSync, fsyncSync, readFileSync, mkdirSync, unlinkSync, lstatSync, fstatSync, constants } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { jeffGuardJournalRecordSchema, type JeffGuardJournalRecord } from "@gold-revenue-os/contracts";
import { canonicalFinancialJson, parseFinancialJson } from "./financial-source-canonical";
export const jeffGuardDigest = (value: unknown) => createHash("sha256").update(canonicalFinancialJson(value), "utf8").digest("hex");
export type GuardAppend = JeffGuardJournalRecord extends infer T ? T extends JeffGuardJournalRecord ? Omit<T, "version" | "mode" | "sequence" | "previous_hash" | "record_hash"> : never : never;
/** Local synthetic evidence only. Hash chains are integrity checks, not authentication or WORM storage. */
export function openJeffExperimentJournal(directory: string, create = false) {
    if (create)
        mkdirSync(directory, { mode: 0o700 });
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())
        throw Error("JEFF_JOURNAL_DIRECTORY_INVALID");
    const lock = join(directory, "exclusive.lock"), path = join(directory, "evidence.jsonl");
    let lockFd: number;
    try {
        lockFd = openSync(lock, "wx", 0o600);
    }
    catch {
        throw Error("JEFF_JOURNAL_LOCKED_REVIEW_REQUIRED");
    }
    let closed = false, fileFd: number | undefined;
    try {
        const fd = openSync(path, constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW | (create ? constants.O_CREAT | constants.O_EXCL : 0), 0o600);
        fileFd = fd;
        if (!fstatSync(fd).isFile()) {
            throw Error("JEFF_JOURNAL_FILE_INVALID");
        }
        const size = fstatSync(fd).size;
        if (size > 2 * 1024 * 1024) {
            throw Error("JEFF_JOURNAL_LIMIT");
        }
        if (create) {
            const parent = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY);
            try {
                fsyncSync(parent);
            }
            finally {
                closeSync(parent);
            }
        }
        const text = readFileSync(fd, "utf8");
        if (text && !text.endsWith("\n")) {
            throw Error("JEFF_JOURNAL_PARTIAL_REVIEW_REQUIRED");
        }
        const rows = text.split('\n').filter(Boolean);
        if (rows.length > 1024) {
            throw Error("JEFF_JOURNAL_LIMIT");
        }
        let expectedBytes = Buffer.byteLength(text);
        const records: JeffGuardJournalRecord[] = [];
        for (const line of rows) {
            const r = jeffGuardJournalRecordSchema.parse(parseFinancialJson(line)), { record_hash, ...body } = r;
            if (r.sequence !== records.length + 1 || r.previous_hash !== (records.at(-1)?.record_hash ?? null) || record_hash !== jeffGuardDigest(body)) {
                throw Error("JEFF_JOURNAL_CHAIN_INVALID");
            }
            records.push(r);
        }
        return Object.freeze({
            read: () => structuredClone(records),
            append: (event: GuardAppend) => {
                if (closed || records.length >= 1024)
                    throw Error("JEFF_JOURNAL_CLOSED_OR_FULL");
                const body = { ...event, version: 1, mode: "OFFLINE_SYNTHETIC", sequence: records.length + 1, previous_hash: records.at(-1)?.record_hash ?? null };
                const r = jeffGuardJournalRecordSchema.parse({ ...body, record_hash: jeffGuardDigest(body) }), line = JSON.stringify(r) + '\n';
                parseFinancialJson(line);
                const current = fstatSync(fd), named = lstatSync(path);
                if (current.size !== expectedBytes || !named.isFile() || named.ino !== current.ino || named.dev !== current.dev)
                    throw Error("JEFF_JOURNAL_FILE_DRIFT");
                if (current.size + Buffer.byteLength(line) > 2 * 1024 * 1024)
                    throw Error("JEFF_JOURNAL_LIMIT");
                const data = Buffer.from(line);
                let offset = 0;
                while (offset < data.length) {
                    const written = writeSync(fd, data, offset, data.length - offset);
                    if (written <= 0)
                        throw Error("JEFF_JOURNAL_WRITE_FAILED");
                    offset += written;
                }
                fsyncSync(fd);
                expectedBytes += data.length;
                records.push(r);
                return structuredClone(r);
            },
            close: () => {
                if (!closed) {
                    closed = true;
                    closeSync(fd);
                    fileFd = undefined;
                    closeSync(lockFd);
                    unlinkSync(lock);
                }
            },
        });
    }
    catch (error) {
        if (fileFd !== undefined)
            closeSync(fileFd);
        closeSync(lockFd);
        unlinkSync(lock);
        throw error;
    }
}
