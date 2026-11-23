/**
 * Render a component through the real server pipeline and write the markup as a fixture the browser
 * suite hydrates against.
 *
 *   node scripts/build-hydration-fixture.mjs          # regenerate
 *   node scripts/build-hydration-fixture.mjs --check  # fail if it has drifted (CI)
 *
 * The browser cannot run `@verajs/ssr` — it is Node-only — and hand-writing the expected markup
 * would test the test rather than the handoff. So the server output is generated here and
 * committed, which also makes a serializer change show up as a diff.
 *
 * `--check` exists because a committed artifact that nothing verifies is how this repo has been
 * bitten twice already: `dist/` bundles that went stale while the suites tested pre-refactor code,
 * and size claims that drifted 58% from what the build produced. The same shape applies here and is
 * worse than it looks — the node SSR suite asserts on markup directly and would catch a change it
 * happens to cover, but anything it does not assert on (attribute order, whitespace, a new wrapper
 * element) would leave the browser suite hydrating markup no server produces, passing green.
 * Measured: adding an attribute to the declarative-shadow-DOM template fails the node suite and the
 * browser suite does not notice at all.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { renderToString } from '@verajs/ssr';
import { wire } from '@verajs/core';

/**
 * Light-DOM slots are an app-level opt-in, so the server only distributes when they are wired —
 * exactly as a consuming app wires them. Without this the slot fixture below would serialize
 * literal `<slot>` elements and the browser suite would be adopting markup no slots app emits.
 */
const { slots } = await import('@verajs/renderer/slots');
wire([slots]);

const check = process.argv.includes('--check');

/**
 * **Shapes where the server's reading of markup must be the browser's**, served by the real server for
 * `tests/browser/ssr-parse-agreement.test.js`: a `<` inside a quoted static value before a bound name written again;
 * an HTML `<style>` appended to an `<svg>` through the server's DOM; and a script whose text is double-escaped, as the
 * server's DOM parser reads it (how many scripts, and the first one's text).
 */
const DOUBLE_ESCAPED = "<script><!--\nvar s = '<script src=a.js></script>';\nwindow.ssrDoubleEscaped = 1;\n//--></script><p>after</p>";
const parseAgreement = async () => {
  const { html } = await import('@verajs/core');
  const { serializeTemplate } = await import('@verajs/ssr');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const style = document.createElement('style');
  style.textContent = '<img src=x onerror="window.ssrSvgStyleRan = 1">';
  svg.append(style);
  const holder = document.createElement('div');
  holder.innerHTML = DOUBLE_ESCAPED;
  return {
    quotedLt: serializeTemplate(html`<input title="a <i value=1" value=${'x onclick=window.ssrQuotedLtRan=1 y'}>`),
    unquotedLt: serializeTemplate(html`<b id=a title=x<c id=${'B'}>t</b>`),
    nameLt: serializeTemplate(html`<b id=a x<c=1 id=${'B'}>t</b>`),
    svgStyle: svg.outerHTML,
    doubleEscaped: DOUBLE_ESCAPED,
    doubleEscapedScripts: holder.querySelectorAll('script').length,
    doubleEscapedText: holder.querySelector('script')?.textContent ?? null,
  };
};
/**
 * The server DOM's answers to `createElement` and `setAttribute` for names jsdom cannot judge: a first character that
 * is not an ASCII letter, a character the older XML name rule refused, and the controls and DEL the parser keeps in a
 * name (tab, LF, FF, CR and NUL it does not). The browser suite holds each engine to the same answers.
 */
const ELEMENT_NAMES = ['1a', '-a', '.a', '_a!', '_a/b', '\u00e9a!', '\u00e9a b', '_a', ':a', '\u00e9a', '\u00b7a', '_a\u00b7', '\u00e0', 'a1', 'A', 'a.b', 'a_b', 'a!', ':', '_', 'a\vb', 'a\x01b', 'a\x7fb', 'a\fb', 'a\rb', 'a\0b'];
const ATTRIBUTE_NAMES = ['a\vb', 'a\x01b', 'a\x7fb', 'a\x1fb', 'a\tb', 'a\fb', 'a\rb', 'a\nb', 'a\0b', 'a b', 'a|b', '\u00b7a'];
const answer = (make) => {
  try {
    return make();
  } catch (error) {
    return `THREW ${error.name}`;
  }
};
const elementNames = () => ELEMENT_NAMES.map((name) => answer(() => document.createElement(name).localName));
const attributeNames = () =>
  ATTRIBUTE_NAMES.map((name) => answer(() => (document.createElement('div').setAttribute(name, '1'), 'ok')));
const target = new URL('../tests/browser/fixtures/hello-ssr.html.js', import.meta.url);

const fixture = async (name, options) =>
  (await renderToString(new URL(`../tests/fixtures/ssr/${name}`, import.meta.url), options)).html;

/**
 * Two fixtures. `hello-ssr` is the shape of a page; `bindings-ssr` is every binding kind in one
 * component, so the browser suite can adopt each of them through real declarative shadow DOM —
 * which jsdom cannot parse, and which is therefore the half `tests/hydrate-bindings.test.mjs`
 * cannot reach on its own.
 */
