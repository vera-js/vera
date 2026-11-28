import { expect } from '@esm-bundle/chai';
import { initRouter, navigate, setRouterRenderer } from '../../packages/router/dist/development/vera-router.js';
import { until } from './until.js';

/**
 * **A fragment navigation under a `<base>` stays on the page** (2026-11-27). The router writes the fragment with
 * `location.replace`; given `'#…'`, that resolves against the document's base, so under a `<base>` on another path it
 * navigated away (to `/sub/#…`, or to `/#…` under the usual `<base href="/">`), which here would interrupt the suite. Resolved against the page's own URL it is a
 * same-document replace: the window survives, `hashchange` fires once, `:target` is set, and the navigation costs one
 * history entry, as it does with no `<base>` at all.
 */

setRouterRenderer((template, container) => {
  container.innerHTML = typeof template === 'string' ? template : '';
});

const startPath = location.pathname;
const el = document.createElement('div');
const view = document.createElement('main');
el.appendChild(view);
document.body.appendChild(el);
initRouter(el, { view, handleInitial: false, focusView: false }).addRoutes([
  { path: '/*rest', component: () => '<h2 id="sec">sec</h2><h2 id="café">café</h2><div style="height:3000px"></div>' },
]);

afterEach(() => {
  for (const base of document.querySelectorAll('base[data-hash-base]')) base.remove();
  history.replaceState(null, '', startPath);
});

const BASES = [['no <base>', null], ['a <base href="/sub/">', '/sub/'], ['a <base href="/">', '/']];

const withBase = (base) => {
  if (!base) return;
  const element = document.createElement('base');
  element.href = base;
  element.dataset.hashBase = '';
  document.head.append(element);
};

/** Every `hashchange`'s fragment, in order, from here to `settle`, and the page and history as they were. */
const watch = () => {
  const seen = { fragments: [], marker: (window.__hashBaseMarker = Math.random()), length: history.length };
  seen.count = (event) => seen.fragments.push(new URL(event.newURL).hash);
  addEventListener('hashchange', seen.count);
  return seen;
};

/**
 * The barrier for "no further `hashchange`": a fragment replace of the page's own URL to a sentinel. Its `hashchange`
 * is queued on the same task source as any the navigation queued, so it arrives after them; the fragments seen before
 * it are every one the navigation caused. Run after the row has read the URL and `:target`, which it moves.
 */
const SENTINEL = '#hash-base-sentinel';
const settle = async (seen) => {
  location.replace(location.href.split('#')[0] + SENTINEL);
  await until(() => seen.fragments.includes(SENTINEL), 'the sentinel fragment replace to fire hashchange', 5000);
  removeEventListener('hashchange', seen.count);
  expect(window.__hashBaseMarker, 'the page was not left').to.equal(seen.marker);
  return seen.fragments.slice(0, seen.fragments.indexOf(SENTINEL));
};

for (const [label, base] of BASES) {
  for (const fragment of ['#sec', '#café']) {
    it(`${label}: navigate to a path with ${fragment} stays on the page, fires hashchange once, sets :target, one entry`, async () => {
      withBase(base);
      const seen = watch();
      const prefix = base === '/sub/' ? '/sub' : '';
      const path = `/rh/${fragment === '#sec' ? 'a' : 'b'}`;
      await navigate(`${path}${fragment}`);
      await until(() => seen.fragments.length > 0, "the fragment navigation's hashchange", 5000);
      expect(window.__hashBaseMarker, 'the page was not left').to.equal(seen.marker);
      expect(location.pathname, 'the path is the routed one').to.equal(`${prefix}${path}`);
      const hash = location.hash;
      expect(hash, 'the fragment is in the URL').to.equal(new URL(fragment, location.href).hash);
      expect(document.querySelector(':target')?.id, ':target is the anchor').to.equal(fragment.slice(1));
      expect(history.length - seen.length, 'the navigation cost one entry').to.equal(1);
      expect(await settle(seen), 'hashchange fired once').to.deep.equal([hash]);
    });
  }
}

/** The empty fragment and the same fragment again, under both bases: what the page would do, and nothing more. */
for (const [label, base] of BASES) {
  it(`${label}: '#' is no fragment: a plain navigation, no hashchange, no :target, one entry`, async () => {
    withBase(base);
    const seen = watch();
    await navigate('/rh/d#');
    expect(location.hash).to.equal('');
    expect(document.querySelector(':target')).to.equal(null);
    expect(history.length - seen.length).to.equal(1);
    expect(await settle(seen), 'no hashchange').to.deep.equal([]);
  });

  it(`${label}: the same fragment again fires nothing and adds no entry`, async () => {
    withBase(base);
    const first = watch();
    await navigate('/rh/c#sec');
    /** That navigation's own hashchange is a queued task: let it land before counting. */
    await until(() => first.fragments.length > 0, "the first navigation's hashchange", 5000);
    removeEventListener('hashchange', first.count);
    const seen = watch();
    await navigate('/rh/c#sec');
    expect(location.hash).to.equal('#sec');
    expect(document.querySelector(':target')?.id).to.equal('sec');
    expect(history.length - seen.length, 'no entry').to.equal(0);
    expect(await settle(seen), 'no hashchange for the same fragment').to.deep.equal([]);
  });
}
