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

/**
 * **Every other way into the URL builder, held to the same boundary.**
 *
 * The test above covers `autoload-dir`, which is the untrusted vector — an ordinary HTML attribute
 * on a page whose markup may be partly authored elsewhere. The guard it exercises also sits in front
 * of the tag name, the `resolve` option, the `extension` option and `componentsDir`, and none of
 * those had a test. They are all refused today; this is what keeps that true, since a containment
 * check is exactly the kind of thing a refactor relaxes without anyone noticing.
 *
 * `resolve`, `extension` and `componentsDir` are the developer's own, so this is an invariant rather
 * than a trust boundary — but "the URL is always inside `rootDir`" is worth being an invariant, and
 * a `resolve` that quietly returns another origin is a mistake worth being told about.
 */
test('the containment boundary holds for every input that reaches it', () => {
  const base = 'https://x.test/app/entry.js';
  const outside = /resolves outside https:\/\/x\.test\/app\//;

  /** A tag name arrives from markup, so it gets the same treatment as `autoload-dir`. */
  for (const tag of ['../../../etc/passwd', '../../../../x', '../../etc/passwd'])
    assert.throws(() => instance.url(tag), outside, `the tag ${JSON.stringify(tag)} must be refused`);

  /** `resolve` replaces the whole builder, so it can return anything at all. */
  for (const [label, resolve] of [
    ['a traversal', () => '../../../../etc/passwd.js'],
    ['another origin', () => 'https://evil.test/x.js'],
    ['a protocol-relative URL', () => '//evil.test/x.js'],
    ['a data: URL', () => 'data:text/javascript,alert(1)'],
  ])
    assert.throws(
      () => autoloader(base, 'components', { resolve }).url('my-card'),
      outside,
      `a resolve returning ${label} must be refused`
    );

  /** The extension is appended to the path, so it can climb too. */
  assert.throws(
    () => autoloader(base, 'components', { extension: '.js/../../../etc/x.js' }).url('my-card'),
    outside,
    'an extension that climbs out must be refused'
  );

  /** And so can the directory the autoloader was created with. */
  assert.throws(
    () => autoloader(base, '../../..').url('my-card'),
    outside,
    'a componentsDir that climbs out must be refused'
  );
});

/**
 * **The jail is `rootDir`, not `componentsDir`** — and the difference is worth pinning, because it
 * is the half a reader gets wrong. Climbing out of `components/` into the entry's own directory is
 * legitimate and resolves; climbing past the entry's directory is refused.
 *
 * These were written the other way round first, asserting that anything containing `..` is refused,
 * and the probe corrected it: a guard that refused `../sibling` would be refusing a URL the
 * autoloader is supposed to be able to build.
 */
test('containment is measured against rootDir, not the components directory', () => {
  assert.equal(instance.url('../sibling'), 'https://x.test/app/sibling.js', 'climbing into rootDir is allowed');
  /** `..` is not a path segment here — appending the extension makes it the filename `...js`. */
  assert.equal(instance.url('..'), 'https://x.test/app/components/...js');
  assert.equal(instance.url('../..'), 'https://x.test/app/...js');
});

/**
 * And the shape that *looks* like an escape and is not, so the guard is not simply "refuse anything
 * unusual". A percent-encoded traversal in a tag name stays encoded, which makes it a literal
 * filename inside the directory rather than a path segment.
 */
test('an encoded traversal is a filename, not a path', () => {
  assert.equal(
    instance.url('a-%2e%2e%2f%2e%2e%2fb'),
    'https://x.test/app/components/a-%2e%2e%2f%2e%2e%2fb.js'
  );
});

test('the extension is accepted with or without its dot', () => {
  const base = 'https://x.test/app/entry.js';
  assert.equal(autoloader(base, 'components', { extension: '.ts' }).url('my-card'), 'https://x.test/app/components/my-card.ts');
  assert.equal(autoloader(base, 'components', { extension: 'ts' }).url('my-card'), 'https://x.test/app/components/my-card.ts');
});

test('a custom resolve that stays inside is built as it asked', () => {
  const instance2 = autoloader('https://x.test/app/entry.js', 'components', {
    resolve: (tag, dir) => `${dir}/${tag}/${tag}.js`,
  });
  assert.equal(instance2.url('my-card'), 'https://x.test/app/components/my-card/my-card.js');
});

