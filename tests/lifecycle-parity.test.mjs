/**
 * **Generalized:** the server and the client must produce the same DOM for the same *component*.
 *
 * `./render-parity.test.mjs` asks this about a template. This asks it about everything around one —
 * the custom-element lifecycle — which is where the server had been quietly disagreeing with the
 * browser:
 *
 * - `requestAnimationFrame` was shimmed to `setTimeout`, so every re-render scheduled during
 *   `connectedCallback` and every `useEffect` landed after the response was already built. The
 *   ordinary `render(); state.x = fromAttribute` shape shipped the pre-assignment markup.
 * - `attributeChangedCallback` never fired at all, on upgrade or afterwards — the only reactive
 *   attribute mechanism a plain custom element has.
 * - A component whose render threw was serialized empty, into a 200.
 *
 * Each was one instance of "the lifecycle runs differently on the two sides". Adding a case is a
 * few lines; prefer it over a bespoke test whenever the question is "do the two sides agree".
 *
 * The comparison is the host's own attributes plus its canonical shadow DOM, so a component that
 * writes to itself (`classList`, `dataset`, `setAttribute`) is covered as well as one that draws.
 */
import { load } from './dist.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { canonical } from './canonical.mjs';

/**
 * `statics` are class members, `body` is the `connectedCallback`. Both sides compile the *same*
 * source — the point of the suite is that only the environment differs.
 */
