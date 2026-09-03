/**
 * **The same component, the same children, rendered by the SERVER and by the CLIENT — compared.**
 *
 * Every divergence this feature has had was found one at a time, by someone happening to try the
 * shape that broke: a shadow component losing its light children, a nested component never being
 * handed its own, a `<template>` costing a host its entire node view. Each was invisible until
 * something specific was tried, and each was the class `CLAUDE.md` calls the worst this package has
 * — the server and the client disagree, and nothing fails until a hydration mismatch turns up
 * somewhere else.
 *
 * So this asks the question directly and in bulk: render a shape server-side, render the same shape
 * client-side, and compare the DOM. What differs legitimately is normalised away and nothing else:
 * the server's hydration markers (which the hydrator strips) and the client's anchor comments
 * (created at instance time and never serialised).
 *
 * Components are generated into a temp directory, the way `ssr-raw-text` does, because SSR renders
 * a module from a URL and a shape has to be a real file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dir = mkdtempSync(join(process.cwd(), 'tests', '.parity-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

/** Template shape × the children handed to it. Each pair is one comparison. */
const SHAPES = {
  'named + default': ['<article><header><slot name="h">no-h</slot></header><main><slot>no-d</slot></main></article>',
    '<b slot="h">H</b>body<i>i</i>'],
  'only fallback': ['<article><header><slot name="h">no-h</slot></header><main><slot>no-d</slot></main></article>', ''],
  'default only': ['<main><slot>no-d</slot></main>', 'just text'],
  'named only, nothing for it': ['<header><slot name="h">no-h</slot></header>', 'stray text'],
  'unclaimed content parked': ['<header><slot name="h">no-h</slot></header>', '<b slot="h">H</b><i slot="nope">N</i>'],
  'two slots one name': ['<p><slot name="h">a</slot></p><p><slot name="h">b</slot></p>', '<b slot="h">H</b>'],
  'slot at root': ['<slot name="h">no-h</slot>', '<b slot="h">H</b>'],
  'slot with no fallback': ['<p><slot name="h"></slot></p>', '<b slot="h">H</b>'],
  'template in the markup': ['<p><slot name="h">no-h</slot><template><i>t</i></template></p>', '<b slot="h">H</b>'],
  'template as content': ['<p><slot name="h">no-h</slot></p>', '<template slot="h"><i>t</i></template>'],
  'nested slot in fallback': ['<p><slot name="a"><slot name="b">inner</slot></slot></p>', '<i slot="b">B</i>'],
  'whitespace only': ['<main><slot>no-d</slot></main>', '   '],
  'entities': ['<main><slot>no-d</slot></main>', 'a &amp; b &lt;c&gt;'],
  'element with attributes': ['<main><slot>no-d</slot></main>', '<b id="x" data-k="v">B</b>'],
};

/**
 * Three things differ legitimately and are normalised away — nothing else is.
 *
 * The server's `data-vera-slotted` markers are the hydration handoff and the hydrator strips them.
 * The client's anchors are comments it never serialises. And the unassigned CARRIER is the server's
 * serialisation of state the client holds in memory: a server render has no holding fragment, so
 * content no slot claimed has to persist in the HTML for hydration to recover it, and it goes in an
 * inert `<template>` which no browser renders.
 *
 * That last one is only fair to normalise if the retained content itself is compared, which
 * `retained()` below does — otherwise this would be hiding exactly the kind of difference the file
 * exists to find.
 */
