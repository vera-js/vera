/**
 * The keyframes registry against real engines — delivery, sharing, dedup, eviction, and the
 * server/client hash agreement.
 *
 * Browser suite on purpose: jsdom has no cascade, so "the rule landed in the right root" is exactly
 * the claim it cannot check — a registry bug there looks like a pass (the write-path spec's first
 * risk). Resolution is proven the way `keyframes-tree-scope.test.js` proves it: a paused animation
 * seeked to its midpoint reads a mid value if the name resolved and the natural value if it did not,
 * with the undefined-name control carrying the whole file.
 */
import { expect } from '@esm-bundle/chai';
import { keyframeRegistry } from '../../packages/directives/dist/development/vera-directives-motion.js';

const { contentHash, acquire, release } = keyframeRegistry;

/** The rule under test, and the fixture the fast suite hashes on the SERVER. Named RULE, not CSS:
 *  a `const CSS` here SHADOWED the global `CSS` object, so `CSS.registerProperty` below was called
 *  on a string and threw "not a function" — while the bundle's own realm saw the real global. */
const RULE = '@keyframes vd-probe { 0% { opacity: 0 } 100% { opacity: 1 } }';
const SEEK = 'animation: vd-probe 1s linear both paused; animation-delay: -0.5s;';

const hosts = [];
const host = () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  hosts.push(el);
  return el;
};
afterEach(() => {
  for (const el of hosts.splice(0)) el.remove();
});

const frame = () => new Promise((r) => requestAnimationFrame(r));
const opacityOf = (el) => Number(getComputedStyle(el).opacity);
const mid = (value) => value > 0.05 && value < 0.95;

it('the hash agrees with the server, byte for byte', () => {
  /**
   * The literal is computed by Node in `tests/motion-registry-hash.test.mjs` — the SAME string,
   * hashed in the other process. This pair is the SSR contract: markup rendered on the server
   * carries names the client must independently re-derive, so the two runtimes agreeing on one
   * fixture is the whole requirement, pinned from both sides.
   */
  expect(contentHash(RULE)).to.equal('fd6bc413');
});

it('CONTROL: the name resolves nowhere before any acquire', async () => {
  const el = host();
  el.style.cssText = SEEK;
  await frame();
  /** Without this, every later "it resolved" could be leakage from an earlier test. */
  expect(opacityOf(el), 'nothing delivered yet').to.equal(1);
});

it('acquire delivers to the document, and marking AFTER acquire resolves', async () => {
  acquire(document, contentHash(RULE), RULE);
  const el = host();
  el.style.cssText = SEEK;
  await frame();

  const value = opacityOf(el);
  expect(mid(value), `insert-then-mark resolves (${value})`).to.equal(true);
  release(contentHash(RULE));
});

it('two acquires, one rule — and the sheet is the SAME object in every root', async () => {
  const hash = contentHash(RULE);
  acquire(document, hash, RULE);
  acquire(document, hash, RULE);

  const sheet = document.adoptedStyleSheets.at(-1);
  expect(sheet.cssRules.length, 'one rule for two users — count tracks DISTINCT animations').to.equal(1);

  const shadowHost = host();
  const root = shadowHost.attachShadow({ mode: 'open' });
  root.innerHTML = `<div id="t" style="${SEEK}">x</div>`;
  acquire(root, hash, RULE);
  await frame();

  expect(root.adoptedStyleSheets.at(-1), 'a reference, not a copy').to.equal(sheet);
  const value = opacityOf(root.getElementById('t'));
  expect(mid(value), `and it resolves inside the shadow tree (${value})`).to.equal(true);

  release(hash);
  release(hash);
  release(hash);
});

it('release below the count keeps the rule; the LAST release evicts it', async () => {
  const hash = contentHash(RULE);
  acquire(document, hash, RULE);
  acquire(document, hash, RULE);
  const sheet = document.adoptedStyleSheets.at(-1);

  release(hash);
  expect(sheet.cssRules.length, 'one user remains, the rule stays').to.equal(1);

  release(hash);
  expect(sheet.cssRules.length, 'last one out takes the rule').to.equal(0);

  /** Tolerant double-release: teardown runs in error recovery, and must not become its own error. */
  release(hash);
  expect(sheet.cssRules.length).to.equal(0);
});

it('eviction removes the RIGHT rule when several are live', async () => {
  /**
   * The order array is what maps a hash to its index in the shared sheet, and an off-by-one here
   * deletes a NEIGHBOUR's animation — the failure would land on whichever element activated next
   * to the one torn down, which is as misleading as bugs get.
   */
  const a = '@keyframes vd-a { 0% { opacity: 0.1 } 100% { opacity: 0.1 } }';
  const b = '@keyframes vd-b { 0% { opacity: 0.2 } 100% { opacity: 0.2 } }';
  const c = '@keyframes vd-c { 0% { opacity: 0.3 } 100% { opacity: 0.3 } }';
  for (const text of [a, b, c]) acquire(document, contentHash(text), text);
  const sheet = document.adoptedStyleSheets.at(-1);
  expect(sheet.cssRules.length).to.equal(3);

  release(contentHash(b));
  expect(sheet.cssRules.length).to.equal(2);
  const names = [...sheet.cssRules].map((rule) => rule.name);
  expect(names, 'the middle one went; its neighbours did not').to.deep.equal(['vd-a', 'vd-c']);

  release(contentHash(a));
  release(contentHash(c));
});

/* ── @property registration — the typing every timed mode rests on ───────────────────────────── */