const CASES = {
  'plain render': {
    body: `init(this, { mode: 'open' }); render(() => html\`<p>hi</p>\`);`,
  },
  'state settled after render()': {
    attributes: { n: '7' },
    body: `
      init(this, { mode: 'open' });
      const state = createStore({ n: 0 });
      render(() => html\`<p>n=\${state.n}</p>\`);
      state.n = Number(this.getAttribute('n'));
    `,
  },
  'state settled twice after render()': {
    body: `
      init(this, { mode: 'open' });
      const state = createStore({ n: 0 });
      render(() => html\`<p>n=\${state.n}</p>\`);
      state.n = 1;
      state.n = 2;
    `,
  },
  'useEffect derives state': {
    body: `
      init(this, { mode: 'open' });
      const state = createStore({ n: 1, doubled: 0 });
      useEffect(() => { state.doubled = state.n * 2; });
      render(() => html\`<p>\${state.n}/\${state.doubled}</p>\`);
      state.n = 4;
    `,
  },
  'useEffect that only reads': {
    body: `
      init(this, { mode: 'open' });
      const state = createStore({ n: 1 });
      const seen = [];
      useEffect(() => { seen.push(state.n); });
      render(() => html\`<p>\${state.n} seen=\${seen.length > 0}</p>\`);
      state.n = 2;
    `,
  },
  'attributeChangedCallback on upgrade': {
    attributes: { label: 'from-attribute' },
    statics: `
      static observedAttributes = ['label'];
      seen = [];
      attributeChangedCallback(name, previous, value) { this.seen.push(name + ':' + previous + '>' + value); }
    `,
    body: `init(this, { mode: 'open' }); render(() => html\`<p>\${this.seen.join('|') || 'never fired'}</p>\`);`,
  },
  'attributeChangedCallback for an absent attribute stays silent': {
    statics: `
      static observedAttributes = ['label', 'other'];
      seen = [];
      attributeChangedCallback(name) { this.seen.push(name); }
    `,
    body: `init(this, { mode: 'open' }); render(() => html\`<p>[\${this.seen.join('|')}]</p>\`);`,
  },
  'attributeChangedCallback when the component changes its own attribute': {
    statics: `
      static observedAttributes = ['state'];
      seen = [];
      attributeChangedCallback(name, previous, value) { this.seen.push(previous + '>' + value); }
    `,
    body: `
      init(this, { mode: 'open' });
      this.setAttribute('state', 'ready');
      this.setAttribute('state', 'ready');
      this.setAttribute('state', 'done');
      this.removeAttribute('state');
      this.toggleAttribute('state', true);
      render(() => html\`<p>\${this.seen.join('|')}</p>\`);
    `,
  },
  'attributeChangedCallback derives rendered state': {
    attributes: { count: '3' },
    statics: `
      static observedAttributes = ['count'];
      count = 0;
      attributeChangedCallback(name, previous, value) { this.count = Number(value); }
    `,
    body: `init(this, { mode: 'open' }); render(() => html\`<p>\${this.count}</p>\`);`,
  },
  'attribute read straight from the host': {
    attributes: { greeting: 'hello & <you>' },
    body: `init(this, { mode: 'open' }); render(() => html\`<p>\${this.getAttribute('greeting')}</p>\`);`,
  },
  'the component writes to its own host': {
    body: `
      init(this, { mode: 'open' });
      this.setAttribute('role', 'button');
      this.classList.add('ready', 'themed');
      this.dataset.state = 'open';
      this.style.color = 'red';
      render(() => html\`<p>host</p>\`);
    `,
  },
  /**
   * Reflected properties are a view of an attribute, so every one of these changes the markup. They
   * were plain properties on the server: the assignment stuck to the object and the attribute never
   * appeared, so the two sides disagreed about the element's own opening tag.
   */
  /**
   * `part` and the braille ARIA pair are absent from this case because **jsdom** lacks them, not
   * because the shim does — the client side of this harness is the weaker DOM. Their behaviour is
   * covered by `tests/ssr-dom-surface.test.mjs`, and their existence in real engines by
   * `tests/browser/dom-surface.test.js`.
   */
  'the component sets its reflected properties': {
    body: `
      init(this, { mode: 'open' });
      this.id = 'widget';
      this.className = 'a b';
      this.title = 'a & b';
      this.role = 'button';
      this.tabIndex = -1;
      this.hidden = true;
      this.draggable = true;
      this.translate = false;
      this.lang = 'en';
      this.dir = 'ltr';
      this.slot = 'main';
      render(() => html\`<p>reflected</p>\`);
    `,
  },
  'the component sets ARIA through properties': {
    body: `
      init(this, { mode: 'open' });
      this.ariaLabel = 'Close';
      this.ariaExpanded = 'false';
      this.ariaValueMax = '10';
      render(() => html\`<p>aria</p>\`);
    `,
  },
  'a reflected property reads back what the attribute holds': {
    attributes: { id: 'from-markup', tabindex: '3', hidden: '' },
    body: `
      init(this, { mode: 'open' });
      const read = [this.id, this.tabIndex, this.hidden, this.className].join('|');
      render(() => html\`<p>\${read}</p>\`);
    `,
  },
  'clearing a reflected property removes the attribute': {
    attributes: { 'aria-label': 'gone' },
    body: `
      init(this, { mode: 'open' });
      this.ariaLabel = null;
      this.hidden = false;
      render(() => html\`<p>cleared</p>\`);
    `,
  },
  /**
   * A component that builds a child itself, which is how structured data reaches a child outside a
   * template binding. The server used to re-create that child from its markup, so everything the
   * parent had assigned to it was gone.
   */
  'a child built with createElement keeps what the parent gave it': {
    body: `
      init(this, { mode: 'open' });
      const kid = document.createElement('lp-created-child');
      kid.rows = ['from', 'the', 'parent'];
      kid.setAttribute('label', 'set too');
      render(() => html\`<div></div>\`);
      (this.shadowRoot ?? this._root).appendChild(kid);
    `,
    defines: `
      class Child extends HTMLElement {
        rows = ['default'];
        connectedCallback() {
          init(this, { mode: 'open' });
          render(() => html\`<p>\${this.rows.join(',')}|\${this.getAttribute('label')}</p>\`);
        }
      }
      customElements.define('lp-created-child', Child);
    `,
  },
  'createElement of a registered tag builds the component': {
    body: `
      init(this, { mode: 'open' });
      const kid = document.createElement('lp-created-probe');
      const plain = document.createElement('div');
      render(() => html\`<p>\${kid instanceof HTMLElement}|\${kid.rows.join(',')}|\${plain.localName}</p>\`);
    `,
    defines: `
      class Child extends HTMLElement {
        rows = ['default'];
        connectedCallback() { init(this, { mode: 'open' }); render(() => html\`<i></i>\`); }
      }
      customElements.define('lp-created-probe', Child);
    `,
  },
  /**
   * Nested components, which until `canonical` learned to read a declarative template were never
   * being compared at all — both sides reported an empty child and agreed.
   */
  'a child written in the parent template': {
    body: `
      init(this, { mode: 'open' });
      render(() => html\`<div><lp-nested-plain></lp-nested-plain></div>\`);
    `,
    defines: `
      class Plain extends HTMLElement {
        connectedCallback() { init(this, { mode: 'open' }); render(() => html\`<p>plain child</p>\`); }
      }
      customElements.define('lp-nested-plain', Plain);
    `,
  },
  'a child taking an attribute from the parent': {
    body: `
      init(this, { mode: 'open' });
      const label = 'a & b';
      render(() => html\`<lp-nested-attr label=\${label}></lp-nested-attr>\`);
    `,
    defines: `
      class Attr extends HTMLElement {
        connectedCallback() { init(this, { mode: 'open' }); render(() => html\`<p>[\${this.getAttribute('label')}]</p>\`); }
      }
      customElements.define('lp-nested-attr', Attr);
    `,
  },
  'a list of children': {
    body: `
      init(this, { mode: 'open' });
      const rows = ['a', 'b', 'c'];
      render(() => html\`<ul>\${rows.map((row) => html\`<lp-nested-row label=\${row}></lp-nested-row>\`)}</ul>\`);
    `,
    defines: `
      class Row extends HTMLElement {
        connectedCallback() { init(this, { mode: 'open' }); render(() => html\`<li>\${this.getAttribute('label')}</li>\`); }
      }
      customElements.define('lp-nested-row', Row);
    `,
  },
  'a grandchild': {
    body: `
      init(this, { mode: 'open' });
      render(() => html\`<lp-nested-middle></lp-nested-middle>\`);
    `,
    defines: `
      class Deep extends HTMLElement {
        connectedCallback() { init(this, { mode: 'open' }); render(() => html\`<b>deep</b>\`); }
      }
      customElements.define('lp-nested-deep', Deep);
      class Middle extends HTMLElement {
        connectedCallback() { init(this, { mode: 'open' }); render(() => html\`<span><lp-nested-deep></lp-nested-deep></span>\`); }
      }
      customElements.define('lp-nested-middle', Middle);
    `,
  },
  'a child with light-DOM content to slot': {
    body: `
      init(this, { mode: 'open' });
      render(() => html\`<lp-nested-slotter><em>slotted</em></lp-nested-slotter>\`);
    `,
    defines: `
      class Slotter extends HTMLElement {
        connectedCallback() { init(this, { mode: 'open' }); render(() => html\`<div><slot></slot></div>\`); }
      }
      customElements.define('lp-nested-slotter', Slotter);
    `,
  },
  'a child that renders into the light DOM': {
    body: `
      init(this, { mode: 'open' });
      render(() => html\`<lp-nested-light></lp-nested-light>\`);
    `,
    defines: `
      class Light extends HTMLElement {
        connectedCallback() { init(this); render(() => html\`<p>light</p>\`); }
      }
      customElements.define('lp-nested-light', Light);
    `,
  },
  'closed shadow root': {
    body: `init(this, { mode: 'closed' }); render(() => html\`<p>closed</p>\`);`,
  },
  'a list built from an attribute': {
    attributes: { rows: 'a,b,c' },
    body: `
      init(this, { mode: 'open' });
      const rows = this.getAttribute('rows').split(',');
      render(() => html\`<ul>\${rows.map((row) => html\`<li>\${row}</li>\`)}</ul>\`);
    `,
  },
  'a form control bound from state': {
    body: `
      init(this, { mode: 'open' });
      const state = createStore({ text: 'v' });
      render(() => html\`<input .value=\${state.text} ?disabled=\${false} />\`);
      state.text = 'changed';
    `,
  },
  /**
   * How many times the template actually ran, printed by the template itself.
   *
   * The client coalesces the two assignments into one re-render, because the scheduler defers past
   * the end of `connectedCallback`. A server shim that ran scheduled work *immediately* would
   * re-render after each statement instead — the same final DOM, arrived at a different number of
   * times, and any component counting its own renders would disagree with the browser.
   */
  'renders are coalesced the same way': {
    body: `
      init(this, { mode: 'open' });
      const state = createStore({ n: 0 });
      let renders = 0;
      render(() => { renders++; return html\`<p>renders=\${renders} n=\${state.n}</p>\`; });
      state.n = 1;
      state.n = 2;
    `,
  },
  /**
   * Ordering, not just count: the frame is scheduled *before* `render()` and must still find the
   * template drawn, because on the client the frame comes after `connectedCallback` returns.
   */
  'a frame scheduled during connectedCallback runs after it': {
    body: `
      init(this, { mode: 'open' });
      const state = createStore({ when: 'not run' });
      const root = this.shadowRoot ?? this._root;
      requestAnimationFrame(() => { state.when = root.innerHTML.includes('<p>') ? 'after the render' : 'before it'; });
      render(() => html\`<p>\${state.when}</p>\`);
    `,
  },
  /** A frame scheduled from inside a frame is the next frame — it runs, on both sides. */
  'a frame scheduled from inside a frame': {
    body: `
      init(this, { mode: 'open' });
      const state = createStore({ depth: 0 });
      requestAnimationFrame(() => { state.depth = 1; requestAnimationFrame(() => { state.depth = 2; }); });
      render(() => html\`<p>depth=\${state.depth}</p>\`);
    `,
  },
  /** A browser runs each frame callback independently; one throwing must not skip the next. */
  'a throwing frame does not take the next one down': {
    body: `
      init(this, { mode: 'open' });
      const state = createStore({ ran: 'no' });
      requestAnimationFrame(() => { throw new Error('ignored by this case'); });
      requestAnimationFrame(() => { state.ran = 'yes'; });
      render(() => html\`<p>ran=\${state.ran}</p>\`);
    `,
    /** The server collects the throw and fails the render; the client only reports it. */
    serverThrows: /ignored by this case/,
  },
  /** cancelAnimationFrame is honoured, not ignored. */
  'a cancelled frame does not run': {
    body: `
      init(this, { mode: 'open' });
      const state = createStore({ ran: 'no' });
      const id = requestAnimationFrame(() => { state.ran = 'yes'; });
      cancelAnimationFrame(id);
      render(() => html\`<p>ran=\${state.ran}</p>\`);
    `,
  },
  /** A component that listens to itself is ordinary; on the server the listener was a no-op. */
  'the component listens to its own event': {
    body: `
      init(this, { mode: 'open' });
      const state = createStore({ heard: 'no' });
      this.addEventListener('ping', (event) => { state.heard = event.detail; });
      render(() => html\`<p>heard=\${state.heard}</p>\`);
      this.dispatchEvent(new CustomEvent('ping', { detail: 'yes' }));
    `,
  },
  'a removed listener stops hearing': {
    body: `
      init(this, { mode: 'open' });
      const state = createStore({ count: 0 });
      const onPing = () => { state.count++; };
      this.addEventListener('ping', onPing);
      this.dispatchEvent(new CustomEvent('ping'));
      this.removeEventListener('ping', onPing);
      this.dispatchEvent(new CustomEvent('ping'));
      render(() => html\`<p>count=\${state.count}</p>\`);
    `,
  },
  'preventDefault reaches the dispatcher': {
    body: `
      init(this, { mode: 'open' });
      this.addEventListener('ping', (event) => event.preventDefault());
      const delivered = this.dispatchEvent(new CustomEvent('ping', { cancelable: true }));
      render(() => html\`<p>delivered=\${delivered}</p>\`);
    `,
  },
  'the host reads its own light-DOM children': {
    children: '<span>kid</span>',
    body: `
      const kids = this.innerHTML;
      init(this, { mode: 'open' });
      render(() => html\`<p>[\${kids}]</p>\`);
    `,
  },
  /** Loosely coupled components talk through `window` and `document`; both were no-ops. */
  'a window event the component dispatches itself': {
    body: `
      init(this, { mode: 'open' });
      const state = createStore({ heard: 'no' });
      window.addEventListener('app:ping', (event) => { state.heard = event.detail; });
      render(() => html\`<p>window=\${state.heard}</p>\`);
      window.dispatchEvent(new CustomEvent('app:ping', { detail: 'yes' }));
    `,
  },
  'a document event the component dispatches itself': {
    body: `
      init(this, { mode: 'open' });
      const state = createStore({ heard: 'no' });
      document.addEventListener('app:ping', (event) => { state.heard = event.detail; });
      render(() => html\`<p>document=\${state.heard}</p>\`);
      document.dispatchEvent(new CustomEvent('app:ping', { detail: 'yes' }));
    `,
  },
  'a once listener fires once': {
    body: `
      init(this, { mode: 'open' });
      const state = createStore({ count: 0 });
      this.addEventListener('ping', () => { state.count++; }, { once: true });
      this.dispatchEvent(new CustomEvent('ping'));
      this.dispatchEvent(new CustomEvent('ping'));
      render(() => html\`<p>count=\${state.count}</p>\`);
    `,
  },
  'a handleEvent object is a listener': {
    body: `
      init(this, { mode: 'open' });
      const state = createStore({ heard: 'no' });
      this.addEventListener('ping', { handleEvent: () => { state.heard = 'yes'; } });
      this.dispatchEvent(new CustomEvent('ping'));
      render(() => html\`<p>object=\${state.heard}</p>\`);
    `,
  },
  'the listener sees the target': {
    body: `
      init(this, { mode: 'open' });
      const state = createStore({ target: 'none' });
      this.addEventListener('ping', (event) => { state.target = event.target === this ? 'self' : 'other'; });
      this.dispatchEvent(new CustomEvent('ping'));
      render(() => html\`<p>target=\${state.target}</p>\`);
    `,
  },
  'render() called bare, then again with a template': {
    body: `
      init(this, { mode: 'open' });
      const state = createStore({ n: 1 });
      render(() => html\`<p>\${state.n}</p>\`);
      state.n = 2;
      state.n = 3;
    `,
  },
};

