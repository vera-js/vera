import { expect } from '@esm-bundle/chai';
import { wire, init, html} from '../../packages/core/dist/development/vera.js';
import { renderInto as renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import { adoptStyles } from '../../packages/styles/dist/development/vera-styles.js';

/**
 * **Generalized:** every shadow mode `init` accepts must behave the same way — content in the root,
 * styles adopted into it, nothing leaking to the light DOM.
 *
 * Written as a matrix rather than a test for one bug, because the bug was structural: `init` called
 * `attachShadow` and discarded what it returned, and everything downstream read
 * `element.shadowRoot` — which is `null` for a closed root, by definition. So `mode: 'closed'`
 * rendered into the **light DOM**, never adopted its styles, and left an unreachable empty root.
 * Any future mode, or any new consumer that reaches for the root, is covered by adding a row here.
 *
 * Only a browser can answer it: jsdom's `attachShadow` and `adoptedStyleSheets` are emulated.
 */

wire({ on: 'render', fn: renderer, priority: 50 });
wire({ on: 'init', fn: adoptStyles, priority: 50 });

const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

const MODES = [
  { name: 'open', props: { mode: 'open' }, reachable: true },
  { name: 'closed', props: { mode: 'closed' }, reachable: false },
];

for (const { name, props, reachable } of MODES) {
  const tag = `shadow-${name}-el`;
  let root;

  customElements.define(
    tag,
    class extends HTMLElement {
      static styles = `.marker { color: rgb(1, 2, 3) }`;
      connectedCallback() {
        init({ host: this, shadow: props ?? false }, () => {
          /** The element's own view of its root, which is the only handle a closed mode has. */
          root = this._$r$ ?? this.shadowRoot;
          return () => html`<p class="marker">content</p>`;
        });
      }
    }
  );

  it(`mode: '${name}' renders into the shadow root, not the light DOM`, async () => {
    const element = document.createElement(tag);
    document.body.appendChild(element);
    await frame();
    await frame();

    expect(element.shadowRoot, `shadowRoot is ${reachable ? 'reachable' : 'null'} for ${name}`)
      .to.equal(reachable ? element.shadowRoot : null);
    expect(root, 'the component can reach its own root').to.not.equal(null);
    expect(root.querySelector('p')?.textContent, 'content is inside the root').to.equal('content');
    expect(element.innerHTML, 'nothing leaked into the light DOM').to.equal('');
    element.remove();
  });

  it(`mode: '${name}' adopts its styles into the shadow root`, async () => {
    const element = document.createElement(tag);
    document.body.appendChild(element);
    await frame();
    await frame();

    const adopted = root.adoptedStyleSheets?.length > 0 || root.querySelector('style[data-vm-sheet="styles"]');
    expect(adopted, 'styles reached the root').to.be.ok;
    /** And they apply — the point of adopting them. */
    expect(getComputedStyle(root.querySelector('.marker')).color).to.equal('rgb(1, 2, 3)');
    element.remove();
  });
}

it('light DOM (no shadow props) still renders into the element', async () => {
  customElements.define(
    'shadow-none-el',
    class extends HTMLElement {
      connectedCallback() {
        init(this, () => {
          return () => html`<p>light</p>`;
        });
      }
    }
  );
  const element = document.createElement('shadow-none-el');
  document.body.appendChild(element);
  await frame();
  await frame();
  expect(element.shadowRoot).to.equal(null);
  expect(element._$r$, 'no root is created for light DOM').to.equal(undefined);
  expect(element.querySelector('p')?.textContent).to.equal('light');
  element.remove();
});


/* ── shadow-root options must survive server rendering ───────────────────────────────────────── */
/**
 * **Generalized:** every option declarative shadow DOM can express has to reach the markup, because
 * the client cannot repair it. `attachShadow` reuses a declarative root and **ignores the options it
 * is handed** — measured — so a component asking for `delegatesFocus: true` over markup that omitted
 * it keeps `false` for the life of the page. Focus delegation is accessibility behavior: it does
 * not break, it just works worse, silently.
 *
 * A row per option, so a new one is covered by adding to the list rather than by remembering.
 */
const { SHADOW_OPTIONS_HTML } = await import('./fixtures/hello-ssr.html.js');

it('shadow-root options survive the server round trip', async () => {
  const host = document.createElement('div');
  host.setHTMLUnsafe(SHADOW_OPTIONS_HTML);
  document.body.appendChild(host);
  const element = host.querySelector('shadow-options-ssr');

  /** Read before any component upgrades: this is what the *parser* built from the markup. */
  expect(element.shadowRoot, 'the markup produced a shadow root').to.not.equal(null);
  for (const [option, attribute] of [
    ['delegatesFocus', 'shadowrootdelegatesfocus'],
    ['clonable', 'shadowrootclonable'],
    ['serializable', 'shadowrootserializable'],
  ]) {
    expect(element.shadowRoot[option], `${option} was lost — is ${attribute} in the markup?`).to.equal(true);
  }
  host.remove();
});

it('a client-created root and a server-rendered one agree on their options', async () => {
  customElements.define(
    'options-parity-el',
    class extends HTMLElement {
      connectedCallback() {
        init({ host: this, shadow: { mode: 'open', delegatesFocus: true, clonable: true, serializable: true } }, () => {
          return () => html`<input />`;
        });
      }
    }
  );
  const client = document.createElement('options-parity-el');
  document.body.appendChild(client);
  await frame();
  await frame();

  const host = document.createElement('div');
  host.setHTMLUnsafe(SHADOW_OPTIONS_HTML);
  document.body.appendChild(host);
  const server = host.querySelector('shadow-options-ssr');

  for (const option of ['mode', 'delegatesFocus', 'clonable', 'serializable']) {
    expect(server.shadowRoot[option], `${option} differs between the two paths`)
      .to.equal(client.shadowRoot[option]);
  }
  client.remove();
  host.remove();
});

/**
 * **A root opened with `slotAssignment: 'manual'` arrives as one** (2026-11-23). `attachShadow` hands back a declarative
 * root as it was parsed and ignores the options it is given, so only the served markup can make the root manual: served
 * without `shadowrootslotassignment="manual"`, the root slotted by name and `slot.assign()` did nothing. The server's
 * real markup, parsed by this engine; the named root is the control, and the shape the manual one was served as before.
 */
const { MANUAL_SLOTS_HTML, NAMED_SLOTS_HTML } = await import('./fixtures/hello-ssr.html.js');
/** Parses the served markup, gives the host two children, attaches as a component does and assigns the second. */
const assignSecond = (markup, tag) => {
  const holder = document.createElement('div');
  holder.setHTMLUnsafe(markup);
  document.body.appendChild(holder);
  const host = holder.querySelector(tag);
  host.append(document.createElement('i'), document.createElement('b'));
  const served = host.shadowRoot;
  const root = host.attachShadow({ mode: 'open', slotAssignment: 'manual' });
  /** Reusing a declarative root empties it (DOM: attach a shadow root), so the component writes its slot again. */
  root.innerHTML = '<slot></slot>';
  const slot = root.querySelector('slot');
  slot.assign(host.lastElementChild);
  const read = { reused: served !== null && root === served, assignment: root.slotAssignment, slotted: slot.assignedNodes().map((node) => node.localName) };
  holder.remove();
  return read;
};

it("a manual root is served as one: the client's assign() decides what is slotted", () => {
  const manual = assignSecond(MANUAL_SLOTS_HTML, 'manual-slots-ssr');
  expect(manual.reused, 'CONTROL: attachShadow handed back the served root').to.equal(true);
  expect(manual.assignment).to.equal('manual');
  expect(manual.slotted.join()).to.equal('b', 'only the assigned child is slotted');
  /** CONTROL: a root served without the attribute slots by name, whatever attachShadow is asked for. */
  const named = assignSecond(NAMED_SLOTS_HTML, 'named-slots-ssr');
  expect(named.reused).to.equal(true);
  expect(named.assignment).to.equal('named');
  expect(named.slotted.join()).to.equal('i,b', 'assign() did nothing: every child is slotted by name');
});
