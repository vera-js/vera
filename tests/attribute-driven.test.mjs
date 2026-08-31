/**
 * Components that take their input from an attribute, which is half of how a web component receives
 * anything at all.
 *
 * `lifecycle-parity` covers *when* `attributeChangedCallback` fires, server against client. It does
 * not ask what an app asks: does the component **update** when the attribute changes after setup? And
 * `attributeChangedCallback` appears nowhere in the core README, `llms.txt` or `docs/`, so the pattern
 * had neither a worked example nor a test of its effect.
 *
 * ## The upgrade-order trap
 *
 * `attributeChangedCallback` runs **before** `connectedCallback` for any attribute already in the
 * markup. The obvious implementation writes the new value into a store the template reads — and that
 * store is created in `connectedCallback`, so on upgrade it does not exist yet and the write throws.
 *
 * The component still renders, because the callback throwing does not stop the upgrade: the failure
 * is an uncaught `TypeError` in the console of every page using one. Hence the guard, and hence
 * `connectedCallback` reading the attribute itself for the initial value.
 *
 * This is the platform's ordering rather than anything this framework chose, which is exactly why it
 * needs writing down: nothing here can warn about it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'https://x.test/', pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame',
  'MutationObserver', 'ShadowRoot',
])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { renderer } = await load('renderer');
const { html } = await load('renderer/tag');
core.wire([renderer]);

const app = dom.window.document.getElementById('app');
const frame = () => new Promise((resolve) => setTimeout(resolve, 30));

/** The documented shape: guard the write, and read the initial value in `connectedCallback`. */
class Guarded extends dom.window.HTMLElement {
  static observedAttributes = ['label'];
  attributeChangedCallback(name, previous, value) {
    /** Setup has not run yet on upgrade, and `connectedCallback` reads the attribute itself. */
    if (!this.state) return;
    this.state.label = value;
  }
  connectedCallback() {
    core.init(this, { mode: 'open' });
    this.state = core.createStore({ label: this.getAttribute('label') });
    core.render(() => html`<p>${this.state.label}</p>`);
  }
}
dom.window.customElements.define('attr-guarded', Guarded);

test('an attribute in the markup reaches the first render', async () => {
  app.insertAdjacentHTML('beforeend', '<attr-guarded label="parsed"></attr-guarded>');
  await frame();
  const element = app.querySelector('attr-guarded');
  assert.equal(element.shadowRoot?.textContent.trim(), 'parsed', 'the upgrade path read it');
});

test('and changing it afterwards re-renders', async () => {
  const element = app.querySelector('attr-guarded');
  element.setAttribute('label', 'changed');
  await frame();
  assert.equal(element.shadowRoot?.textContent.trim(), 'changed');

  element.removeAttribute('label');
  await frame();
  assert.equal(element.shadowRoot?.textContent.trim(), '', 'removal renders the null');
});

/**
 * The trap, pinned so the documented guard cannot quietly stop being necessary. If the platform's
 * ordering ever changed, or setup moved, this fails and the README needs revisiting.
 */
test('the unguarded version throws on upgrade, which is why the guard is documented', () => {
  class Unguarded extends dom.window.HTMLElement {
    static observedAttributes = ['label'];
    attributeChangedCallback(name, previous, value) {
      this.state.label = value;
    }
    connectedCallback() {
      core.init(this, { mode: 'open' });
      this.state = core.createStore({ label: this.getAttribute('label') });
      core.render(() => html`<p>${this.state.label}</p>`);
    }
  }
  dom.window.customElements.define('attr-unguarded', Unguarded);

  /**
   * Created but never connected, so setup has not run — exactly the state an upgrade is in.
   *
   * The callback is invoked directly rather than through `setAttribute`, because a custom-element
   * reaction that throws is **reported, not rethrown**: the platform swallows it on the way out, so
   * `setAttribute` returns normally and the element is left in a half-set state. That is what makes
   * this quiet rather than loud, and it is the argument for documenting the guard — nothing in the
   * calling code can catch it, and nothing in this framework can warn about it.
   */
  const element = dom.window.document.createElement('attr-unguarded');
  assert.throws(
    () => element.attributeChangedCallback('label', null, 'boom'),
    /Cannot set propert/,
    'the store the callback writes to does not exist yet'
  );

  /** And through `setAttribute` it is silent, which is the half that costs someone an afternoon. */
  assert.doesNotThrow(() => element.setAttribute('label', 'boom'), 'the platform reports it instead');
});

test('and the guarded one is unbothered in that same state', () => {
  const element = dom.window.document.createElement('attr-guarded');
  assert.doesNotThrow(() => element.setAttribute('label', 'fine'));
  assert.equal(element.getAttribute('label'), 'fine', 'the attribute is still set');
});
