/**
 * Regressions found in the 2026-08-25 full-framework audit, autoloader half.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://x.test/app/index.html',
  pretendToBeVisual: true,
});
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'MutationObserver', 'CustomEvent'])
  globalThis[key] = dom.window[key];

const { autoloader } = await load('autoloader');
const instance = autoloader('https://x.test/app/entry.js', 'components');
const withDir = (dir) => {
  const element = document.createElement('div');
  element.setAttribute('autoload-dir', dir);
  return element;
};

/* ── containment is enforced where URLs are built ────────────────────────────────────────────── */

/**
 * `autoload-dir` is an ordinary HTML attribute, so on any page whose markup is partly authored
 * elsewhere it is an input. `load` always refused an out-of-base URL — but `url()` is public and
 * documented for preloading, and it returned one, handing the caller the fetch this module declines
 * to make. `autoload-dir="//evil.test"` reaches a different **origin**.
 */
test('url() refuses a directory that escapes the base', () => {
  for (const dir of ['//evil.test', '../../evil', '..', '../']) {
    assert.throws(
      () => instance.url('my-card', withDir(dir)),
      /resolves outside https:\/\/x\.test\/app\//,
      `autoload-dir=${JSON.stringify(dir)} must be refused`
    );
  }
});

test('url() still builds the ordinary cases', () => {
  assert.equal(instance.url('my-card'), 'https://x.test/app/components/my-card.js');
  assert.equal(instance.url('my-card', withDir('sub')), 'https://x.test/app/sub/my-card.js');
  assert.equal(instance.url('my-card', withDir('sub/')), 'https://x.test/app/sub/my-card.js');
  /** An empty or root-only directory is the entry's own directory, not the server root. */
  assert.equal(instance.url('my-card', withDir('')), 'https://x.test/app/my-card.js');
  assert.equal(instance.url('my-card', withDir('/')), 'https://x.test/app/my-card.js');
});

/**
 * The prefix test cannot be satisfied by a sibling whose name merely starts the same way, because
 * the base is a directory URL and therefore always ends in `/`.
 */
test('a sibling directory with a shared prefix is not inside the base', () => {
  const sibling = autoloader('https://x.test/app/entry.js', '../appEVIL');
  assert.throws(() => sibling.url('my-card'), /resolves outside/);
});

/** A custom `resolve` is covered by the same check — it used to be trusted until the fetch. */
test('a custom resolve cannot escape either', () => {
  const custom = autoloader('https://x.test/app/entry.js', '.', { resolve: () => 'https://evil.test/x.js' });
  assert.throws(() => custom.url('my-card'), /resolves outside/);
});

/**
 * `autoload-dir` is watched precisely so it can be pointed somewhere else after a first attempt
 * failed. Keying a refusal on the **tag** would mark it spent and it would never look again — so
 * the refused URL rides on the error and discovery dedupes on that, exactly as it dedupes a fetch.
 */
test('a refused directory can be corrected and retried', () => {
  const element = withDir('../../evil');
  assert.throws(() => instance.url('later-card', element), /resolves outside/);
  element.setAttribute('autoload-dir', 'components');
  assert.equal(instance.url('later-card', element), 'https://x.test/app/components/later-card.js');
});
