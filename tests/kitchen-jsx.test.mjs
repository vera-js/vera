/**
 * **The same page, written twice.** JSX against tagged templates, compared as DOM.
 *
 * `@verajs/jsx`'s claim is that one JSX call site is one template call site — so a component
 * written in JSX must produce exactly what the hand-written original produces, through the same
 * renderer fast paths. Comparing the two *outputs* is the only way to check that; comparing the
 * emitted code would test the transform against itself.
 *
 * Both are rendered through the **real server pipeline** in their own process, because the twins
 * define the same custom-element names and a registry refuses a second definition — which is
 * correct, and means they cannot share one.
 *
 * Whitespace between elements is normalised. JSX drops whitespace-only lines and a template literal
 * keeps them, so the two authoring styles legitimately differ in indentation text nodes; everything
 * that reaches a reader is compared exactly.
 */
import { transformJsx } from '../packages/jsx/src/index.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { canonical } from './canonical.mjs';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const jsxDir = new URL('./examples/kitchen-sink/jsx/', root);
const twins = readdirSync(jsxDir).filter((name) => name.endsWith('.jsx'));

/** Compiled beside the originals, so their relative imports and tag names resolve identically. */
const dir = mkdtempSync(new URL('./examples/kitchen-sink/.jsx-', root).pathname);
let jsx;
let original;
try {
  for (const name of twins) {
    const source = readFileSync(new URL(name, jsxDir), 'utf8');
    writeFileSync(`${dir}/${name.replace(/\.jsx$/, '.js')}`, transformJsx(source, name));
  }

  /** One process per authoring style; the shared entry differs only in which twin it imports. */
  const renderIn = (folder) => {
    const script = `
import { renderToString } from '@verajs/ssr/vera';
import { wire } from '${new URL('./examples/kitchen-sink/wiring.js', root).href}';
wire(null);
const out = {};
for (const name of ${JSON.stringify(twins.map((n) => n.replace(/\.jsx$/, '.js')))}) {
  const url = new URL(name, '${folder}');
  await import(url.href);
  const tag = name.replace(/\\.js$/, '');
  out[tag] = (await renderToString(url, { tag })).html;
}
process.stdout.write(JSON.stringify(out));
`;
    return JSON.parse(
      execFileSync(
        process.execPath,
        [
          ...process.execArgv.flatMap((argument, index) =>
            argument.startsWith('--conditions')
              ? argument.includes('=')
                ? [argument]
                : [argument, process.execArgv[index + 1]]
              : []
          ),
          '--input-type=module',
          '-e',
          script,
        ],
        { cwd: new URL('.', root).pathname, encoding: 'utf8' }
      )
    );
  };

  jsx = renderIn(`file://${dir}/`);
  original = renderIn(new URL('./examples/kitchen-sink/components/', root).href);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const dom = new JSDOM('<div></div>');
/** Whitespace-only text nodes are authoring style; a run of spaces inside text is not meaningful. */
const shape = (markup) => {
  const container = dom.window.document.createElement('div');
  container.innerHTML = markup;
  /**
   * Whitespace-only nodes are dropped and runs inside real text are collapsed. JSX removes
   * whitespace-only lines between elements and a template literal keeps them, so indentation is the
   * one thing the two styles legitimately disagree about; everything a reader sees is compared as
   * written.
   */
  return canonical(container)
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim();
};

let pass = 0;
const failures = [];
for (const name of twins) {
  const tag = name.replace(/\.jsx$/, '');
  const fromJsx = shape(jsx[tag]);
  const fromTemplate = shape(original[tag]);
  if (fromJsx === fromTemplate) pass++;
  else failures.push(`<${tag}>\n      jsx:      ${fromJsx}\n      template: ${fromTemplate}`);
}

if (failures.length) {
  console.log(`\n  ${failures.length} component(s) differ between the two authoring styles:\n`);
  for (const failure of failures) console.log('    ' + failure + '\n');
}
console.log(`kitchen jsx: ${pass}/${twins.length} components identical to their tagged-template twin`);
assert.equal(failures.length, 0);
