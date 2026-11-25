/**
 * **Every component's demo stays in step with its surface** (`src/<name>/demo.ts`, `ComponentDemo` in shared-types).
 * The preview page is generated from these demos, so a demo that misses an attribute or part shows the reviewer less
 * than ships, and one that warns shows a misused component. Per component, in its own process (one registry each):
 * every state renders, through the real bundle, with nothing said on the console; and every attribute and part the
 * surface declares appears in some state's RENDERED DOM (present counts, hidden or not; a part the user's markup
 * writes counts), or is listed in the demo's `interactive` with how to reach it. And none of the author's markup is
 * PARKED: wired with light-DOM slots, a light component that does not declare `ownsChildren` has its children moved
 * into `<ins hidden data-vm-unassigned>`, present but never shown (field, icon and input rendered nothing on the
 * preview page that way, 2026-11-25, while "present counts" passed them). Runs against both builds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { load } from './dist.mjs';

const ROOT = new URL('../packages/components/', import.meta.url);
/** Every component package, with the folder its surface sits in (`src/<folder>/surface.ts`). */
const components = readdirSync(ROOT)
  .map((name) => {
    const src = new URL(`${name}/src/`, ROOT);
    const folder = existsSync(src) ? readdirSync(src).find((entry) => existsSync(new URL(`${entry}/surface.ts`, src))) : undefined;
    return folder === undefined ? null : { name, dir: new URL(`${folder}/`, src) };
  })
  .filter(Boolean);

/**
 * **What a demo leaves out, pure**: the surface's attributes and parts that no state rendered and `interactive` does
 * not name. `seen` is what the rendered states held: attribute names on the component's hosts, part names anywhere in
 * the state.
 */
export const gaps = (surface, demo, seen) => {
  const reached = new Set((demo.interactive ?? []).map((entry) => entry.part));
  return {
    attributes: surface.attributes.map((a) => a.name).filter((name) => !seen.attributes.includes(name)),
    parts: surface.parts.map((p) => p.name).filter((name) => !seen.parts.includes(name) && !reached.has(name)),
  };
};

