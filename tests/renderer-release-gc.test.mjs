/**
 * **A released part frees its applier's state — measured by collection, in an isolated child process** (work queue 0d,
 * vera-5a, 2026-10-11). A child position rendered by a `_$child$` applier keeps the applier (`$a`) and whatever it
 * returned (`$z`, its continuity) on the part — and either may close over the component's setup scope even when the
 * visible output is text. Nothing OBSERVABLE follows a released applier, so the pin is retention, and gc is the instrument
 * — alone in its own process (`--expose-gc`), as `core-subscription-sweep` does.
 * Clearing a part's fields matters only where something OUTSIDE the tree still holds the part — a nested part is
 * otherwise freed by its parent dropping the instance, cleared or not. Two such holders exist, one row each:
 * - the ROOT part, which `rootParts` keeps under the (still referenced) element — an applier returned by the render itself;
 * - a NESTED part the applier kept (`_$child$` is handed its part; an async applier or an engine's registry holds it).
 * Controls: the same two shapes on components still connected (state must stay ALIVE), the removed elements and kept
 * parts held strongly (so the state can die only by the release), and a dropped plain object (it must die, or gc never
 * ran). No slots, nothing a MutationObserver watches: jsdom holds observed nodes strongly and would fake a leak.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { isProduction } from './dist.mjs';

const child = () => JSON.parse(execFileSync(process.execPath, [...(isProduction ? [] : ['--conditions', 'development']), '--expose-gc', '--no-warnings', '--input-type=module', '-e', `
  import { JSDOM } from 'jsdom';
  const dom = new JSDOM('<!doctype html><body></body>');
  for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent'])
    globalThis[k] = dom.window[k] ?? globalThis[k];
  const { load } = await import('./tests/dist.mjs');
  const { init, html, wire } = await load('core');
  const { renderer } = await load('renderer');
  wire([renderer]);
  const refs = new Map();
  /** Parts an applier kept — as an async applier or an engine's own registry does; the only outside holder of a NESTED part. */
  const keptParts = [];
  /** An applier that renders text through the part, and returns state that captures its host. */
  const applierFor = (host, name, keep) => ({
    _$child$(part) {
      if (keep) keptParts.push(part);
      part._$commit$('applied');
      const state = { host, payload: new Array(64).fill(name) };
      refs.set(name, new WeakRef(state));
      return state;
    },
  });
  /** At the ROOT: the render returns the applier itself, so the root part (which rootParts keeps under the element) holds it. */
  customElements.define('rg-root', class extends HTMLElement { connectedCallback() {
    init(this, (host) => () => applierFor(host, host.dataset.name, false));
  } });
  /** NESTED, its part kept by the applier: the root dropping its instance does not reach it — only the part's own release. */
  customElements.define('rg-kept', class extends HTMLElement { connectedCallback() {
    init(this, (host) => () => html\`<p>\${applierFor(host, host.dataset.name, true)}</p>\`);
  } });
  const settle = () => new Promise((r) => setImmediate(r));
  const gc = async () => { for (let i = 0; i < 4; i++) { global.gc(); await settle(); } };
  const dropped = new WeakRef({ plain: true });
  const make = (tag, name) => {
    const el = document.createElement(tag);
    el.dataset.name = name;
    return el;
  };
  const els = { rootRemoved: make('rg-root', 'rootRemoved'), rootLive: make('rg-root', 'rootLive'),
    keptRemoved: make('rg-kept', 'keptRemoved'), keptLive: make('rg-kept', 'keptLive') };
  document.body.append(...Object.values(els));
  await settle();
  const rendered = Object.values(els).every((el) => el.textContent === 'applied');
  els.rootRemoved.remove();
  els.keptRemoved.remove();
  await settle();
  await gc();
  /** The removed elements are still referenced HERE (els), and every kept part too — so only the release can free the states. */
  const alive = (name) => refs.get(name)?.deref() !== undefined;
  process.stdout.write(JSON.stringify({
    rendered,
    removedStillHeld: els.rootRemoved.localName === 'rg-root' && els.keptRemoved.localName === 'rg-kept' && keptParts.length === 2,
    rootReleased: !alive('rootRemoved'),
    rootLive: alive('rootLive'),
    keptReleased: !alive('keptRemoved'),
    keptLive: alive('keptLive'),
    droppedDied: dropped.deref() === undefined,
  }));
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }));

test("a removed component's applier state is freed by the release — the elements and a kept part themselves alive", () => {
  const r = child();
  assert.equal(r.rendered, true, 'CONTROL: every component rendered through its applier');
  assert.equal(r.droppedDied, true, 'CONTROL: gc ran — a dropped plain object died');
  assert.equal(r.rootLive, true, "CONTROL: a connected component's root applier state stays alive");
  assert.equal(r.keptLive, true, "CONTROL: a connected component's nested applier state stays alive");
  assert.equal(r.removedStillHeld, true, 'CONTROL: the removed elements and the kept parts were held alive');
  assert.deepEqual({ root: r.rootReleased, kept: r.keptReleased }, { root: true, kept: true },
    "each removed component's applier state was freed — rootParts holding the root part, the applier holding the nested one");
});

/**
 * **A removed component's ROOT PART is collected with it** (2026-10-17): the part now lives ON its root (a per-copy
 * Symbol field, no longer a WeakMap entry), so it must go when nothing holds the removed element. Nothing in this child
 * binds a removed element — they are written as markup and removed by emptying their container — so the "last binding
 * stays alive" artifact cannot apply. Light roots (markered) in both builds; SHADOW roots (owned) in production only:
 * development watches owned roots with a MutationObserver for its dropped-node warning, and jsdom holds observed nodes
 * strongly (a fake leak). Controls: a still-connected component's part stays alive; a dropped plain object dies.
 */
const partChild = () => JSON.parse(execFileSync(process.execPath, [...(isProduction ? [] : ['--conditions', 'development']), '--expose-gc', '--no-warnings', '--input-type=module', '-e', `
  import { JSDOM } from 'jsdom';
  const dom = new JSDOM('<!doctype html><body><div id="live"></div><div id="gone"></div></body>');
  for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent'])
    globalThis[k] = dom.window[k] ?? globalThis[k];
  const { load, isProduction } = await import('./tests/dist.mjs');
  const { init, wire } = await load('core');
  const { renderer } = await load('renderer');
  wire([renderer]);
  /** The ROOT part, handed to an applier the render returns — held only weakly here. */
  const parts = { light: [], shadow: [], live: [] };
  const record = (kind) => ({ _$child$(part) { parts[kind].push(new WeakRef(part)); part._$commit$('x'); } });
  customElements.define('rp-light', class extends HTMLElement { connectedCallback() { init(this, () => () => record(this.parentNode.id === 'live' ? 'live' : 'light')); } });
  customElements.define('rp-shadow', class extends HTMLElement { connectedCallback() { init({ host: this, shadow: 'open' }, () => () => record('shadow')); } });
  const settle = () => new Promise((r) => setImmediate(r));
  const gc = async () => { for (let i = 0; i < 4; i++) { global.gc(); await settle(); } };
  const dropped = new WeakRef({ plain: true });
  document.getElementById('live').innerHTML = '<rp-light></rp-light>';
  document.getElementById('gone').innerHTML = '<rp-light></rp-light>'.repeat(6) + (isProduction ? '<rp-shadow></rp-shadow>'.repeat(6) : '');
  await settle();
  const counts = { light: parts.light.length, shadow: parts.shadow.length, live: parts.live.length };
  document.getElementById('gone').replaceChildren();
  await settle();
  await gc();
  const dead = (list) => list.filter((ref) => ref.deref() === undefined).length;
  process.stdout.write(JSON.stringify({ counts, lightDead: dead(parts.light), shadowDead: dead(parts.shadow), liveAlive: parts.live.length - dead(parts.live), droppedDied: dropped.deref() === undefined }));
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }));

test("a removed component's root part is collected with its root — light and shadow — nothing holding it but the element", () => {
  const r = partChild();
  assert.equal(r.droppedDied, true, 'CONTROL: gc ran — a dropped plain object died');
  assert.deepEqual(r.counts, { light: 6, shadow: isProduction ? 6 : 0, live: 1 }, 'CONTROL: every component rendered its root once');
  assert.equal(r.liveAlive, 1, "CONTROL: a connected component's root part stays alive");
  assert.equal(r.lightDead, 6, 'every removed light root part was collected');
  assert.equal(r.shadowDead, isProduction ? 6 : 0, 'every removed shadow root part was collected (production; development observes owned roots)');
});
