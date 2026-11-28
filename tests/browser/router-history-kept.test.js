import { expect } from '@esm-bundle/chai';
import { initRouter, navigate, setBasePath, setRouterRenderer } from '../../packages/router/dist/development/vera-router.js';

/**
 * **A kept write is never reported as a lost one** (2026-11-27). A development build reads back each history write and
 * warns `router-history-throttled` when the browser did not keep it; the browser normalizes what it keeps (non-ASCII
 * and spaces percent-encoded, dot segments resolved, an empty fragment dropped), so the read-back compares against
 * the URL the browser's own parser makes of the write. Under Playwright's launch the history caps are off, so every
 * write here is kept and any line is a false report. The lost-write side runs under the engines' own caps
 * (`tests/browser/limits/`).
 */

setRouterRenderer((template, container) => {
  container.innerHTML = typeof template === 'string' ? template : '';
});

const startPath = location.pathname;
const el = document.createElement('div');
const view = document.createElement('main');
el.appendChild(view);
document.body.appendChild(el);
initRouter(el, { view, handleInitial: false, focusView: false }).addRoutes([{ path: '/*rest', component: () => '<p>any</p>' }]);

const throttledLines = async (run) => {
  const seen = [];
  const warn = console.warn;
  console.warn = (...args) => {
    const line = args.map(String).join(' ');
    if (line.includes('router-history-throttled')) seen.push(line);
    else warn(...args);
  };
  try {
    await run();
  } finally {
    console.warn = warn;
  }
  return seen;
};

const PATHS = ['/kept/café', '/kept/q?q=a b+c', '/kept/a%2Fb', '/kept/trail?', '/kept/x/../y', '/kept/./z'];
/** Fragments run under every configuration, a `<base>` element included: the router writes them as an absolute URL. */
const FRAGMENTS = ['/kept/frag#', '/kept/hash#café', '/kept/hash#a b'];

afterEach(() => {
  setBasePath(null);
  for (const base of document.querySelectorAll('base[data-kept]')) base.remove();
  history.replaceState(null, '', startPath);
});

for (const [label, configure, targets] of [
  ['no base', () => {}, [...PATHS, ...FRAGMENTS]],
  ['setBasePath("/app")', () => setBasePath('/app'), [...PATHS, ...FRAGMENTS]],
  ['setBasePath("app/")', () => setBasePath('app/'), [...PATHS, ...FRAGMENTS]],
  ['a <base href="/sub/">', () => {
    const base = document.createElement('base');
    base.href = '/sub/';
    base.dataset.kept = '';
    document.head.append(base);
  }, [...PATHS, ...FRAGMENTS]],
]) {
  it(`${label}: every kept write is silent`, async () => {
    configure();
    const before = location.href;
    const lines = await throttledLines(async () => {
      for (const target of targets) await navigate(target);
      /** The same URL again: no write, nothing to check. */
      await navigate(targets[targets.length - 1]);
    });
    expect(location.href, 'CONTROL: the writes happened').to.not.equal(before);
    expect(lines, `${label}: a kept write is not reported`).to.deep.equal([]);
  });
}
