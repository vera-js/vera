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
const answers = (dom, mode) => JSON.parse(execFileSync(process.execPath, [...process.execArgv, FIXTURE, dom, ...(mode ? [mode] : [])], { encoding: 'utf8' }));

/**
 * **Two server renders of one page must write the same ids.** The id counter is shared through `globalThis`, so on a
 * server it lives as long as the process: request 1 gets `vu1…`, request 2 `vu5…`. Hydration survives (the client keeps
 * the server's ids), but the same page then renders different markup per request, which breaks deterministic output,
 * caching and snapshots, and counts how many controls were rendered for other requests since the process started. The
 * fix belongs to `@verajs/ssr`, which renders one page at a time: reset the shared counter as each render starts
 * (requested of ssr's owners, 2026-11-20). Until it lands this row is a TODO, and it is red, as it must be.
 */
test('two consecutive server renders of one page write byte-identical ids', { todo: 'ssr resets the shared id counter per render (requested)' }, () => {
  const [first, second] = answers('shim', 'twice');
  assert.ok(first.some((line) => /id="vu\d+"/.test(line)), 'CONTROL: the render numbered something');
  assert.deepEqual(second, first);
});

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
