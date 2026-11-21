/**
 * **eslint lints the source and skips the scratch a killed suite leaves** (2026-11-21). Suites write their scratch
 * beside themselves (`tests/.<name>-XXXXXX`) and remove it in a finally; a run killed mid-suite leaves it, and the next
 * gate's `eslint .` went red on code no commit contains. `.gitignore` already skipped `tests/.*`; eslint keeps its own
 * list. Asked of eslint itself (`isPathIgnored`, the repository's config), not of the config's text.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const eslint = new ESLint({ cwd });
const ignored = (path) => eslint.isPathIgnored(path);

test("a suite's leftover scratch under tests/ is not linted", async () => {
  assert.equal(await ignored('tests/.hydrate-conformance-VHocuW/s2.js'), true);
  assert.equal(await ignored('tests/.parity-abc123/nested/page.mjs'), true);
});

test('CONTROL: real tests, in tests/ and below it, are still linted', async () => {
  assert.equal(await ignored('tests/eslint-scope.test.mjs'), false);
  assert.equal(await ignored('tests/browser/adopted-realm.test.js'), false);
  assert.equal(await ignored('tests/fixtures/ssr/styles-light-in-shadow.js'), false);
});