const contents =
  `/** GENERATED by scripts/build-hydration-fixture.mjs — real @verajs/ssr output. Do not edit. */\n` +
  `export const SERVER_HTML = ${JSON.stringify(await fixture('hello-ssr.js'))};\n` +
  `export const BINDINGS_HTML = ${JSON.stringify(await fixture('bindings-ssr.js'))};\n` +
  `export const SHADOW_OPTIONS_HTML = ${JSON.stringify(await fixture('shadow-options-ssr.js'))};\n` +
  /** A root opened with `slotAssignment: 'manual'`, and one that slots by name: the browser decides what each parses to. */
  `export const MANUAL_SLOTS_HTML = ${JSON.stringify(await fixture('manual-slots-ssr.js', { tag: 'manual-slots-ssr' }))};\n` +
  `export const NAMED_SLOTS_HTML = ${JSON.stringify(await fixture('manual-slots-ssr.js', { tag: 'named-slots-ssr' }))};\n` +
  /**
   * An SVG-only ROOT handed across a component boundary — what `@verajs/jsx` emits for an icon in a
   * wrapper. The server writes strings and the BROWSER's parser assigns the namespace, so this is
   * the one seam where the two can disagree silently: an `HTMLUnknownElement` named `path` has the
   * right tag and no geometry. Nothing else in the gate hydrates it; the kitchen fixture's `<svg>`
   * is a template already rooted there, which is the case that always worked.
   */
  `export const SVG_ICON_HTML = ${JSON.stringify(await fixture('svg-icon-ssr.js'))};\n` +
  /**
   * LIGHT-DOM SLOTS, distributed by the server. The one path the jsdom suites cannot settle: real
   * markup, adopted by a real parser, in an engine that has `@scope` and real custom element upgrade
   * timing. It carries a named slot, default content, and content for a slot the template does not
   * have — which the server parks in its inert carrier and hydration must drain back.
   */
  `export const SLOTS_HTML = ${JSON.stringify(
    await fixture('slot-card-ssr.js', {
      children: '<h2 slot="header">Hydrated header</h2>plain body<b>bold</b><p slot="nowhere">parked</p>',
    })
  )};\n` +
  /**
   * COMPONENT PROPS, delivered server-side and re-delivered by hydration. The server renders each
   * child from the values its parent bound (written `.prop`, `!prop`, `props()`/spread, and a
   * list); the browser suite asserts hydration converges on the same content and that the adopted
   * props are live afterwards. This is the seam nothing else exercises through the real pipeline:
   * the child hydrates BEFORE its parent's parts commit, so the props arrive late, through
   * `_$adopt$` — the ordering jsdom suites can only imitate.
   */
  `export const COMPONENT_PROPS_HTML = ${JSON.stringify(await fixture('component-props-ssr.js'))};\n` +
  /**
   * `define` ATTRIBUTES, rendered by the server from the markup's values (the shim delivers observed attributes before
   * connect) — the browser suite hydrates it and asserts the client converges with ONE render and stays live.
   */
  `export const DEFINE_ATTRS_HTML = ${JSON.stringify(
    await fixture('define-attrs-ssr.js', { attributes: { label: 'Hello', 'data-count': '3', tone: 'loud' } })
  )};\n` +
  /**
   * LIGHT components inside SHADOW components' declarative roots (and one in the page): the browser suite hydrates it
   * and asserts each root ends with exactly one copy of the light block, adopted there, and the served nodes kept.
   */
  `export const STYLES_IN_ROOT_HTML = ${JSON.stringify(await fixture('styles-light-in-shadow.js'))};\n` +
  /**
   * A SERVER-RENDERED SPINNER, markup and `styles` both: the browser suite loads them with no script and asserts the
   * arc turns before upgrade. The rule reaches the page only through the server's `styles` (the element adopts its own
   * copy only once script runs), wrapped as `@verajs/styles` wraps a light component's sheet, keyframes included, which
   * is the part only a real engine can judge.
   */
  `export const PARSE_AGREEMENT = ${JSON.stringify(await parseAgreement())};\n` +
  `export const ELEMENT_NAMES = ${JSON.stringify({ names: ELEMENT_NAMES, served: elementNames(), attributes: ATTRIBUTE_NAMES, servedAttributes: attributeNames() })};\n` +
  `export const SPINNER_SSR = ${JSON.stringify(
    await renderToString(new URL('../packages/components/spinner/dist/vera-spinner.min.js', import.meta.url), {
      tag: 'vera-spinner',
      attributes: { label: 'Loading' },
    }).then(({ html, styles }) => ({ html, styles }))
  )};\n`;

if (check) {
  let committed;
  try {
    committed = readFileSync(target, 'utf8');
  } catch {
    console.error('build-hydration-fixture: the fixture is missing. Run without --check to create it.');
    process.exit(1);
  }
  if (committed !== contents) {
    console.error(
      'build-hydration-fixture: the committed fixture no longer matches what @verajs/ssr produces.\n' +
        '  The browser hydration suite is therefore adopting markup no server emits, and passing.\n' +
        '  Regenerate and commit it:\n\n' +
        '    node scripts/build-hydration-fixture.mjs\n'
    );
    process.exit(1);
  }
  console.log('  hydration fixture matches the current serializer output');
} else {
  writeFileSync(target, contents);
  console.log('  wrote tests/browser/fixtures/hello-ssr.html.js');
  console.log(`  ${contents.length} bytes across SERVER_HTML and BINDINGS_HTML`);
}
