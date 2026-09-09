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

/** The rule under test, and the fixture the fast suite hashes on the SERVER. */
const CSS = '@keyframes vd-probe { 0% { opacity: 0 } 100% { opacity: 1 } }';
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
  expect(contentHash(CSS)).to.equal('fd6bc413');
});

it('CONTROL: the name resolves nowhere before any acquire', async () => {
  const el = host();
  el.style.cssText = SEEK;
  await frame();
  /** Without this, every later "it resolved" could be leakage from an earlier test. */
  expect(opacityOf(el), 'nothing delivered yet').to.equal(1);
});

it('acquire delivers to the document, and marking AFTER acquire resolves', async () => {
  acquire(document, contentHash(CSS), CSS);
  const el = host();
  el.style.cssText = SEEK;
  await frame();

  const value = opacityOf(el);
  expect(mid(value), `insert-then-mark resolves (${value})`).to.equal(true);
  release(contentHash(CSS));
});

it('two acquires, one rule — and the sheet is the SAME object in every root', async () => {
  const hash = contentHash(CSS);
  acquire(document, hash, CSS);
  acquire(document, hash, CSS);

  const sheet = document.adoptedStyleSheets.at(-1);
  expect(sheet.cssRules.length, 'one rule for two users — count tracks DISTINCT animations').to.equal(1);

  const shadowHost = host();
  const root = shadowHost.attachShadow({ mode: 'open' });
  root.innerHTML = `<div id="t" style="${SEEK}">x</div>`;
  acquire(root, hash, CSS);
  await frame();

  expect(root.adoptedStyleSheets.at(-1), 'a reference, not a copy').to.equal(sheet);
  const value = opacityOf(root.getElementById('t'));
  expect(mid(value), `and it resolves inside the shadow tree (${value})`).to.equal(true);

  release(hash);
  release(hash);
  release(hash);
});

it('release below the count keeps the rule; the LAST release evicts it', async () => {
  const hash = contentHash(CSS);
  acquire(document, hash, CSS);
  acquire(document, hash, CSS);
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
