// Pinned Node24's native TS transform; resolve only extensionless repository TS imports.
// No compilation service, new dependency, network access or provider loader.
import { registerHooks } from 'node:module';
import { statSync } from 'node:fs';
const root = new URL('../packages/', import.meta.url).href;
registerHooks({ resolve(specifier, context, next) {
        if (context.parentURL?.startsWith(root) && /^\.{1,2}\//u.test(specifier) && !/[.](?:[cm]?[jt]sx?|json|node)$/u.test(specifier)) {
            const candidate = new URL(specifier + '.ts', context.parentURL);
            if (candidate.href.startsWith(root)) {
                try {
                    if (statSync(candidate).isFile())
                        return next(candidate.href, context);
                }
                catch { /* ordinary resolver reports missing modules */ }
            }
        }
        return next(specifier, context);
    } });
