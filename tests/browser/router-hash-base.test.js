import { expect } from '@esm-bundle/chai';
import { initRouter, navigate, setRouterRenderer } from '../../packages/router/dist/development/vera-router.js';

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

for (const [label, base] of [['no <base>', null], ['a <base href="/sub/">', '/sub/'], ['a <base href="/">', '/']]) {
  for (const fragment of ['#sec', '#café']) {
    it(`${label}: navigate to a path with ${fragment} stays on the page, fires hashchange once, sets :target, one entry`, async () => {
      if (base) {
        const element = document.createElement('base');
        element.href = base;
        element.dataset.hashBase = '';
        document.head.append(element);
      }
      const marker = (window.__hashBaseMarker = Math.random());
      let hashchanges = 0;
      const count = () => hashchanges++;
      addEventListener('hashchange', count);
      const before = history.length;
      const prefix = base === '/sub/' ? '/sub' : '';
      await navigate(`/rh/${fragment === '#sec' ? 'a' : 'b'}${fragment}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      removeEventListener('hashchange', count);
      expect(window.__hashBaseMarker, 'the page was not left').to.equal(marker);
      expect(location.pathname, 'the path is the routed one').to.equal(`${prefix}/rh/${fragment === '#sec' ? 'a' : 'b'}`);
      expect(location.hash, 'the fragment is in the URL').to.equal(new URL(fragment, location.href).hash);
      expect(hashchanges, 'hashchange fired once').to.equal(1);
      expect(document.querySelector(':target')?.id, ':target is the anchor').to.equal(fragment.slice(1));
      expect(history.length - before, 'the navigation cost one entry').to.equal(1);
    });
  }
}

/** The empty fragment and the same fragment again, under both bases: what the page would do, and nothing more. */
for (const [label, base] of [['no <base>', null], ['a <base href="/sub/">', '/sub/'], ['a <base href="/">', '/']]) {
  const withBase = () => {
    if (!base) return;
    const element = document.createElement('base');
    element.href = base;
    element.dataset.hashBase = '';
    document.head.append(element);
  };
  const watch = () => {
    const seen = { hashchanges: 0, marker: (window.__hashBaseMarker = Math.random()), length: history.length };
    seen.count = () => seen.hashchanges++;
    addEventListener('hashchange', seen.count);
    return seen;
  };
  const settle = async (seen) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    removeEventListener('hashchange', seen.count);
    expect(window.__hashBaseMarker, 'the page was not left').to.equal(seen.marker);
  };

  it(`${label}: '#' is no fragment: a plain navigation, no hashchange, no :target, one entry`, async () => {
    withBase();
    const seen = watch();
    await navigate('/rh/d#');
    await settle(seen);
    expect(location.hash).to.equal('');
    expect(seen.hashchanges).to.equal(0);
    expect(document.querySelector(':target')).to.equal(null);
    expect(history.length - seen.length).to.equal(1);
  });

  it(`${label}: the same fragment again fires nothing and adds no entry`, async () => {
    withBase();
    await navigate('/rh/c#sec');
    /** That navigation's own hashchange is a queued task: let it land before counting. */
    await new Promise((resolve) => setTimeout(resolve, 100));
    const seen = watch();
    await navigate('/rh/c#sec');
    await settle(seen);
    expect(location.hash).to.equal('#sec');
    expect(seen.hashchanges, 'no hashchange for the same fragment').to.equal(0);
    expect(document.querySelector(':target')?.id).to.equal('sec');
    expect(history.length - seen.length, 'no entry').to.equal(0);
  });
}
