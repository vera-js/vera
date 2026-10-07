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
 * client-side, and compare the DOM. What differs legitimately is normalized away and nothing else:
 * the server's hydration markers (which the hydrator strips) and the client's anchor comments
 * (created at instance time and never serialized).
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
 * Three things differ legitimately and are normalized away — nothing else is.
 *
 * The server's region markers (`<!--[-->` / `<!--]-->` around a filled slot) are the client's own, so they are compared
 * as-is; the client's anchors are empty comments the server never writes. And the client's unassigned container carries an inline `display: none !important`
 * beside `hidden` — written through CSSOM, so an author stylesheet cannot make unassigned content render — which the
 * server deliberately does not emit (a strict CSP blocks a `style=` attribute in served markup; hydration sets it on
 * adoption). Everything else about `<vm-unassigned hidden>` — that it exists, where, and what it holds — is compared:
 * since connected parking (2026-10-02) both sides emit the same element in the same place.
 */
/** The container's inline style, however a serializer writes it (jsdom drops the `!important` it holds) — and nowhere else. */
const CLIENT_HIDING = /(<vm-unassigned hidden(?:="")?) style="[^"]*"/g;
const normalize = (markup) =>
  markup
    .replace(CLIENT_HIDING, '$1')
    .replace(/<!---->/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** What the server parked: the content of its `<vm-unassigned hidden>`. */
const CARRIER = /<vm-unassigned hidden="?"?>([\s\S]*?)<\/vm-unassigned>/g;
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
const { hydration } = await load('renderer/hydration');
const { slots, slotted } = await load('renderer/slots');
const { hydrateSlots } = await load('renderer/hydrate-slots');
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
  hosts.set(tag, html);
  /** The format NUMBER the hydration side reads (`FORMAT` in both packages) — held fixed across the writer's move. */
  if (!shadow) assert.match(html, new RegExp(`^<${tag} data-vm-light="1:`), `the server states format 1: ${html}`);
  return html.replace(new RegExp(`^<${tag}[^>]*>`), '').replace(new RegExp(`</${tag}>$`), '');
};
/**
 * The server's WHOLE output per tag, host element included — the host carries `data-vm-light`, the
 * statement of its light tree that hydration reads, so the corner that hydrates must keep it.
 */
const hosts = new Map();

let index = 0;
/**
 * The client-only answer per shape, from the loop below: a custom-element host rendered BEFORE hydration is wired. The
 * hydration loop compares against it — rendering a client-only answer there would itself be adopted (hydration is wired
 * by then), and a plain container never captures light content (ruling 4), so either way it is not the answer.
 */
const clientAnswers = new Map();
/**
 * CONTROL: shapes in which the server parked content and the retained-content check below RAN. It ran for none from
 * connected parking until its pattern caught up (it looked for the retired `<template>` carrier): a rename of the
 * container must turn this red, never silence it.
 */
let parkedShapes = 0;
for (const [label, [template, children]] of Object.entries(SHAPES))
  test(`server and client agree: ${label}`, async () => {
    const tag = `parity-${index++}`;
    const fromServer = server(tag, template, children);

    /**
     * A CUSTOM element, as the server's host is (Brian's ruling 4: light slots capture custom elements, by name; a
     * plain container keeps what it had). Never defined here, so the renderer's own first render captures it.
     */
    const host = dom.window.document.createElement(`${tag}-client`);
    host.innerHTML = children;
    dom.window.document.body.append(host);
    renderInto({ strings: Object.assign([template], { raw: [template] }), values: [] }, host);
    await settle();
    const fromClient = host.innerHTML;
    clientAnswers.set(label, normalize(fromClient));

    assert.equal(normalize(fromClient), normalize(fromServer),
      `the two renders disagree.\n  server: ${normalize(fromServer)}\n  client: ${normalize(fromClient)}`);

    /**
     * And whatever the server parked, the client must be HOLDING — the same content, retained the
     * same way, one in markup and one in memory. Without this the carrier could be normalized away
     * while the two sides genuinely disagreed about what survived.
     */
    const parkedText = parked(fromServer);
    if (parkedText !== '') {
      parkedShapes++;
      /**
       * The names come from the CHILDREN the test supplied: `slotted()` answers for unassigned content by name, as it
       * waits in the host's hidden container.
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
 * Hydration is wired by the FIRST hydration test, not here: module code runs before every test, and with hydration
 * wired a first render into a container that already holds children adopts them — the client-render tests above render
 * light hosts holding their user's children, which are light content, never server output.
 */
let hydrationWired = false;
const hydrateInto = (result, container) => {
  if (!hydrationWired) {
    hydrationWired = true;
    wire([hydration, hydrateSlots]);
  }
  return renderInto(result, container);
};

let hydrateIndex = 0;
for (const [label, [template, children]] of Object.entries(SHAPES))
  test(`hydrating the server's output matches a client render: ${label}`, async () => {
    const tag = `hydrated-${hydrateIndex++}`;
    const fromServer = server(tag, template, children);

    /** Client-only, for the answer to match — recorded by the client-render loop, which must have run. */
    const clientOnly = clientAnswers.get(label);
    assert.ok(clientOnly !== undefined, `no client-only answer was recorded for ${label}`);

    /** The server's markup, adopted. */
    const wrap = dom.window.document.createElement('div');
    wrap.innerHTML = hosts.get(tag);
    const hydrated = wrap.firstElementChild;
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

    assert.deepEqual(warnings.filter((w) => w.includes('hydration-fallback')), [],
      `adoption bailed, so the server's work was thrown away.\n  server: ${normalize(fromServer)}`);
    assert.equal(normalize(hydrated.innerHTML), clientOnly,
      `hydrated and client-only disagree.\n  hydrated: ${normalize(hydrated.innerHTML)}\n  client:   ${clientOnly}`);
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
 * A shadow component's serialization is its declarative shadow template followed by its own light
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
    const serverLight = normalize(parsed.innerHTML);

    const host = dom.window.document.createElement('div');
    host.innerHTML = children;
    dom.window.document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    renderInto({ strings: Object.assign([template], { raw: [template] }), values: [] }, root);
    await settle();

    assert.equal(serverLight, normalize(host.innerHTML),
      `the server and the client disagree about a shadow host's own light DOM.\n` +
        `  server: ${serverLight}\n  client: ${normalize(host.innerHTML)}`);
    assert.doesNotMatch(fromServer, /data-vm-slotted|data-vm-unassigned/,
      'and no light-slots marker belongs on a component the platform slots');
    host.remove();
  });

test('CONTROL: the retained-content check ran for every shape that parks content', () => {
  assert.ok(parkedShapes >= 2, `only ${parkedShapes} shape(s) had parked content checked — the carrier pattern matched nothing`);
});