it('a registered property INTERPOLATES where an unregistered one flips', async () => {
  const flip = host();
  const ease = host();
  const run = async (el, name) => {
    el.style.setProperty(name, '0');
    el.style.transition = `${name} 1s linear`;
    /** A forced style resolution, not a frame — a transition needs two RESOLVED values, and every
     *  rAF callback in a turn runs before the same paint. The trap with two addresses now. */
    void getComputedStyle(el).getPropertyValue(name);
    el.style.setProperty(name, '1');
    await new Promise((r) => setTimeout(r, 120));
    const value = Number(getComputedStyle(el).getPropertyValue(name));
    return value > 0 && value < 1;
  };

  /** The CONTROL: without it, "interpolated" below could be a probe that measures nothing. */
  expect(await run(flip, '--vd-unregistered'), 'unregistered: flips at the midpoint').to.equal(false);

  keyframeRegistry.ensureProperty('--vd-p', document.documentElement);
  expect(await run(ease, '--vd-p'), 'registered: a real mid transition value').to.equal(true);
});

it('a duplicate ensureProperty is a no-op, and a foreign SAME-NAME registration is tolerated', () => {
  keyframeRegistry.ensureProperty('--vd-p', document.documentElement);
  keyframeRegistry.ensureProperty('--vd-p', document.documentElement);

  /**
   * The cross-bundle condition, simulated: a second inlined copy of the pack has its own Set, so
   * its registration reaches the platform and throws there. Register the name FIRST as the other
   * bundle would — identically — then ensure: the catch must classify it harmless.
   */
  const name = `--vd-p2-${Math.floor(Math.random() * 1e9)}`;
  CSS.registerProperty({ name, syntax: '<number>', inherits: false, initialValue: '0' });
  expect(() => keyframeRegistry.ensureProperty(name, document.documentElement)).to.not.throw();
});

it('an author-owned name with a DIFFERENT type is reported, not swallowed', () => {
  const name = `--taken-${Math.floor(Math.random() * 1e9)}`;
  CSS.registerProperty({ name, syntax: '<length>', inherits: false, initialValue: '0px' });

  const warned = [];
  const original = console.warn;
  console.warn = (...args) => warned.push(args.join(' '));
  try {
    keyframeRegistry.ensureProperty(name, document.documentElement);
  } finally {
    console.warn = original;
  }
  expect(warned.join('\n'), 'their <length> beat our <number>; a play on it will snap — say so')
    .to.include('motion-progress-property-taken');
});

/* ── the SWEEP: how a play must drive the variable — measured, with a negative result ───────── */

it('a rAF ramp on the variable sweeps segments; a TRANSITION on it does not', async () => {
  /**
   * Stage 4's play mechanism, measured before anything was built on it — and the answer came back
   * NEGATIVE for the design both repos had converged on. A transition on the registered variable
   * runs (the computed value reads mid-flight) but `animation-delay: calc(var(--vd-p) * -1s)` does
   * NOT retime the paused animation from the transitioning intermediates: measured at p=0.1665,
   * opacity read 1 — the END value — in Chromium, Firefox AND WebKit. CSS-as-the-clock is dead.
   *
   * Independently confirmed on omni's harness the same day, with the mechanism sharpened: the
   * delay resolves to the transition's TARGET immediately — first frame already at the end
   * position while the variable itself is mid-ramp. And a trap for the next measurer: their first
   * pass put the transition on a PARENT with the variable INHERITED, and WebKit then APPEARED to
   * sweep while the others froze. That was an inheritance-context artifact, not an engine split —
   * transition on the animated element itself and all three freeze unanimously. Our registration
   * is `inherits: false`, so the artifact cannot arise in this design, but any future measurement
   * that inherits the variable will rediscover the phantom.
   *
   * So a play's clock is a rAF ramp WRITING the variable — the scrub's own proven mechanism at a
   * clock target instead of a scroll target — and this test pins that the ramp genuinely sweeps:
   * a bent curve (opacity 0→0.2 over the first half, 0.2→1 over the second) reads ≈p·0.4 mid-first-
   * segment where endpoint interpolation would read ≈p. The two cannot be confused. Captured by
   * polling the variable itself, never by sleeping to a chosen instant.
   */
  const bent = '@keyframes vd-sweep { 0% { opacity: 0 } 50% { opacity: 0.2 } 100% { opacity: 1 } }';
  const hash = contentHash(bent);
  keyframeRegistry.ensureProperty('--vd-p', document.documentElement);
  acquire(document, hash, bent);

  const el = host();
  el.style.cssText =
    'animation: vd-sweep 1s linear both paused; animation-delay: calc(var(--vd-p, 0) * -1s);';

  /** The ramp: what the play engine will do. Duration irrelevant to the claim — only the sweep is. */
  const t0 = performance.now();
  let seenP = 0;
  let seenOpacity = -1;
  while (true) {
    const p = Math.min(1, (performance.now() - t0) / 500);
    el.style.setProperty('--vd-p', String(p));
    await frame();
    if (seenOpacity === -1 && p > 0.15 && p < 0.45) {
      seenP = p;
      seenOpacity = Number(getComputedStyle(el).opacity);
    }
    if (p >= 1) break;
  }
  release(hash);

  expect(seenOpacity, 'the control: a mid-first-segment frame was captured').to.be.above(-1);
  const swept = seenP * 0.4;
  const endpoint = seenP;
  const toSwept = Math.abs(seenOpacity - swept);
  expect(toSwept, `at p=${seenP.toFixed(3)}: opacity ${seenOpacity} vs swept ${swept.toFixed(3)} / endpoint ${endpoint.toFixed(3)}`)
    .to.be.below(0.05);
  expect(toSwept, 'unambiguously the sweep, not endpoint interpolation')
    .to.be.below(Math.abs(seenOpacity - endpoint));
});
