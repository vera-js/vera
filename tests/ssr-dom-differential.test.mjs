/**
 * **Every member on the surface, compared against a real DOM — generated, not hand-picked.**
 *
 * The presence check next door asks whether a member exists. This asks whether it *behaves like the
 * one it is imitating*, and it asks for **every** member rather than the ones somebody thought of.
 * That distinction is the whole point: across this package's audit, enumerating presence found one
 * defect, while comparing behaviour against a real DOM found about a dozen — `classList.replace`
 * missing, `tabIndex` defaulting to 0, an emptied `class` attribute being removed, `textContent =
 * null` writing the word "null", a closed shadow root handed straight back. Every one of those is a
 * member that *existed* and answered differently.
 *
 * **jsdom is the regression net, never the oracle.** Where the two disagree this reports a lead, not
 * a verdict — and where the disagreement is understood it is listed in `KNOWN` with its reason, so
 * the file stays green and every entry in that list is a decision somebody made on purpose.
 *
 * Members jsdom does not implement are skipped rather than failed. It cannot be an authority on
 * `adoptedStyleSheets` or `replaceSync` when it does not have them, and treating absence as
 * disagreement would bury the real signal under jsdom's own gaps.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import '@verajs/ssr';
import { SURFACES, OUT_OF_SCOPE } from './dom-surface.mjs';

const real = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' }).window;

/**
 * Disagreements that are understood. A reason here is a decision; anything not here is a lead.
 */
const KNOWN = {
  'window.location': 'a plain object of URL parts, replaced per request — jsdom exposes a Location instance',
  'window.navigator': 'the handful of fields a component reads, not a Navigator instance',
  'window.history': 'the four methods that must not throw; there is no session to traverse',
  'window.document': 'this document is an object literal, not a Document instance — nothing here parses HTML',
  'window.top': 'the global itself, because a server render is an unframed top-level window',
  'window.parent': 'the global itself, for the same reason as `top`',
  'window.frames': 'the global itself, which is what a browser reports for an unframed window',
  'window.self': 'the global itself',
  'window.window': 'the global itself',
  'window.origin': 'derived from `location` so the two cannot disagree; jsdom reports its own page',
  'window.length': '0 — no child frames',
  'window.performance': "Node's, which is the same clock and a different object",
  'window.crypto': "Node's WebCrypto, which is the same interface and a different object",
  'window.console': "Node's console",
  'window.name': "'' — a server render has no window name",
  'window.closed': 'false — the render is in progress',
  'window.frameElement': 'null — not framed',
  'window.opener': 'null — nothing opened this',
  'window.customElements': 'the registry this package fills as component modules execute',
  'document.title': 'a string this DOM owns and returns per render rather than leaving on the global',
  'document.body': 'an element shim; jsdom has a real HTMLBodyElement',
  'document.documentElement': 'an element shim',
  'document.head': 'an element shim',
  'sheet.cssRules': 'this sheet holds CSS as text — see `deleteRule`, which says so rather than pretending',
  'sheet.rules': 'the legacy alias of `cssRules`, and text for the same reason',

  /**
   * **A plain array where the platform has a live collection.** This DOM holds children as a string,
   * so there is no tree to be live *over* — a `NodeList` that never updates would be a costume. An
   * array answers `length`, indexing and iteration the same way, which is every use that survives
   * `[...el.children]`, and it says what it is to anyone who looks.
   */
  'element.attributes': 'an array, not a NamedNodeMap — this DOM has no live collection to hand back',
  'element.children': 'an array, not an HTMLCollection',
  'element.childNodes': 'an array, not a NodeList',
  'shadowRoot.children': 'an array, not an HTMLCollection',
  'shadowRoot.childNodes': 'an array, not a NodeList',
  'document.children': 'an array, not an HTMLCollection',
  'document.childNodes': 'an array, not a NodeList',
  'document.anchors': 'an empty array; a query needs a tree',
  'document.embeds': 'an empty array; a query needs a tree',
  'document.forms': 'an empty array; a query needs a tree',
  'document.images': 'an empty array; a query needs a tree',
  'document.links': 'an empty array; a query needs a tree',
  'document.plugins': 'an empty array; a server has no plugins',
  'document.scripts': 'an empty array; a query needs a tree',
  'document.styleSheets': 'an empty array; adopted sheets are returned by `renderToString`, not collected here',

  /**
   * **Every element reports `isConnected`, because during a server render every element is.** There
   * is no tree to be attached to or detached from, and the alternative — answering `false` — would
   * contradict `document.contains`, which reports the same fact from the other side. The imprecision
   * is a freshly created element that has not been appended: a browser says `false` there and this
   * says `true`. Tracking that honestly needs the tree this DOM deliberately does not build.
   */
  'element.isConnected': 'no tree to be detached from; a render is the connected case',
  'shadowRoot.isConnected': 'the same, for a root attached to an element that is rendering',

  /** jsdom's own gap: `translate` is `true` by default in every engine, and jsdom answers `null`. */
  'element.translate': 'jsdom does not reflect it; the engines default it to true, which is what this returns',
};

