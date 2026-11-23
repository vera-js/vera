/**
 * Write `examples/components/index.html`: one plate per component package's `demo.ts`, and an import map to the
 * production bundles those plates run (`examples/components/page.mjs`).
 *
 *   node scripts/build-components-page.mjs          # regenerate (after a build: the map is read from the bundles)
 *   node scripts/build-components-page.mjs --check  # fail if it has drifted (gate and CI)
 *
 * Committed rather than built on request, so the page is a plain static file: any server (or a CDN) serves it, and the
 * browser suite opens and operates it like the other example pages. The check keeps it from going on showing a demo
 * state, or a component, the source no longer has.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { componentsPage } from '../examples/components/page.mjs';

const check = process.argv.includes('--check');
const root = fileURLToPath(new URL('../', import.meta.url));
const file = new URL('../examples/components/index.html', import.meta.url);
const html = await componentsPage(root);

if (check) {
  let committed = null;
  try {
    committed = readFileSync(file, 'utf8');
  } catch {
    /* missing: stale */
  }
  if (committed !== html) {
    console.error(
      `build-components-page: examples/components/index.html ${committed === null ? 'is missing' : 'no longer matches the demos and bundles'}.\n` +
        '  The page would show states or components the source no longer has. Regenerate and commit:\n\n' +
        '    node scripts/build-components-page.mjs\n',
    );
    process.exit(1);
  }
  console.log('examples/components/index.html is current');
} else {
  writeFileSync(file, html);
  console.log('wrote examples/components/index.html');
}
