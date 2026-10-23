/**
 * **Module-owned component options** (2026-10-17): core hands a component's ONE options object — `init({ host, … })`'s —
 * to every `'init'` hook, and a module reads only its own key; core never reads, copies or validates one. Development
 * accepts a key a hook claims (`$keys` on the hook function) and says, once, when two claim the same key; an unknown key
 * is ignored in BOTH builds, development only adding the warning. And `wire` hands a connector itself, so a module of
 * several parts can wire them from a function that also takes options (slots).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'ShadowRoot', 'CSSStyleSheet', 'Event', 'CustomEvent'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { init, html, wire, flush } = await load('core');
const { renderer } = await load('renderer');

const seen = [];
const hook = (element, options) => seen.push([element, options]);
Object.assign(hook, { $keys: ['tone'], $module: 'tone-module' });
let handed;
wire([renderer, { on: 'init', fn: hook, priority: 60 }, (registry, w) => { handed = w; }]);

const capture = async (run) => {
  const warnings = [];
  const saved = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    await run();
  } finally {
    console.warn = saved;
  }
  return warnings;
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

let n = 0;
const make = (optionsFor) => {
  const tag = `mo-c${n++}`;
  customElements.define(tag, class extends HTMLElement {
    connectedCallback() { init(optionsFor(this), () => () => html`<p>ok</p>`); }
  });
  const el = document.createElement(tag);
  document.body.append(el);
  flush();
  return el;
};

test("an 'init' hook is handed the component's options object — the same one — and undefined without one", async () => {
  seen.length = 0;
  let given;
  const a = make((host) => (given = { host, tone: 'warm' }));
  const b = make((host) => host);
  await settle();
  const forA = seen.find(([element]) => element === a);
  const forB = seen.find(([element]) => element === b);
  assert.ok(forA !== undefined && forA[1] === given, 'the very object init was given');
  assert.ok(forB !== undefined && forB[1] === undefined, 'undefined for init(this, …)');
  a.remove();
  b.remove();
});

test('a claimed key is accepted silently; an unknown key is ignored — and named, with the claimed keys, in development', async () => {
  let unknown;
  const quiet = await capture(async () => { make((host) => ({ host, tone: 'warm' })).remove(); });
  const loud = await capture(async () => { unknown = make((host) => ({ host, tnoe: 'warm' })); await settle(); });
  assert.equal(unknown.querySelector('p')?.textContent, 'ok', 'an unknown key changes nothing: the component rendered, in both builds');
  unknown.remove();
  assert.deepEqual(quiet, [], 'a claimed key');
  if (isProduction) assert.deepEqual(loud, [], 'production says nothing');
  else {
    assert.equal(loud.length, 1, loud.join('\n'));
    assert.match(loud[0], /^\[vera\].*`tnoe` is not an option.*foreignNodes, host, persist, shadow, tone/s);
  }
});

test('two modules claiming one key are said once, in development, and both are still handed the object', { skip: isProduction }, async () => {
  const other = (element, options) => { if (options?.tone) other.got = true; };
  Object.assign(other, { $keys: ['tone'], $module: 'other-module' });
  const warnings = await capture(async () => {
    wire([{ on: 'init', fn: other, priority: 61 }]);
    make((host) => ({ host, tone: 'cool' })).remove();
    make((host) => ({ host, tone: 'cool' })).remove();
  });
  assert.equal(warnings.length, 1, warnings.join('\n'));
  assert.match(warnings[0], /^\[vera\].*`tone` is claimed by tone-module and by other-module/s);
  assert.equal(other.got, true, 'the second claimant still read it');
});

test('wire hands a connector itself — the one that writes the map core reads', async () => {
  assert.equal(typeof handed, 'function');
  let ran = false;
  handed([{ on: 'init', fn: () => { ran = true; }, priority: 62 }]);
  make((host) => host).remove();
  assert.equal(ran, true, 'what the connector wired through it is registered');
});
