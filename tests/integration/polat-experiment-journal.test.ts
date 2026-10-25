import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
describe('independent-process offline journal locking', () => {
    it('two real Node processes cannot append under one journal lease', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'polat-guard-process-')), journal = join(dir, 'journal'), loader = resolve('scripts/polat-typescript-resolver.mjs'), module = pathToFileURL(resolve('packages/domain/src/polat-experiment-journal.ts')).href;
        const firstCode = `import{openPolatExperimentJournal}from${JSON.stringify(module)};const j=openPolatExperimentJournal(process.argv[1],true);process.stdout.write('LOCKED\\n');process.stdin.once('data',()=>{j.close();process.exit(0)});`;
        const secondCode = `import{openPolatExperimentJournal}from${JSON.stringify(module)};try{const j=openPolatExperimentJournal(process.argv[1]);j.close();process.exit(0)}catch{process.stdout.write('EXCLUSIVE_LOCK_DENIED\\n');process.exit(2)}`;
        const child = spawn(process.execPath, ['--experimental-transform-types', '--import', loader, '--input-type=module', '--eval', firstCode, journal], { stdio: ['pipe', 'pipe', 'pipe'] });
        try {
            await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(Error('LOCK_START_TIMEOUT')), 10000); child.stdout.on('data', b => { if (String(b).includes('LOCKED')) {
                clearTimeout(timer);
                resolve();
            } }); child.once('exit', code => { if (code !== 0) {
                clearTimeout(timer);
                reject(Error('LOCK_PROCESS_EXIT'));
            } }); });
            const second = spawnSync(process.execPath, ['--experimental-transform-types', '--import', loader, '--input-type=module', '--eval', secondCode, journal], { encoding: 'utf8', timeout: 10000 });
            expect(second.status).toBe(2);
            expect(second.stdout).toContain('EXCLUSIVE_LOCK_DENIED');
            const exit = new Promise<number | null>(resolve => child.once('exit', resolve));
            child.stdin.write('release\n');
            expect(await exit).toBe(0);
            const after = spawnSync(process.execPath, ['--experimental-transform-types', '--import', loader, '--input-type=module', '--eval', secondCode, journal], { encoding: 'utf8', timeout: 10000 });
            expect(after.status).toBe(0);
        }
        finally {
            if (child.exitCode === null)
                child.kill('SIGTERM');
            rmSync(dir, { recursive: true, force: true });
        }
    }, 30000);
});
