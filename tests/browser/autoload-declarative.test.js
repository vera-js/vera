/**
 * The autoloader reaching **through declarative shadow DOM** — the server-rendered case.
 *
 * A server-rendered page's components live inside `<template shadowrootmode>`, parsed into shadow
 * roots before any script runs. Nothing renders them, so the `'render'` insert never offers them
 * up, and a `MutationObserver` cannot cross into a shadow root it is not watching. `autoload()`
 * with no argument is the documented answer: it scans the page for `[autoloader]` hosts, and a
 * server-rendered host is one.
 *
 * That claim is the difference between a server-rendered page loading its lazy components and
 * silently not, and nothing had checked it.
 */
import { expect } from '@esm-bundle/chai';
import { autoloader } from '../../packages/autoloader/dist/development/vera-autoloader.js';

const until = async (predicate, what, timeout = 8000) => {
  const started = performance.now();
  for (;;) {
    let value;
    try {
      value = predicate();
    } catch {
      value = false;
    }
    if (value) return value;
    if (performance.now() - started > timeout) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};

const BASE = new URL('/tests/browser/fixtures/autoloader/entry.js', location.href).href;

/** Server markup: a marked host whose shadow root already holds an undefined element. */
const serverPage = (tag) =>
  `<div autoloader><template shadowrootmode="open"><section><${tag}></${tag}></section></template></div>`;

describe('a server-rendered page finds its lazy components', () => {
  it('autoload() reaches into a declarative shadow root', async () => {
    const host = document.createElement('div');
    host.setHTMLUnsafe(serverPage('declarative-widget'));
    document.body.appendChild(host);

    const marked = host.firstElementChild;
    expect(marked.shadowRoot, 'declarative shadow DOM did not parse').to.exist;
    expect(
      marked.shadowRoot.querySelector('declarative-widget'),
      'the undefined element is not in the shadow root'
    ).to.exist;

    const autoload = autoloader(BASE, 'components');
    /** No argument: scan the page for marked hosts, which is what a server-rendered page needs. */
    autoload();

    await until(
      () => customElements.get('declarative-widget'),
      'the component inside the declarative shadow root to load'
    );
    await until(
      () => marked.shadowRoot.querySelector('declarative-widget').shadowRoot,
      'it to upgrade over the server markup'
    );
  });

  it('and reports one that cannot be found, from inside the shadow root', async () => {
    const host = document.createElement('div');
    host.setHTMLUnsafe(serverPage('declarative-absent'));
    document.body.appendChild(host);

    const failures = [];
    /** The event is composed, so it crosses the shadow boundary to a listener on the host. */
    host.addEventListener('vera:autoload-error', (event) => failures.push(event.detail.tag));

    const autoload = autoloader(BASE, 'components');
    autoload();

    const tag = await until(() => failures[0], 'the failure to be reported across the boundary');
    expect(tag).to.equal('declarative-absent');
  });

  it('a host marked after the page loaded is still found', async () => {
    const host = document.createElement('div');
    /** Unmarked at first: exactly the case where an app decides lazily that a section is a host. */
    host.setHTMLUnsafe(
      `<div><template shadowrootmode="open"><late-widget></late-widget></template></div>`
    );
    document.body.appendChild(host);
    const marked = host.firstElementChild;

    const autoload = autoloader(BASE, 'components');
    autoload();
    /** Nothing should have happened yet — the host is not marked. */
    expect(customElements.get('late-widget'), 'an unmarked host was scanned').to.equal(undefined);

    marked.setAttribute('autoloader', '');
    autoload();
    await until(() => customElements.get('late-widget'), 'the newly marked host to be scanned');
  });
});