/**
 * Divergences that are correct and deliberate. Pinned here so they stay *known* — the failure this
 * suite exists to prevent is a divergence nobody wrote down.
 */
const KNOWN_DIVERGENCES = {
  /**
   * A layout effect is scheduled on a microtask, and a server render is synchronous end to end —
   * there is no point between "the render finished" and "the markup was serialized" for a microtask
   * to run in. React's `useLayoutEffect` does not run during SSR either, for the same reason and
   * with the same consequence: state settled there must be settled before `render()` instead.
   */
  'useLayoutEffect does not run on the server': {
    body: `
      init(this, { mode: 'open' });
      const state = createStore({ label: 'start' });
      useLayoutEffect(() => { if (state.label === 'start') state.label = 'layout-ran'; });
      render(() => html\`<p>\${state.label}</p>\`);
      state.label = 'start';
    `,
    server: '<p >start</p>',
    client: '<p >layout-ran</p>',
  },
};

/**
 * An endless animation loop is browser-only code that is nonetheless reachable on a server. It must
 * not hang the request, so the server stops after a bounded number of rounds — which means the two
 * sides legitimately disagree about how far the loop got. Asserted as a divergence in *shape*: the
 * server finished, and neither side is still at zero. The loop length must stay above the shim's
 * `FRAME_ROUNDS`, or the server reaches the end and the case stops asking anything.
 */
