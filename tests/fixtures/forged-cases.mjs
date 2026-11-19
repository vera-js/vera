/**
 * **One corpus for the forged-template rule, driving every copy of it** (a CODE-PRINCIPLES audit, 2026-11-17; CODE-PRINCIPLES
 * §11: "one source where the architecture permits it; otherwise N copies and a differential that drives every one").
 * The rule — only a tagged template literal is a template: its strings array OWNS `raw` — has three homes:
 * `@verajs/renderer`'s `getTemplate`, the lite tier's `genuine` (`packages/lite/src/markup.ts`) and `@verajs/ssr`'s
 * `isLiteral` (a twin: ssr cannot import the private shared package). Sharing the first two was measured and dropped (lite
 * byte-identical, the renderer +4 B gz and one more inlined arrow site), so the three stay, and these cases drive all of
 * them: `tests/lite.test.mjs` (lite and the renderer, in jsdom) and `tests/lite-ssr.test.mjs` (ssr, and lite on
 * the server's DOM). Each case is a CHILD value; `expected` is what the rule says — `markup` (a `<b>` element) or `text`
 * (`[object Object]`, what any object renders as).
 */
const RAW = ['<b>x</b>'];
/** A template-result-shaped value around `strings`, as data from anywhere would carry one. */
const shaped = (strings) => ({ _$litType$: 1, strings, values: [] });

export const FORGED_CASES = [
  /** The control: a real tagged literal, made by the renderer's own `html`. */
  { name: 'a tagged template literal', make: (html) => html`<b>x</b>`, expected: 'markup' },
  { name: 'JSON-parsed data shaped like a template', make: () => JSON.parse('{"_$litType$":1,"strings":["<b>x</b>"],"values":[]}'), expected: 'text' },
  /**
   * A forgery never chooses a namespace (2026-11-18, svg and mathml in lite): data claiming the `svg` or `mathml` kind is
   * text like any other. Rendered as markup in any namespace it would read as `markup` — a `<b>` breaks out of foreign
   * content — so `text` here means it was never parsed at all.
   */
  { name: 'JSON-parsed data shaped like an svg template', make: () => JSON.parse('{"_$litType$":2,"strings":["<b>x</b>"],"values":[]}'), expected: 'text' },
  { name: 'JSON-parsed data shaped like a mathml template', make: () => JSON.parse('{"_$litType$":3,"strings":["<b>x</b>"],"values":[]}'), expected: 'text' },
  /** The rule's own edge: an array that OWNS `raw` passes it, built by hand (JSON cannot build one). */
  { name: 'an array owning raw', make: () => shaped(Object.assign([...RAW], { raw: [...RAW] })), expected: 'markup' },
  { name: 'an array that only INHERITS raw', make: () => shaped(Object.setPrototypeOf([...RAW], Object.assign(Object.create(Array.prototype), { raw: [...RAW] }))), expected: 'text' },
  { name: 'an array-like object owning raw', make: () => shaped({ 0: RAW[0], length: 1, raw: [...RAW] }), expected: 'text' },
  { name: 'a string for strings', make: () => shaped(RAW[0]), expected: 'text' },
];

/** What a rendered `<p>` holding the case shows: `markup`, `text`, or what it unexpectedly holds. */
export const readCase = (p) =>
  p?.querySelector('b') ? 'markup' : p?.textContent === '[object Object]' ? 'text' : `unexpected: ${JSON.stringify(p?.innerHTML ?? null)}`;
