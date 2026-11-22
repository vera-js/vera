/**
 * Pre-launch checklist item: assert every buildable package's wireit block matches the canonical
 * shape — the glob fix touched seven files with one edit, and drift is how configs went missing
 * historically. Run in CI (`npm run check`); exits nonzero listing violations.
 */
import { readFileSync } from 'node:fs';
import { packageFiles } from './packages.mjs';

const problems = [];
const packages = packageFiles('package.json');
for (const path of packages) {
  const p = JSON.parse(readFileSync(path, 'utf8'));
  const w = p.wireit;
  if (!w) continue; // src-shipped packages (jsx, ssr) have no build
  const name = p.name;
  const check = (cond, message) => cond || problems.push(`${name}: ${message}`);
  if (w['build:production']) {
    /**
     * A package that ships a stylesheet its build writes (a component's `preupgrade.css`) adds exactly `dist/*.css`,
     * which no other build's outputs can match; anything else is still refused. It must be listed: wireit restores
     * only listed outputs from its cache, so an unlisted file would be missing from a cached build.
     */
    const output = JSON.stringify(w['build:production'].output);
    check(output === '["dist/*.min.js","dist/*.min.js.map"]' || output === '["dist/*.min.js","dist/*.min.js.map","dist/*.css"]',
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
