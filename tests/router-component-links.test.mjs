/**
 * **A routed link inside a child COMPONENT — and the two modes disagree, because the platform
 * disagrees.** The router listens for clicks and reads the event's target. A link inside a child's
 * SHADOW root is retargeted to the host before the listener sees it, so the router cannot know a
 * link was clicked at all; that limitation is real and documented. A LIGHT child has no shadow root
 * and nothing is retargeted, so the same link is an ordinary element in the same tree and the
 * router handles it exactly as it handles its own.
 *
 * Worth pinning in both directions. The shadow half is a limitation people must be able to rely on
 * being described accurately; the light half is a capability that would be easy to break by
 * accident, silently, since nothing else exercises router-inside-a-component.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><body><div id="shell"><main view="main"></main></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
for (const key of [
  'HTMLElement', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'CSSStyleSheet',
  'customElements', 'Event', 'CustomEvent', 'MouseEvent', 'PopStateEvent', 'MutationObserver',
]) {
  globalThis[key] = dom.window[key];
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.history = dom.window.history;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
dom.window.scrollTo = () => {};

const { wire, html, init, render } = await load('core');
const { renderer } = await load('renderer');
const { initRouter, navigate, router: routerModule } = await load('router');
/** The ROUTER module too, not just the renderer — it registers how a route's result is rendered. */
wire([renderer, routerModule]);

const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 5));
};

/** The SAME component, defined twice — the only difference is the shadow root. */
for (const [tag, options] of [
  ['link-shadow', { mode: 'open' }],
  ['link-light', undefined],
]) {
  customElements.define(
    tag,
    class extends dom.window.HTMLElement {
      connectedCallback() {
        init(this, options);
        render(() => html`<nav><a route href="/other">go</a></nav>`);
      }
    }
  );
}

const shell = dom.window.document.getElementById('shell');
const view = shell.querySelector('main');
const router = initRouter(shell, { view: 'main', focusView: false });
router.addRoutes([
  { path: '/', component: () => html`<h1>home</h1><link-shadow></link-shadow><link-light></link-light>` },
  { path: '/other', component: () => html`<h1>OTHER</h1>` },
]);

const clickTheLinkIn = async (tag) => {
  await navigate('/');
  await settle();
  const host = shell.querySelector(tag);
  assert.ok(host, `CONTROL: <${tag}> is on the home route`);
  const link = (host.shadowRoot ?? host).querySelector('a[route]');
  assert.ok(link, `CONTROL: <${tag}> rendered its link`);
  link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, composed: true, cancelable: true, button: 0 }));
  await settle();
  return { path: dom.window.location.pathname, text: shell.textContent };
};

test('a routed link inside a LIGHT child component is handled by the router', async () => {
  const after = await clickTheLinkIn('link-light');
  assert.equal(after.path, '/other', 'the router intercepted a link it does not own');
  assert.match(after.text, /OTHER/, 'and rendered the route');
});

test('a routed link inside a child SHADOW root is invisible to the router, as documented', async () => {
  const after = await clickTheLinkIn('link-shadow');
  assert.equal(after.path, '/', 'retargeting hides the link, so the router never sees one');
  assert.match(after.text, /home/, 'and the view is unchanged');
});
