// Every `import { a, b } from './x.js'` must name something x.js exports (ESLint's no-undef cannot see this).
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'js');
const exportsOf = (f) => new Set([...readFileSync(join(dir, f), 'utf8').matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]));
let bad = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
  const src = readFileSync(join(dir, f), 'utf8');
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/([\w-]+\.js)'/g)) {
    const have = exportsOf(m[2]);
    for (const n of m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
      if (!have.has(n)) { console.log(`${f}: imports ${n} from ${m[2]}, which does not export it`); bad++; }
    }
  }
}
console.log(bad ? `${bad} broken import(s)` : 'imports: all resolve');
process.exit(bad ? 1 : 0);