/** The subjects, paired. A member absent from the jsdom side is skipped, not failed. */
const element = () => globalThis.document.createElement('div');
const realElement = () => real.document.createElement('div');
const SUBJECTS = {
  element: [element(), realElement()],
  shadowRoot: [element().attachShadow({ mode: 'open' }), realElement().attachShadow({ mode: 'open' })],
  document: [globalThis.document, real.document],
  sheet: [new globalThis.CSSStyleSheet(), (() => { try { return new real.CSSStyleSheet(); } catch { return null; } })()],
  tokenList: [element().classList, realElement().classList],
  window: [globalThis, real],
};

/** What a member *is*, without calling it — a getter is read, a method is only weighed. */
const shapeOf = (subject, name) => {
  let value;
  try {
    value = subject[name];
  } catch (error) {
    return `throws:${error.constructor.name}`;
  }
  if (typeof value === 'function') return 'function';
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return `${typeof value}:${String(value).slice(0, 24)}`;
};

test('the surfaces and their subjects line up', () => {
  for (const kind of Object.keys(SUBJECTS)) assert.ok(SURFACES[kind], `no surface list for ${kind}`);
  assert.ok(SURFACES.window.length > 150, 'the window surface is the large one and should be present');
});

test('every implemented member answers like the real one', () => {
  const leads = [];
  let compared = 0;
  let skipped = 0;
  for (const [kind, [mine, theirs]] of Object.entries(SUBJECTS)) {
    if (!mine || !theirs) continue;
    const scoped = OUT_OF_SCOPE[kind] ?? {};
    for (const name of SURFACES[kind]) {
      /** Declared absent here: the presence check owns that, and there is nothing to compare. */
      if (scoped[name]) continue;
      if (!(name in mine)) continue;
      /** jsdom cannot be an authority on a member it does not implement. */
      if (!(name in theirs)) {
        skipped++;
        continue;
      }
      compared++;
      const key = `${kind}.${name}`;
      if (KNOWN[key]) continue;
      const ours = shapeOf(mine, name);
      const platform = shapeOf(theirs, name);
      if (ours !== platform) leads.push(`${key}: this DOM says ${ours}, a real one says ${platform}`);
    }
  }
  assert.ok(compared > 200, `only ${compared} members were comparable — the walk found nothing`);
  assert.deepEqual(
    leads,
    [],
    `${leads.length} member(s) answer differently from a real DOM. Each is a lead, not a verdict — ` +
      `jsdom is stricter than the engines in places (see CLAUDE.md). Fix it, or add it to KNOWN with ` +
      `the reason it is deliberate:\n  ${leads.join('\n  ')}\n\n(${compared} compared, ${skipped} skipped ` +
      `because jsdom does not implement them.)`
  );
});
