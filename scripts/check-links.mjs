#!/usr/bin/env node
/**
 * **Every relative link in the public docs resolves on this branch** (R6, 2026-11-12). A README can link a file that
 * exists on one line of history and not on another (core's README links docs/BROWSER-LEDGER.md, which a branch cut
 * before the ledger lacks), and nothing renders a broken relative link as an error. Run at each release checkpoint
 * (docs/RELEASING.md), not in every gate: a branch may legitimately wait on a merge to resolve one.
 *
 *   node scripts/check-links.mjs              every README.md, docs/**\/*.md and llms.txt; exit 1 on a broken link
 *   node scripts/check-links.mjs --self-check the control: a planted broken link is found, a good one is not
 *
 * Read: markdown links and images `[text](target)` whose target is not a URL (`http:`, `https:`, `mailto:`) or a bare
 * anchor; the `#fragment` and `?query` are dropped, and the path resolves from the linking file's directory.
 */
import { existsSync, globSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageFiles } from './packages.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const LINK = /!?\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

/** The broken relative links in `text`, a file at `file` (absolute): each `{ line, target }`. */
export const broken = (text, file) => {
  const out = [];
  /** Fenced code shows syntax, not links: its lines are skipped. */
  let fenced = false;
  text.split('\n').forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) return;
    for (const m of line.matchAll(LINK)) {
      const target = m[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
      const path = target.split('#')[0].split('?')[0];
      if (path && !existsSync(resolve(dirname(file), decodeURIComponent(path)))) out.push({ line: i + 1, target });
    }
  });
  return out;
};

if (process.argv.includes('--self-check')) {
  const here = join(root, 'README.md');
  const sample = '[good](./package.json) [web](https://example.com) [anchor](#top)\n[bad](./no-such-file.md)\n```\n[in code](./also-missing.md)\n```\n';
  const found = broken(sample, here).map((b) => b.target);
  const ok = found.length === 1 && found[0] === './no-such-file.md';
  console.log(`self-check: ${ok ? 'the planted broken link FOUND, the good ones and the fenced one not' : `WRONG: ${JSON.stringify(found)}`}`);
  process.exit(ok ? 0 : 1);
}

const files = [
  ...globSync('README.md', { cwd: root }),
  ...packageFiles('README.md'),
  ...globSync('docs/**/*.md', { cwd: root }),
  ...globSync('llms.txt', { cwd: root }),
];
let count = 0;
for (const rel of files) {
  const file = join(root, rel);
  for (const b of broken(readFileSync(file, 'utf8'), file)) {
    count++;
    console.log(`${rel}:${b.line}  ${b.target}`);
  }
}
console.log(`check-links: ${files.length} files, ${count} broken relative link(s)`);
process.exitCode = count ? 1 : 0;
