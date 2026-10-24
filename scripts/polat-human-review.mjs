// Offline-only data workflow. It cannot call a model, provider, database or customer.
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
import { preparePolatReviewPack, verifyPolatReviewPack, blindPolatReviewMaterial, sealPolatReviewForms, validatePolatHumanReviews, parsePolatReviewJsonLines, unblindPolatReviewResults } from '../packages/domain/src/polat-human-review.ts';
import { polatHumanReviewHtml } from '../packages/domain/src/polat-human-review-form.ts';
import { parseFinancialJson } from '../packages/domain/src/financial-source-canonical.ts';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../packages/contracts/package.json', import.meta.url)), { z } = require('zod');
function lines(path) { if (statSync(path).size > 4 * 1024 * 1024)
    throw Error('FILE_LIMIT'); const raw = readFileSync(path, 'utf8').split(/\r?\n/u).filter(Boolean); if (raw.length > 1024)
    throw Error('RECORD_LIMIT'); return raw.map(line => parseFinancialJson(line)); }
function serialized(rows) { return rows.map(r => { const line = JSON.stringify(r); parseFinancialJson(line); return line; }).join('\n') + '\n'; }
function create(path, data) { writeFileSync(path, data, { encoding: 'utf8', flag: 'wx', mode: 0o600 }); }
function readPack(path) { const rows = lines(path), wrapper = z.strictObject({ record_type: z.enum(['HEADER', 'SAMPLE', 'INDEX']), value: z.unknown() }), header = wrapper.parse(rows.shift()); if (header.record_type !== 'HEADER')
    throw Error('HEADER_REQUIRED'); const samples = [], private_index = []; for (const raw of rows) {
    const row = wrapper.parse(raw);
    if (row.record_type === 'SAMPLE')
        samples.push(row.value);
    else if (row.record_type === 'INDEX')
        private_index.push(row.value);
    else
        throw Error('UNKNOWN_RECORD');
} return verifyPolatReviewPack({ ...header.value, samples, private_index }); }
try {
    const input = process.argv.slice(2), command = input.shift(), args = new Map(), flags = new Set();
    for (let i = 0; i < input.length; i++) {
        const key = input[i];
        if (!['--out', '--pack', '--roster', '--records', '--forms', '--reviewer', '--captured', '--fixture-validation', '--declared-human', '--unblind'].includes(key) || args.has(key) || flags.has(key))
            throw Error('ARGUMENTS_INVALID');
        if (['--fixture-validation', '--declared-human', '--unblind'].includes(key)) {
            flags.add(key);
            continue;
        }
        const value = input[++i];
        if (!value || value.startsWith('--'))
            throw Error('ARGUMENT_MISSING');
        args.set(key, value);
    }
    const allowed = { prepare: ['--out', '--roster', '--captured'], export: ['--out', '--pack', '--reviewer'], seal: ['--out', '--pack', '--forms', '--reviewer', '--fixture-validation', '--declared-human'], validate: ['--out', '--pack', '--records', '--unblind'] }[command];
    if (!allowed || [...args.keys(), ...flags].some(k => !allowed.includes(k)))
        throw Error('COMMAND_ARGUMENT_INVALID');
    const required = k => { const value = args.get(k); if (!value)
        throw Error('REQUIRED_ARGUMENT'); return value; };
    if (command === 'prepare') {
        const tree = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8', cwd: repositoryRoot }).trim();
        if (tree)
            throw Error('CLEAN_REPOSITORY_REQUIRED');
        const repositorySha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: repositoryRoot }).trim();
        const pack = await preparePolatReviewPack({ repositorySha, blindSeed: randomBytes(32), reviewers: args.has('--roster') ? lines(args.get('--roster')) : [], ...(args.has('--captured') ? { captured: lines(args.get('--captured')) } : {}) });
        const { samples, private_index, ...header } = pack, privateData = serialized([{ record_type: 'HEADER', value: header }, ...samples.map(value => ({ record_type: 'SAMPLE', value })), ...private_index.map(value => ({ record_type: 'INDEX', value }))]);
        const out = resolve(required('--out'));
        mkdirSync(out, { mode: 0o700 });
        create(join(out, 'private-plan.jsonl'), privateData);
        const reviewers = pack.reviewers.filter(r => r.role === 'REVIEWER');
        for (const reviewer of reviewers.length ? reviewers : [null]) {
            const material = blindPolatReviewMaterial(pack, reviewer?.id ?? null), { items, ...metadata } = material, name = reviewer?.id ?? 'unassigned';
            create(join(out, name + '-blind.jsonl'), serialized([{ record_type: 'HEADER', value: metadata }, ...items.map(value => ({ record_type: 'ITEM', value }))]));
            create(join(out, name + '-review.html'), polatHumanReviewHtml(material));
        }
        create(join(out, 'pending-summary.json'), JSON.stringify(validatePolatHumanReviews(pack, []), null, 2) + '\n');
        console.log(JSON.stringify({ command: 'prepare', samples: pack.samples.length, assigned_reviewers: reviewers.length, actual_human_reviews: 0, human_state: 'HUMAN_REVIEW_PENDING', real_model: 'REAL_MODEL_NOT_TESTED', financial_authority: 'NONE', live_operations: false }));
    }
    else if (command === 'export') {
        const pack = readPack(required('--pack')), reviewer = args.get('--reviewer') ?? null, material = blindPolatReviewMaterial(pack, reviewer), out = resolve(required('--out'));
        mkdirSync(out, { mode: 0o700 });
        const { items, ...header } = material;
        create(join(out, 'blind-material.jsonl'), serialized([{ record_type: 'HEADER', value: header }, ...items.map(value => ({ record_type: 'ITEM', value }))]));
        create(join(out, 'review.html'), polatHumanReviewHtml(material));
        console.log(JSON.stringify({ command: 'export', samples: items.length, pack_hash: pack.pack_hash, human_state: 'HUMAN_REVIEW_PENDING' }));
    }
    else if (command === 'seal') {
        if (flags.has('--fixture-validation') === flags.has('--declared-human'))
            throw Error('PROVENANCE_REQUIRED');
        const pack = readPack(required('--pack')), rows = lines(required('--forms')), header = rows.shift();
        z.strictObject({ version: z.literal(1), kind: z.literal('UNSEALED_REVIEW_FORMS'), pack_hash: z.literal(pack.pack_hash), reviewer_id: z.literal(required('--reviewer')), complete: z.literal(true) }).parse(header);
        const records = sealPolatReviewForms(pack, required('--reviewer'), rows, flags.has('--fixture-validation') ? 'SIMULATED_TEST_VALIDATION' : 'HUMAN_SUBMITTED_UNVERIFIED');
        create(required('--out'), serialized(records));
        console.log(JSON.stringify({ command: 'seal', records: records.length, human_state: 'HUMAN_REVIEW_PENDING', identity: 'EXTERNAL_OWNER_VERIFICATION_REQUIRED' }));
    }
    else if (command === 'validate') {
        const pack = readPack(required('--pack')), paths = required('--records').split(',');
        if (paths.length > 3)
            throw Error('FILE_LIMIT');
        const records = paths.flatMap(path => { if (statSync(path).size > 4 * 1024 * 1024)
            throw Error('FILE_LIMIT'); return parsePolatReviewJsonLines(readFileSync(path, 'utf8')); }), result = validatePolatHumanReviews(pack, records);
        const output = flags.has('--unblind') ? unblindPolatReviewResults(pack, records) : result;
        create(required('--out'), JSON.stringify(output, null, 2) + '\n');
        console.log(JSON.stringify({ command: 'validate', validation: result.validation, paired: result.paired, human_state: result.human_state, actual_verified_human_reviews: 0 }));
    }
    else
        throw Error('COMMAND_INVALID');
}
catch {
    console.error('POLAT_REVIEW_INPUT_INVALID — no source content or credentials printed');
    process.exitCode = 2;
}