const COMPONENT = process.env.VERA_DEMO_COMPONENT;
if (COMPONENT) {
  const { JSDOM, VirtualConsole } = await import('jsdom');
  const said = [];
  /**
   * What the page's console receives, our code's and the platform's alike, except jsdom's one known limitation: it
   * cannot parse CSS a real engine accepts (anchor positioning, @scope), and says so as a jsdomError. jsdom is the
   * regression net, never the oracle; every other jsdomError (a script error, a failed load) is still counted.
   */
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('error', (...args) => said.push(String(args[0])));
  virtualConsole.on('warn', (...args) => said.push(String(args[0])));
  virtualConsole.on('jsdomError', (error) => {
    if (!/^Could not parse CSS stylesheet/.test(error.message)) said.push(String(error.stack ?? error));
  });
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://app.example/', pretendToBeVisual: true, virtualConsole });
  for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'MutationObserver', 'HTMLFormElement'])
    globalThis[key] = dom.window[key];
  /**
   * jsdom has no `@scope`, so styles says so (`no-scope`) where every engine the page targets has it: an engine
   * limitation of the net, never the demo's. Every other development message is counted.
   */
  const heard = (line) => {
    if (!/\(no-scope\)'?$/.test(line.trim())) said.push(line);
  };
  console.warn = (...args) => heard(String(args[0]));
  console.error = (...args) => heard(String(args[0]));
  const entry = components.find((c) => c.name === COMPONENT);
  const files = readdirSync(entry.dir);
  const surface = Object.values(await import(new URL('surface.ts', entry.dir).href))[0];
  const demo = files.includes('demo.ts') ? Object.values(await import(new URL('demo.ts', entry.dir).href))[0] : null;
  const out = { has: demo !== null, said, seen: { attributes: [], parts: [] }, states: 0, hosts: 0, parked: [], instrument: false };
  /** The hosts of `tag` under `root` whose own children include a parked carrier holding the author's markup. */
  const parkedIn = (root, tag) =>
    [...root.querySelectorAll(tag)].filter((host) => [...host.children].some((child) => child.hasAttribute('data-vm-unassigned') && child.childNodes.length > 0));
  if (demo !== null) {
    /**
     * Wired as the preview page wires them, which is what a page using every component needs: the renderer, its
     * keyed lists and light-DOM slots (select's chips and its light mode), and styles.
     */
    const { define, flush, wire } = await load('core');
    const { lists } = await load('renderer/keyed');
    const { slots } = await load('renderer/slots');
    wire([(await load('renderer')).renderer, lists, slots, (await load('styles')).styles]);
    await load(`vera-components/${COMPONENT}`);
    const attributes = new Set();
    const parts = new Set();
    for (const state of demo.states) {
      const holder = document.createElement('div');
      holder.innerHTML = state.markup;
      document.body.append(holder);
      out.states += 1;
    }
    flush();
    await Promise.resolve();
    flush();
    /** Past every settle window a component waits before it speaks or warns (the spinner's is 150 ms). */
    await new Promise((resolve) => setTimeout(resolve, 300));
    /**
     * Parts by either spelling: `data-vera-part` in light DOM, and `part` inside a component's own shadow root (a
     * shadow-mode component, select today, names its parts for `::part()`). Both read from what rendered.
     */
    const read = (root) => {
      for (const node of root.querySelectorAll('[data-vera-part]')) parts.add(node.getAttribute('data-vera-part'));
      for (const node of root.querySelectorAll('[part]')) for (const name of node.getAttribute('part').split(/\s+/)) if (name) parts.add(name);
      for (const node of root.querySelectorAll('*')) if (node.shadowRoot) read(node.shadowRoot);
    };
    for (const host of document.querySelectorAll(surface.tag)) for (const { name } of host.attributes) attributes.add(name);
    read(document);
    out.seen = { attributes: [...attributes].sort(), parts: [...parts].sort() };
    out.hosts = document.querySelectorAll(surface.tag).length;
    out.parked = parkedIn(document, surface.tag).map((host) => host.outerHTML.slice(0, 120));
    /** CONTROL: a light element with children and no `ownsChildren`, wired the same way, reads as parked here. */
    define({ tag: 'demo-parks-children' }, () => {});
    const probe = document.body.appendChild(document.createElement('div'));
    probe.innerHTML = '<demo-parks-children><span>authored</span></demo-parks-children>';
    flush();
    await Promise.resolve();
    flush();
    out.instrument = parkedIn(probe, 'demo-parks-children').length === 1;
    out.gaps = gaps(surface, demo, out.seen);
  }
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
} else {
  const run = (name) => {
    const result = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
      encoding: 'utf8',
      env: { ...process.env, VERA_DEMO_COMPONENT: name },
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };

  test('the corpus: every component package is found (a floor, so a broken walk cannot pass by finding none)', () => {
    assert.ok(components.length >= 5, `found ${components.map((c) => c.name).join(', ')}`);
    for (const name of ['field', 'icon', 'kbd', 'select', 'spinner']) assert.ok(components.some((c) => c.name === name), name);
  });

  test('CONTROL: gaps() names an attribute and a part no state shows, and accepts an interactive part', () => {
    const surface = { attributes: [{ name: 'label' }, { name: 'tone' }], parts: [{ name: 'arc' }, { name: 'hint' }, { name: 'caps' }] };
    const demo = { interactive: [{ part: 'caps', how: 'press a key with Caps Lock on' }] };
    assert.deepEqual(gaps(surface, demo, { attributes: ['label'], parts: ['arc'] }), { attributes: ['tone'], parts: ['hint'] });
  });

  for (const { name } of components)
    test(`${name}: its demo exists, every state renders with nothing said, and it shows every declared attribute and part`, () => {
      const out = run(name);
      assert.equal(out.has, true, `packages/components/${name} has no demo.ts beside its surface.ts`);
      assert.ok(out.states > 0, 'CONTROL: the demo has states');
      assert.ok(out.seen.parts.length > 0, 'CONTROL: the states rendered parts');
      assert.ok(out.hosts > 0, 'CONTROL: the states rendered hosts of the tag');
      assert.equal(out.instrument, true, 'CONTROL: an element without ownsChildren reads as parked (else the parked check sees nothing)');
      assert.deepEqual(out.parked, [], `${name}: the author's markup is parked out of sight under light-DOM slots: declare ownsChildren`);
      assert.deepEqual(out.said, [], 'a state warned: the demo shows a misused component');
      assert.deepEqual(out.gaps, { attributes: [], parts: [] }, 'declared and never shown: add a state, or list the part in interactive with how to reach it');
    });
}