const CARRIER = /<template data-vera-unassigned="?"?>([\s\S]*?)<\/template>/g;
const normalise = (markup) =>
  markup
    .replace(CARRIER, '')
    .replace(/ data-vera-slotted="[^"]*"/g, '')
    .replace(/<!---->/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** What the SERVER parked, as text — to be matched against what the CLIENT is holding. */
const parked = (markup) =>
  [...markup.matchAll(CARRIER)].map(([, inner]) => inner).join('').replace(/\s+/g, ' ').trim();

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent',
  'MutationObserver', 'Comment', 'Text',
]) {
  globalThis[key] = dom.window[key];
}
const { wire } = await load('core');
const { renderer, renderInto } = await load('renderer');
const { renderInto: hydrateInto, renderer: hydrateRenderer } = await load('renderer/hydrate');
const { slots, slotted } = await load('renderer/slots');
wire([renderer, slots]);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** SSR runs in its own process: its shims own globals, and this file already has jsdom's. */
const server = (tag, template, children, shadow = false) => {
  const file = join(dir, `${tag}.js`);
  writeFileSync(
    file,
    `import { init, render, html } from '@verajs/core';\n` +
      `export default class S extends HTMLElement {\n` +
      `  connectedCallback() { init(this${shadow ? ", { mode: 'open' }" : ''}); render(() => html\`${template}\`); }\n` +
      `}\n` +
      `customElements.define('${tag}', S);\n`
  );
  const script =
    `import { renderToString } from '@verajs/ssr';\n` +
    `import { wire } from '@verajs/core';\n` +
    `const { slots } = await import('@verajs/renderer/slots');\n` +
    `wire([slots]);\n` +
    `const out = await renderToString(new URL('file://${file}'), { children: ${JSON.stringify(children)} });\n` +
    `process.stdout.write(out.html);\n`;
  const html = execFileSync(process.execPath, ['--conditions', 'development', '--input-type=module', '-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  /** The host's own tag is the wrapper both sides share; compare what is INSIDE it. */
  return html.replace(new RegExp(`^<${tag}[^>]*>`), '').replace(new RegExp(`</${tag}>$`), '');
};

let index = 0;
for (const [label, [template, children]] of Object.entries(SHAPES))
  test(`server and client agree: ${label}`, async () => {
    const tag = `parity-${index++}`;
    const fromServer = server(tag, template, children);

    const host = dom.window.document.createElement('div');
    host.innerHTML = children;
    dom.window.document.body.append(host);
    renderInto({ strings: Object.assign([template], { raw: [template] }), values: [] }, host);
    await settle();
    const fromClient = host.innerHTML;

    assert.equal(normalise(fromClient), normalise(fromServer),
      `the two renders disagree.\n  server: ${normalise(fromServer)}\n  client: ${normalise(fromClient)}`);

    /**
     * And whatever the server parked, the client must be HOLDING — the same content, retained the
     * same way, one in markup and one in memory. Without this the carrier could be normalised away
     * while the two sides genuinely disagreed about what survived.
     */
    const parkedText = parked(fromServer);
    if (parkedText !== '') {
      /**
       * The names come from the CHILDREN the test supplied, not from the host: unclaimed content
       * is held in a detached fragment, so it is precisely the nodes this assertion is about that
       * a query on the host can never find.
       */
      const held = [...new Set([...children.matchAll(/slot="([^"]*)"/g)].map(([, name]) => name))]
        .concat([''])
        .flatMap((name) => slotted(host, name))
        .map((node) => node.textContent)
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
      const parkedTextOnly = parkedText.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      assert.ok(held.includes(parkedTextOnly),
        `the server parked ${JSON.stringify(parkedTextOnly)} but the client is not holding it (holds ${JSON.stringify(held)})`);
    }
    host.remove();
  });

/**
 * **The third corner: server output, HYDRATED, against the client-only render.**
 *
 * The two comparisons above hold the server to the client. This holds the HYDRATED result to it —
 * which is the corner that produced this feature's worst defects, because a mismatch there does not
 * merely render differently, it discards the server's DOM and once destroyed the user's content
 * outright. A shape can serialise correctly and still adopt wrongly.
 *
 * The hydrate entry carries its own renderer, so it needs its own wiring; the seam is resolved from
 * the registry `connect()` hands it, exactly as the base entry's is.
 */
wire([hydrateRenderer, slots]);

let hydrateIndex = 0;
for (const [label, [template, children]] of Object.entries(SHAPES))
  test(`hydrating the server's output matches a client render: ${label}`, async () => {
    const tag = `hydrated-${hydrateIndex++}`;
    const fromServer = server(tag, template, children);

    /** Client-only, for the answer to match. */
    const fresh = dom.window.document.createElement('div');
    fresh.innerHTML = children;
    dom.window.document.body.append(fresh);
    renderInto({ strings: Object.assign([template], { raw: [template] }), values: [] }, fresh);
    await settle();
    const clientOnly = normalise(fresh.innerHTML);

    /** The server's markup, adopted. */
    const hydrated = dom.window.document.createElement('div');
    hydrated.innerHTML = fromServer;
    dom.window.document.body.append(hydrated);
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (message) => warnings.push(String(message));
    try {
      hydrateInto({ strings: Object.assign([template], { raw: [template] }), values: [] }, hydrated);
      await settle();
    } finally {
      console.warn = originalWarn;
    }

    assert.deepEqual(warnings.filter((w) => w.includes('fell back to a client render')), [],
      `adoption bailed, so the server's work was thrown away.\n  server: ${normalise(fromServer)}`);
    assert.equal(normalise(hydrated.innerHTML), clientOnly,
      `hydrated and client-only disagree.\n  hydrated: ${normalise(hydrated.innerHTML)}\n  client:   ${clientOnly}`);
    fresh.remove();
    hydrated.remove();
  });

/**
 * **And the same question for a SHADOW component, with slots WIRED.**
 *
 * The first defect this feature ever had was here: lifting a host's children out before the
 * lifecycle, so the light path could distribute them, took them from SHADOW hosts too — and only
 * the light path put them back. The synchronous chain dropped the content from the page and the
 * asynchronous one buried it in the unassigned carrier. Nothing about a slots app's own tests could
 * see it, because the component that broke was the one NOT using the feature.
 *
 * A shadow component's serialisation is its declarative shadow template followed by its own light
 * DOM, and the light DOM is the part that went missing — so it is the part compared here. The
 * platform slots it; nothing in this module may touch it.
 */
let shadowIndex = 0;
for (const [label, [template, children]] of Object.entries(SHAPES))
  test(`a SHADOW component is untouched by slots being wired: ${label}`, async () => {
    const tag = `shadow-parity-${shadowIndex++}`;
    const fromServer = server(tag, template, children, /* shadow */ true);

    /**
     * The light DOM follows the declarative template — that is what has to survive. PARSED out
     * rather than pattern-matched: a non-greedy regex stops at the first `</template>`, which for a
     * component whose own markup contains one is the wrong tag entirely.
     */
    const parsed = dom.window.document.createElement('div');
    parsed.innerHTML = fromServer;
    const shadowTemplate = [...parsed.children].find((node) => node.hasAttribute('shadowrootmode'));
    assert.ok(shadowTemplate, 'CONTROL: the server emitted a declarative shadow template');
    shadowTemplate.remove();
    const serverLight = normalise(parsed.innerHTML);

    const host = dom.window.document.createElement('div');
    host.innerHTML = children;
    dom.window.document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    renderInto({ strings: Object.assign([template], { raw: [template] }), values: [] }, root);
    await settle();

    assert.equal(serverLight, normalise(host.innerHTML),
      `the server and the client disagree about a shadow host's own light DOM.\n` +
        `  server: ${serverLight}\n  client: ${normalise(host.innerHTML)}`);
    assert.doesNotMatch(fromServer, /data-vera-slotted|data-vera-unassigned/,
      'and no light-slots marker belongs on a component the platform slots');
    host.remove();
  });
