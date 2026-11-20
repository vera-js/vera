/**
 * Codemod for the Windows path fix (2026-11-20): `new URL(x, import.meta.url).pathname` → `fsPath(new URL(x,
 * import.meta.url))`, plus its import after the leading import block. Idempotent. Kept for merging: a branch that
 * edits a converted file and conflicts takes its own side, then runs `node scripts/codemods/fs-path.mjs <files…>`
 * (and `tests/fs-path.test.mjs` refuses anything left). Delete once no open branch predates the fix.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, dirname } from 'node:path';
const PATTERN = /new URL\(([^()]+?), import\.meta\.url\)\.pathname/g;
for (const file of process.argv.slice(2)) {
  let s = readFileSync(file, 'utf8');
  const next = s.replace(PATTERN, (_, arg) => `fsPath(new URL(${arg}, import.meta.url))`);
  if (next === s) continue;
  s = next;
  let spec = relative(dirname(file), 'scripts/fs-path.mjs').split(String.fromCharCode(92)).join('/');
  if (!spec.startsWith('.')) spec = './' + spec;
  const line = `import { fsPath } from '${spec}';`;
  if (!s.includes(line)) {
    const L = s.split('\n'); let i = 0, last = -1, inComment = false;
    for (; i < L.length; i++) {
      const t = L[i].trim();
      if (inComment) { if (t.includes('*/')) inComment = false; continue; }
      if (t.startsWith('/*')) { if (!t.includes('*/')) inComment = true; continue; }
      if (t === '' || t.startsWith('//') || t.startsWith('#!')) continue;
      if (t.startsWith('import ')) { while (!/;\s*$/.test(L[i])) i++; last = i; continue; }
      break;
    }
    if (last < 0) throw new Error(`${file}: no leading import block`);
    L.splice(last + 1, 0, line); s = L.join('\n');
  }
  writeFileSync(file, s); console.log('changed', file);
}
