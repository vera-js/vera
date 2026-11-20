/**
 * **`labelled` writes the same attributes, and says the same things, on the server's DOM as in a browser's.** The same
 * calls run against jsdom and against `@verajs/ssr`'s DOM shim, each in its own process (the shim installs globals), and
 * the answers are compared case by case. A difference here is the worst kind: the server's markup carries ids and
 * references the client then hydrates, so a disagreement surfaces somewhere else entirely.
 *
 * Found by this comparison on 2026-11-20: the shim has no `control.labels`, so every control named by `label[for]` was
 * reported unnamed on the server. The hook now finds `label[for]` by comparing each label's `for`, on both DOMs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('./fixtures/labelled-dom-cases.mjs', import.meta.url));
const answers = (dom) => JSON.parse(execFileSync(process.execPath, [...process.execArgv, FIXTURE, dom], { encoding: 'utf8' }));

test('every case writes the same attributes and says the same codes on the server DOM as on jsdom', () => {
  const browser = answers('jsdom');
  const server = answers('shim');
  const cases = Object.keys(browser);
  /** The control: each case ran and wrote something, or the comparison below compares nothing. */
  assert.ok(cases.length >= 6, `only ${cases.length} cases`);
  for (const name of cases) {
    assert.equal(browser[name].threw, undefined, `${name} threw on jsdom: ${browser[name].threw}`);
    assert.ok(browser[name].attrs.some((line) => /\b(id|for|aria-[a-z]+)="/.test(line)), `${name}: CONTROL, the hook wrote nothing`);
  }
  for (const name of cases) assert.deepEqual(server[name], browser[name], name);
});