KNOWN_DIVERGENCES['an endless animation loop is bounded, not hung'] = {
  body: `
    init(this, { mode: 'open' });
    const state = createStore({ frames: 0 });
    const loop = () => { state.frames++; if (state.frames < 25) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    render(() => html\`<p>bounded=\${state.frames > 0 && state.frames < 25}</p>\`);
  `,
  server: '<p >bounded=true</p>',
  client: '<p >bounded=true</p>',
};

const ALL = { ...CASES, ...KNOWN_DIVERGENCES };
const IMPORTS = `import { init, render, html, createStore, useEffect, useLayoutEffect } from '@verajs/core';`;
const source = (name, spec) => `${IMPORTS}
${spec.defines ?? ''}
class C extends HTMLElement {
  ${spec.statics ?? ''}
  connectedCallback() {${spec.body}}
}
customElements.define(${JSON.stringify(name)}, C);
export default C;
`;

/** A stable, legal tag per case. */
const tagOf = (name) => `lp-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '')}`;

/* ── server ──────────────────────────────────────────────────────────────────────────────────── */
/**
 * Inside the repo, because `renderToString` takes a module URL and that module imports
 * `@verajs/core` by bare specifier — a temp directory outside the tree cannot resolve it.
 */
const dir = mkdtempSync(new URL('./.lifecycle-', import.meta.url).pathname);
let server;
try {
  const files = {};
  for (const [name, spec] of Object.entries(ALL)) {
    const tag = tagOf(name);
    files[name] = `${dir}/${tag}.js`;
    writeFileSync(files[name], source(tag, spec));
  }
  const script = `
import { renderToString } from '@verajs/ssr/vera';
const out = {};
/** A case marked \`serverThrows\` is expected to fail; the message is the assertion. */
const attempt = async (name, url, options) => {
  try { out[name] = (await renderToString(url, options)).html; }
  catch (error) { out[name] = { threw: String(error.message) }; }
};
${Object.entries(ALL)
  .map(
    ([name, spec]) =>
      `await attempt(${JSON.stringify(name)}, ${JSON.stringify(`file://${files[name]}`)}, ${JSON.stringify({
        attributes: spec.attributes ?? {},
        children: spec.children ?? '',
      })});`
  )
  .join('\n')}
process.stdout.write(JSON.stringify(out));
`;
  server = JSON.parse(
    execFileSync(
      process.execPath,
      /**
       * The artifact under test is chosen by `--conditions`, so the child must inherit it — and the
       * flag arrives in either spelling, `--conditions=development` or `--conditions development`.
       */
      [
        ...process.execArgv.flatMap((argument, index) =>
          argument.startsWith('--conditions')
            ? argument.includes('=')
              ? [argument]
              : [argument, process.execArgv[index + 1]]
            : []
        ),
        '--input-type=module',
        '-e',
        script,
      ],
      { cwd: new URL('..', import.meta.url), encoding: 'utf8' }
    )
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

/* ── client ──────────────────────────────────────────────────────────────────────────────────── */
/**
 * A frame callback that throws is one of the cases, and reporting it is the *correct* client
 * behaviour — jsdom writes it to the virtual console, which would otherwise look like a failure in
 * a suite that passes. Forwarded nowhere; the assertion is what the DOM ends up as.
 */
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', () => {});
const dom = new JSDOM('<body></body>', { pretendToBeVisual: true, url: 'http://localhost/', virtualConsole });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'CustomEvent', 'Element'])
  globalThis[key] = key === 'window' ? dom.window : dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const core = await load('core');
