/**
 * Every documented limitation, held to its documentation.
 *
 * The pattern comes from pass 86 and is stated in `CLAUDE.md`: *a limitation that is only recorded in
 * a test is a limitation the person who hits it will never find.* `ssr-text-boundary` and
 * `ssr-select-parity` each carry their own version of this check for the limitation they cover.
 *
 * The second sweep found the pattern had been applied unevenly — three limitations written during
 * that session had the *behaviour* tested and nothing tying the prose to it, so the sentence could be
 * edited away and every suite would stay green. This file is the one place that catches that, for all
 * of them at once, rather than each remembering to do it.
 *
 * A limitation belongs here when it is something a user will hit and cannot deduce: a platform rule
 * the framework steers them into, or a behaviour that differs from what the name promises.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

/** [what it is, the file that must say it, the phrase, why it is not deducible] */
const LIMITATIONS = [
  [
    'ARIA does not cross a shadow boundary',
    'packages/core/README.md',
    'ARIA and the shadow boundary',
    'init(this, { mode: "open" }) is the documented way to write a component, so we steer people into it',
  ],
  [
    'and the same, for the AI-facing spec',
    'llms.txt',
    'ARIA does not cross a shadow boundary',
    'llms.txt is what an agent reads instead of the README',
  ],
  [
    'computed is eager, not lazy',
    'packages/reactivity/README.md',
    'It is eager, not lazy',
    'the name promises the opposite in Vue, Solid and Preact',
  ],
  [
    'a hydrating app cannot be profiled',
    'packages/renderer/README.md',
    'hydrating app cannot be profiled',
    '/hydrate and /profiler are both drop-in replacements, so an app can have one of them',
  ],
  [
    'a carriage return cannot survive inside style or script',
    'packages/ssr/README.md',
    'RAWTEXT is the exception, and it is not fixable',
    'the general fix — escaping it as &#13; — does not apply there, and nothing says so otherwise',
  ],
  [
    'a select value matching no option cannot be served',
    'packages/ssr/README.md',
    'a value matching no option cannot be served',
    'markup has no way to say "none of them"',
  ],
  [
    'the event binding accepts both listener shapes',
    'llms.txt',
    'both shapes `addEventListener` accepts',
    'an object with handleEvent is valid DOM and easy to assume is not supported',
  ],
];

for (const [what, file, phrase, why] of LIMITATIONS) {
  test(`${file} still documents: ${what}`, () => {
    assert.ok(
      read(file).includes(phrase),
      `${file} no longer says "${phrase}".\nThis limitation is not deducible — ${why} — so removing the ` +
        `sentence hides it. Restore it, or delete this entry because the limitation itself is gone.`
    );
  });
}

/**
 * The one figure in the docs that no generator can produce: the bytes `@verajs/renderer` spends on
 * the spread protocol, which can only be measured by deleting the branch and rebuilding. `llms.txt`
 * and the renderer README disagreed about it for a while — 16 B against 8 B, both wrong, the real
 * figure 5 B — so what is asserted here is that the two still agree and that the method is recorded,
 * since agreement between two hand-maintained numbers is the part that rotted.
 */
test('the two hand-maintained protocol figures agree, and say how they were measured', () => {
  const renderer = read('packages/renderer/README.md');
  const llms = read('llms.txt');
  assert.match(renderer, /grows \*\*5 B\*\* gzipped for the protocol/, 'the renderer README figure moved');
  assert.match(llms, /costs 5 B for the protocol/, 'the llms.txt figure moved — the two disagreed once before');
  assert.match(renderer, /measured 2026-08-27 by deleting the `_\$apply\$` branch/,
    'the method must stay recorded: nothing regenerates this number');
});
