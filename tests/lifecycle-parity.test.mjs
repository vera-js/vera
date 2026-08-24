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
import { JSDOM } from 'jsdom';
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

const ALL = { ...CASES, ...KNOWN_DIVERGENCES };
const IMPORTS = `import { init, render, html, createStore, useEffect, useLayoutEffect } from '@verajs/core';`;
const source = (name, spec) => `${IMPORTS}
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
${Object.entries(ALL)
  .map(
    ([name, spec]) =>
      `out[${JSON.stringify(name)}] = (await renderToString(${JSON.stringify(`file://${files[name]}`)}, ${JSON.stringify(
        { attributes: spec.attributes ?? {} }
      )})).html;`
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
const dom = new JSDOM('<body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
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
  return { host: hostLine(host), shadow: template ? canonical(template.content) : canonical(host) };
};

let pass = 0;
const failures = [];
for (const [name, spec] of Object.entries(ALL)) {
  const tag = tagOf(name);
  const element = dom.window.document.createElement(tag);
  for (const [attribute, value] of Object.entries(spec.attributes ?? {})) element.setAttribute(attribute, value);

  const definition = new Function(
    'init',
    'render',
    'html',
    'createStore',
    'useEffect',
    'useLayoutEffect',
    'HTMLElement',
    `return class extends HTMLElement {
      ${spec.statics ?? ''}
      connectedCallback() {${spec.body}}
    };`
  )(core.init, core.render, core.html, core.createStore, core.useEffect, core.useLayoutEffect, dom.window.HTMLElement);
  dom.window.customElements.define(tag, definition);
  dom.window.document.body.appendChild(element);
  await settle();

  const root = element.shadowRoot ?? element._root;
  const fromClient = { host: hostLine(element), shadow: root ? canonical(root) : canonical(element) };
  const fromServer = parseServer(server[name]);

  const expected = KNOWN_DIVERGENCES[name]
    ? fromServer.shadow === spec.server && fromClient.shadow === spec.client
    : fromServer.shadow === fromClient.shadow && fromServer.host === fromClient.host;

  if (expected) pass++;
  else
    failures.push(
      `${name}\n      server host: ${fromServer.host}\n      client host: ${fromClient.host}` +
        `\n      server: ${fromServer.shadow}\n      client: ${fromClient.shadow}`
    );
}

if (failures.length) {
  console.log(`\n  ${failures.length} component(s) behave differently on the two sides:\n`);
  for (const failure of failures) console.log('    ' + failure + '\n');
}
console.log(`lifecycle parity: ${pass}/${Object.keys(ALL).length} components identical on server and client`);
if (failures.length) process.exit(1);