const { render: renderTemplate } = await load('renderer');
core.setRenderer(renderTemplate);

/** Two frames plus a drained microtask queue: renders, layout effects and effects have all run. */
const settle = async () => {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => dom.window.requestAnimationFrame(() => resolve()));
  await Promise.resolve();
};

/** The host's own attributes, so a component that writes to itself is compared too. */
const hostLine = (element) =>
  [...element.attributes]
    .map((attribute) => `${attribute.name}=${JSON.stringify(attribute.value)}`)
    .sort()
    .join(' ');

const parseServer = (markup) => {
  const container = dom.window.document.createElement('div');
  container.innerHTML = markup;
  const host = container.firstElementChild;
  /** jsdom does not attach a declarative shadow root, so the template stands in for one. */
  const template = host.querySelector('template[shadowrootmode]');
  if (template) template.remove();
  return { host: hostLine(host), shadow: template ? canonical(template.content) : '', light: canonical(host) };
};

let pass = 0;
const failures = [];
for (const [name, spec] of Object.entries(ALL)) {
  const tag = tagOf(name);
  const element = dom.window.document.createElement(tag);
  for (const [attribute, value] of Object.entries(spec.attributes ?? {})) element.setAttribute(attribute, value);
  /** The parser has already built the light DOM by the time an element upgrades; so has the server. */
  if (spec.children) element.innerHTML = spec.children;

  const definition = new Function(
    'init',
    'render',
    'html',
    'createStore',
    'useEffect',
    'useLayoutEffect',
    'HTMLElement',
    'customElements',
    'document',
    `${spec.defines ?? ''}
    return class extends HTMLElement {
      ${spec.statics ?? ''}
      connectedCallback() {${spec.body}}
    };`
  )(
    core.init,
    core.render,
    core.html,
    core.createStore,
    core.useEffect,
    core.useLayoutEffect,
    dom.window.HTMLElement,
    dom.window.customElements,
    dom.window.document
  );
  dom.window.customElements.define(tag, definition);
  dom.window.document.body.appendChild(element);
  await settle();

  const root = element.shadowRoot ?? element._root;
  const fromClient = {
    host: hostLine(element),
    shadow: root ? canonical(root) : '',
    light: canonical(element),
  };
  const fromServer = spec.serverThrows ? null : parseServer(server[name]);

  if (spec.serverThrows) {
    const threw = server[name]?.threw;
    if (threw && spec.serverThrows.test(threw) && fromClient.shadow.includes('ran=yes')) pass++;
    else failures.push(`${name}\n      server: ${JSON.stringify(server[name])}\n      client: ${fromClient.shadow}`);
    continue;
  }

  const expected = KNOWN_DIVERGENCES[name]
    ? fromServer.shadow === spec.server && fromClient.shadow === spec.client
    : fromServer.shadow === fromClient.shadow &&
      fromServer.host === fromClient.host &&
      fromServer.light === fromClient.light;

  if (expected) pass++;
  else
    failures.push(
      `${name}\n      server host: ${fromServer.host}   light: ${fromServer.light}` +
        `\n      client host: ${fromClient.host}   light: ${fromClient.light}` +
        `\n      server: ${fromServer.shadow}\n      client: ${fromClient.shadow}`
    );
}

if (failures.length) {
  console.log(`\n  ${failures.length} component(s) behave differently on the two sides:\n`);
  for (const failure of failures) console.log('    ' + failure + '\n');
}
console.log(`lifecycle parity: ${pass}/${Object.keys(ALL).length} components identical on server and client`);
if (failures.length) process.exit(1);
