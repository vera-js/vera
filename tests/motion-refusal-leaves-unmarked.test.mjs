/**
 * **Refusing a rule must leave the element UNMARKED, not merely unstyled.**
 *
 * `data-vm-motion` is not a label — it IS the selector every generated rule matches on. So when the
 * registry refuses a body because its name is already held by different text, marking the element
 * anyway hands it the rule that legitimately owns that name: it animates, with someone else's
 * animation. That is the exact silent-wrong-animation the refusal exists to prevent, produced BY
 * the refusal.
 *
 * It really did that. `acquire` returned `void`, so no caller could tell a refusal from a success,
 * and `runtime.ts` marked unconditionally. Measured with the hash forced to a constant so every body
 * collided: element B asked for a rotate, was refused, and still carried the marker whose rule was
 * element A's fade. The registry's own comment claimed the refusal turned "wears the wrong
 * animation" into "wears none, and says so"; it was doing both — wearing the wrong one AND saying so.
 *
 * A second consequence of the same `void`: the seek path built its key list from the generated
 * object after the fact, so it returned a key for a rule the registry had refused. Releasing that
 * key at teardown decremented the entry that legitimately owns the name and could evict a rule still
 * in use by other elements.
 *
 * Found by omni, working the same repair through their scoped-CSS registry, where the marker is
 * likewise published into the markup. Their formulation is the one to keep: **unstyled beats
 * wrongly styled.**
 *
 * A true 64-bit collision cannot be produced on demand, so these SEED the registry with the key the
 * element is about to want — the same technique omni used through reflection.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet',
  'location', 'history', 'getComputedStyle', 'IntersectionObserver', 'ResizeObserver'])
  globalThis[key] = key === 'window' ? dom.window : (dom.window[key] ?? globalThis[key]);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const directives = await load('directives');
const pack = await load('directives/motion');
directives.wireDirectives([pack.motion, pack.presets]);
const { acquire, release, contentHash } = pack.keyframeRegistry;
const { fromAttribute } = await load('motion');

const doc = dom.window.document;
const ATTR = "{ keyframes: { opacity: '0% 0, 100% 1' } }";

/** The name the element below WILL want, derived the same way it derives it. */
const plannedHash = () => {
  const probe = doc.createElement('div');
  const generated = fromAttribute(probe, ATTR);
  assert.ok(generated, 'NON-ZERO CONTROL: the fixture attribute must actually generate');
  return generated.hash;
};

const activate = async (attr) => {
  const element = doc.createElement('div');
  element.setAttribute('data-vd-motion', attr);
  doc.body.appendChild(element);
  await directives.settled();
  return element;
};

test('the control: with the name free, the element IS marked', async () => {
  const element = await activate(ATTR);
  assert.equal(element.getAttribute('data-vm-motion'), plannedHash(),
    'NON-ZERO CONTROL: if an ordinary element does not get marked, the refusal test below passes ' +
      'for a reason unrelated to refusal — nothing ran at all');
  element.remove();
});

test('an element whose rule is refused carries no marker', async () => {
  const hash = plannedHash();
  /** Occupy the element's key with DIFFERENT text, so its own body is refused. */
  const held = `${hash}#el`;
  acquire(doc, held, '.vm-someone-else { opacity: 1; }');

  const element = await activate(ATTR);
  assert.equal(element.getAttribute('data-vm-motion'), null,
    'the element was marked with a name whose rule belongs to different CSS — it now renders with ' +
      "that other body's animation, which is what refusing was supposed to prevent");

  release(held);
  element.remove();
});

/**
 * The other half, and the one a reader is likeliest to skip: a refusal must not leave the
 * legitimate owner's count inflated OR deflated. If the refused element's key were released at
 * teardown, the owner's rule would be evicted while still in use.
 */
test('a refusal does not disturb the refcount of the body that owns the name', async () => {
  const hash = plannedHash();
  const held = `${hash}#el`;
  acquire(doc, held, '.vm-owner { opacity: 1; }');

  const element = await activate(ATTR);
  element.remove();
  await directives.settled();

  /**
   * One release balances the one acquire above. If the refused element had also been counted in and
   * then released, this release would take the count to -1 and delete a live entry; the re-acquire
   * below would then be a fresh insert accepting ANY text, so handing it different text and having
   * it accepted is the observable form of that bug.
   */
  release(held);
  const reacquired = acquire(doc, held, '.vm-different { opacity: 0; }');
  assert.equal(reacquired, true,
    'CONTROL: after the last legitimate release the name is free, so a new body may take it');
  release(held);
});

test('acquire reports acceptance, which is what makes any of the above possible',
  { skip: isProduction && 'the collision report folds away, but the return value does not' }, () => {
    const key = contentHash('a key nothing else uses');
    assert.equal(acquire(doc, key, '.a { opacity: 1; }'), true, 'a first insert is accepted');
    assert.equal(acquire(doc, key, '.a { opacity: 1; }'), true, 'identical text is the dedupe path');
    assert.equal(acquire(doc, key, '.b { opacity: 0; }'), false, 'different text under one name is refused');
    release(key);
    release(key);
  });
