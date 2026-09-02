/**
 * The surface contract: what `custom-elements.json` declares is exactly what the component
 * renders, observes and registers as — held by execution, not by remembering. Three checks:
 * the manifest matches the declarations (the generator's --check, spawned), the rendered DOM
 * matches the declared parts and slots (a part the declaration lacks is as much drift as a
 * missing one), and the registration literal matches the declared tag.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent',
]) {
  globalThis[key] = dom.window[key];
}

const { wire } = await load('core');
const { renderer } = await load('renderer');
const { styles } = await load('styles');
wire([renderer, styles]);
const { VeraSelect } = await load('ui');

/** The declaration itself — read from source (types stripped by node), never from the bundle. */
const { selectSurface } = await import('../packages/ui/src/select/surface.ts');

const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(resolve));

test('the committed manifest matches the declared surfaces (the generator refuses drift)', () => {
  const script = fileURLToPath(new URL('../packages/ui/scripts/generate-manifest.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

test('the rendered DOM carries exactly the declared parts — no more, no fewer', async () => {
  const element = dom.window.document.createElement(selectSurface.tag);
  dom.window.document.body.append(element);
  element.options = [
    { label: 'A', value: 'a' },
    { label: 'B', value: 'b' },
  ];
  await frame();
  /** Open it so state-dependent parts render too. */
  element.shadowRoot.querySelector('[part="trigger"]').click();
  await frame();

  const rendered = new Set([...element.shadowRoot.querySelectorAll('[part]')].map((node) => node.getAttribute('part')));
  const declared = new Set(selectSurface.parts.map((entry) => entry.name));
  assert.deepEqual([...rendered].sort(), [...declared].sort(),
    'a part in only one of DOM/declaration is drift in that direction');
  element.remove();
});

test('the rendered slots are exactly the declared slots', async () => {
  const element = dom.window.document.createElement(selectSurface.tag);
  dom.window.document.body.append(element);
  await frame();
  const rendered = new Set([...element.shadowRoot.querySelectorAll('slot')].map((slot) => slot.name).filter(Boolean));
  assert.deepEqual([...rendered].sort(), selectSurface.slots.map((entry) => entry.name).sort());
  element.remove();
});

test('observedAttributes and the registered tag stay inside the declaration', () => {
  const declared = new Set(selectSurface.attributes.map((entry) => entry.name));
  for (const observed of VeraSelect.observedAttributes)
    assert.ok(declared.has(observed), `observed attribute "${observed}" is not declared`);
  /** The registration literal in index.ts deliberately repeats the tag; this is the lockstep. */
  assert.equal(dom.window.customElements.get(selectSurface.tag), VeraSelect);
});

test('every declared token appears in the stylesheet, and the stylesheet uses no undeclared --vera token', () => {
  const css = VeraSelect.styles;
  for (const token of selectSurface.tokens) assert.ok(css.includes(`var(${token}`), `${token} is declared but unused`);
  for (const used of new Set(css.match(/--vera-[a-z-]+/g)))
    assert.ok(selectSurface.tokens.includes(used), `stylesheet uses undeclared token ${used}`);
});
