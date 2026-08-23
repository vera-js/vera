import { expect } from '@esm-bundle/chai';

/**
 * Collectability, proved rather than assumed.
 *
 * `@verajs/autoloader` keeps one `MutationObserver` watching every component it discovers through,
 * and never disconnects it — which is only safe if an observed node stays collectable once the page
 * drops it. The DOM spec says an observer's node list holds weak references; this is the check that
 * it is true here.
 *
 * jsdom cannot answer it: there, a removed node observed by a live observer is reported as retained
 * **even after `disconnect()`** — bookkeeping of its own rather than the observer contract. Chromium
 * is launched with `--js-flags=--expose-gc` for this; the other engines skip.
 */
const collect = async () => {
  for (let i = 0; i < 5; i++) {
    window.gc();
    await new Promise((r) => setTimeout(r, 30));
  }
};

const dropAndCollect = async (observe) => {
  const observer = new MutationObserver(() => {});
  let host = document.createElement('div');
  document.body.appendChild(host);
  if (observe) observer.observe(host, { childList: true, subtree: true });
  const ref = new WeakRef(host);
  host.remove();
  host = null;
  await collect();
  return { collected: ref.deref() === undefined, observer };
};

/** Guards the measurement itself: if nothing is ever collected here, the suite proves nothing. */
it('the control is collected, so the measurement means something', async function () {
  if (!window.gc) this.skip();
  const { collected } = await dropAndCollect(false);
  expect(collected, 'a removed, unobserved node is collectable').to.equal(true);
});

it('a removed node observed by a live MutationObserver is still collectable', async function () {
  if (!window.gc) this.skip();
  const { collected, observer } = await dropAndCollect(true);
  expect(collected, 'observation must not pin the node').to.equal(true);
  observer.disconnect();
});

/**
 * The shape the autoloader actually creates: one observer, many watched roots, hosts coming and
 * going. Asserted as a large majority rather than all of them — a collector is free to be late, and
 * the last host of a loop is routinely still reachable from a stack slot. A retention *bug* would
 * hold all fifty, not one. The two tests above are the deterministic proof; this one is the shape.
 */
it('many hosts on one shared observer are collectable', async function () {
  if (!window.gc) this.skip();
  const observer = new MutationObserver(() => {});
  const refs = [];
  for (let i = 0; i < 50; i++) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    observer.observe(host, { childList: true, subtree: true });
    refs.push(new WeakRef(host));
    host.remove();
  }
  await collect();
  const retained = refs.filter((ref) => ref.deref() !== undefined).length;
  expect(retained, `${retained}/50 still reachable`).to.be.below(5);
  observer.disconnect();
});