/* ── a directory cannot contain `?` or `#` ───────────────────────────────────────────────────── */

/**
 * The default layout builds `${dir}/${tag}${extension}` as **text**, and URL syntax then reads the
 * result rather than the intent. `?` and `#` end the path, so the tag name lands in the query or the
 * fragment and the request goes somewhere else entirely.
 *
 * Containment never saw this: every one of these URLs is genuinely *inside* the entry's own
 * directory, which is the only question that check asks. The 2026-08-26 sweep found it by listing
 * what the check **allowed** rather than what it refused — the refusals were all correct, and the
 * defect was sitting in the other column.
 *
 * `autoload-dir="components?v=2"` is the case that matters, because it is a cache-buster someone
 * writes on purpose rather than an attack: it fetches `app/components` with `<my-card>` inside the
 * query string, so the component file is never requested at all.
 */
test('a directory containing a query is refused, not silently misfetched', () => {
  assert.throws(() => instance.url('my-card', withDir('components?v=2')), /contains \? or #/);

  /** The URL it would have built is inside the base, so containment cannot be what catches it. */
  const wrong = new URL('components?v=2/my-card.js', 'https://x.test/app/entry.js').href;
  assert.ok(wrong.startsWith('https://x.test/app/'), 'the mis-built URL is inside the base');
  assert.equal(new URL(wrong).pathname, '/app/components', 'and the tag name is not in the path');
});

/** A fragment never reaches the network at all, so the wrong module is fetched outright. */
test('and so is one containing a fragment', () => {
  assert.throws(() => instance.url('my-card', withDir('components#2')), /contains \? or #/);
  assert.throws(() => instance.url('my-card', withDir('#')), /contains \? or #/);
});

/**
 * `autoload-dir="?"` resolves to the **entry file itself** under a URL distinct enough to evaluate a
 * second time — the whole application re-imported from an attribute in markup.
 */
test('and one that resolves to the entry module itself', () => {
  assert.throws(() => instance.url('my-card', withDir('?')), /contains \? or #/);
  assert.equal(
    new URL('?/my-card.js', 'https://x.test/app/entry.js').pathname,
    '/app/entry.js',
    'the URL this would have built is the entry module'
  );
});

/**
 * Only the default path is checked. `resolve` replaces URL building entirely and is documented that
 * way, so a query it adds is the caller's own — and it is the supported way to cache-bust, which is
 * what makes refusing the attribute a fix rather than a removal.
 */
test('a custom resolve may still add a query, because that is what resolve is for', () => {
  const versioned = autoloader('https://x.test/app/entry.js', 'components', {
    resolve: (tag, dir) => `${dir}/${tag}.js?v=2`,
  });
  assert.equal(versioned.url('my-card'), 'https://x.test/app/components/my-card.js?v=2');
});

/**
 * The exemption is checked where it actually bites: a `dir` that itself carries a query, handed to a
 * `resolve` written to understand it. Refusing before `resolve` runs would break a caller who is
 * doing exactly what the option documents.
 *
 * Asserting only the case above does not test this — `dir` is `components` there, with no `?` in it,
 * so the check never fires either way. Dropping the exemption left that test green, which is how the
 * gap was found.
 */
test('and receives a dir with a query rather than having it refused first', () => {
  const splitting = autoloader('https://x.test/app/entry.js', 'components', {
    resolve: (tag, dir) => {
      const [path, query] = dir.split('?');
      return `${path}/${tag}.js${query ? `?${query}` : ''}`;
    },
  });
  assert.equal(
    splitting.url('my-card', withDir('components?v=2')),
    'https://x.test/app/components/my-card.js?v=2'
  );
});

/** The refusal carries `href`, so discovery dedupes it exactly as it dedupes an out-of-base one. */
test('the refusal is deduplicable like every other', () => {
  try {
    instance.url('my-card', withDir('components?v=2'));
    assert.fail('expected a refusal');
  } catch (error) {
    assert.equal(typeof error.href, 'string', 'the refused URL rides on the error');
    assert.ok(error.message.startsWith('[vera] autoloader:'), 'and carries the diagnostics prefix');
  }
});
