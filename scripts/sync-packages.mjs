/**
 * Pre-launch checklist item: assert every buildable package's wireit block matches the canonical
 * shape — the glob fix touched seven files with one edit, and drift is how configs went missing
 * historically. Run in CI (`npm run check`); exits nonzero listing violations.
 */
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

const problems = [];
const packages = globSync('packages/*/package.json');
for (const path of packages) {
  const p = JSON.parse(readFileSync(path, 'utf8'));
  const w = p.wireit;
  if (!w) continue; // src-shipped packages (jsx, ssr) have no build
  const name = p.name;
  const check = (cond, message) => cond || problems.push(`${name}: ${message}`);
  if (w['build:production']) {
    check(JSON.stringify(w['build:production'].output) === '["dist/*.min.js","dist/*.min.js.map"]',
      'build:production output glob is not the canonical disjoint shape');
  }
  if (w['build:development']) {
    check(JSON.stringify(w['build:development'].output) === '["dist/development/*.js","dist/development/*.js.map"]',
      'build:development output glob is not the canonical disjoint shape');
  }
  if (w['build:types']) {
    check(JSON.stringify(w['build:types'].output) === '["dist/development/*.d.ts","dist/development/*.d.ts.map"]',
      'build:types output glob is not the canonical disjoint shape');
  }
  if (!p.private) {
    check(p.publishConfig?.access === 'public', 'public package missing publishConfig.access');
    check(!('devDependencies' in p), 'package-level devDependencies (workspace root owns tooling)');
    for (const dep of Object.keys(p.dependencies ?? {})) {
      check(!dep.startsWith('@verajs/shared'), `depends on private package ${dep}`);
    }
  }
}
if (problems.length) {
  console.error('sync-packages check failed:\n' + problems.map((p) => '  - ' + p).join('\n'));
  process.exit(1);
}
console.log(`sync-packages ok (${packages.length} manifests)`);
