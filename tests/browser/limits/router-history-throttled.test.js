import { expect } from '@esm-bundle/chai';
import { initRouter, navigate, setRouterRenderer } from '../../../packages/router/dist/development/vera-router.js';

/**
 * **Past the engine's history cap, development says so, once** (2026-11-27). Engines cap history writes: Chromium 159 and
 * Firefox 159 drop a write past 200 per 10 s silently, WebKit 27.2 refuses one past 100 with a `SecurityError`. The view
 * then routes while the URL stays behind. Production does not check (holding the URL in step costs every navigation);
 * a development build reads back what the platform kept and warns `router-history-throttled`. Runs under
 * `VERA_DEFAULT_LIMITS=1`, which restores the caps Playwright turns off; the raw burst is the proof that it did.
 *
 * One page, one 10 s window: the raw burst spends it first (the control), the router's writes past it follow, and
 * nothing writes history after them. That a kept write is never reported is `tests/browser/router-history-kept.test.js`.
 */

setRouterRenderer((template, container) => {
  container.innerHTML = typeof template === 'string' ? template : '';
});

const el = document.createElement('div');
const view = document.createElement('main');
el.appendChild(view);
document.body.appendChild(el);
initRouter(el, { view, handleInitial: false, focusView: false }).addRoutes([{ path: '/lim/:n', component: () => '<p>n</p>' }]);

/** Every `router-history-throttled` line a block prints. */
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

it('past the cap, the browser drops or refuses a write, and development warns exactly once', async () => {
  /** The positive control: a raw burst of 250 writes is not all kept, which proves the default caps are on. */
  let refused = 0;
  for (let n = 0; n < 250; n++) {
    try {
      history.pushState(null, '', `/raw/${n}`);
    } catch (error) {
      expect(error.name, 'a refused write is a SecurityError').to.equal('SecurityError');
      refused++;
    }
  }
  expect(refused > 0 || location.pathname !== '/raw/249', 'CONTROL: the engine capped a raw burst of 250 writes (the default limits are on)').to.equal(true);

  const lines = await throttledLines(async () => {
    for (let n = 0; n < 5; n++) await navigate(`/lim/after-${n}`).catch((error) => expect(error.name).to.equal('SecurityError'));
  });
  expect(location.pathname, 'CONTROL: the URL stayed behind the view').to.not.equal('/lim/after-4');
  expect(lines.length, 'said once per page, however many writes were lost').to.equal(1);
  expect(lines[0], 'it names the route the view shows').to.include('/lim/after-');
});
