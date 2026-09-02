/**
 * The whole motion surface, imported and driven with **no DOM at all**.
 *
 * This is the server-render path, and it was broken in five places at once:
 * `createMotion()` threw at construction (from a scroll-element resolve and a
 * `document` default root — while its own `DEFAULTS` docblock explains that
 * construction is deliberately DOM-free so an instance can be made before the
 * DOM exists), `supports()` — the function both entries ask "is there a
 * browser here" — threw answering it, `refresh()`/`update()` read geometry
 * without a started guard, and `toPosition()` reached for the document to
 * clamp. Every one of them turned an inert instance into a failed render.
 *
 * A root-level suite so it runs against the **built artifacts in both sweeps**
 * — the development build and the production one, which is what an SSR
 * consumer actually loads. It must run in a realm with no DOM globals, so it
 * deliberately does not import the jsdom-installing helpers other suites use.
 */
import { load } from './dist.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** The control: if a DOM leaked into this realm, the suite proves nothing. */
test('the realm genuinely has no DOM', () => {
  assert.equal(typeof document, 'undefined', 'a document here would make every check below vacuous');
  assert.equal(typeof window, 'undefined');
});

test('every artifact imports with no DOM', async () => {
  for (const entry of ['motion', 'motion/scroll-to', 'motion/paint', 'motion/path',
                       'motion/split', 'motion/easings', 'motion/sequence', 'motion/vera']) {
    const module = await load(entry);
    assert.ok(Object.keys(module).length > 0, `${entry} exported nothing`);
  }
});

test('the schema surface answers without a DOM', async () => {
  const { properties, settings, isPreset, parseMeasure, getProperty } = await load('motion');
  assert.ok(properties().length > 0);
  assert.ok(settings().length > 0);
  assert.equal(isPreset('fade-up'), true);
  assert.deepEqual(parseMeasure('40px', getProperty('translate-y')), { value: 40, unit: 'px' });
});

test('createMotion constructs, runs its whole surface, and tears down', async () => {
  const { createMotion, wireMotion } = await load('motion');
  const { split } = await load('motion/split');
  const { path } = await load('motion/path');
  const { paint } = await load('motion/paint');
  const { easings } = await load('motion/easings');
  const { sequence } = await load('motion/sequence');
  wireMotion([split, path, paint, easings, sequence()]);

  const m = createMotion({ inertia: 0.3, breakpoints: { small: [0, 500] } });
  m.init();
  assert.equal(m.enabled, false, 'inert where there is nothing to animate');
  assert.equal(m.elements.length, 0);
  assert.ok(
    m.rejected.flatMap((entry) => entry.rejected).some((reason) => reason.includes('unavailable')),
    'and says why, on the channel a consumer reads'
  );
  /** Every method, in the order a framework might call them. */
  m.collect(); m.refresh(); m.enable(); m.disable(); m.setEnabled(true);
  m.observe(null); m.unobserve(null);
  void m.reducedMotion; void m.touchDisabled;
  m.destroy();
});

test('refresh() before init() is a no-op rather than a throw', async () => {
  const { createMotion } = await load('motion');
  const m = createMotion();
  m.refresh();
  m.collect();
  m.destroy();
});

test('createScrollTo constructs, runs its whole surface, and tears down', async () => {
  const { createScrollTo } = await load('motion/scroll-to');
  const s = createScrollTo();
  s.init();
  s.update(); s.refresh(); s.collect(); s.cancel();
  s.enable(); s.disable(); s.setEnabled(true);
  void s.rejected; void s.enabled;
  s.destroy();
});

test('an imperative scroll is a no-op that still keeps its onComplete promise', async () => {
  const { createScrollTo } = await load('motion/scroll-to');
  const s = createScrollTo();
  let completed = 0;
  s.toPosition(500, { onComplete: () => completed++ });
  s.toElement(null, { onComplete: () => completed++ });
  assert.equal(completed, 1, 'toPosition answers its caller; toElement(null) returns before anything');
  s.destroy();
});

test('the vera adapter is inert rather than fatal', async () => {
  const { motion } = await load('motion/vera');
  motion.connect();
  motion.fn({});
  assert.ok(motion.instance, 'connect() still makes the instance; it simply animates nothing');
});
