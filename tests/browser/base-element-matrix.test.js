import { expect } from '@esm-bundle/chai';

/**
 * **The `<base>` element facts the router's mount-point derivation stands on, pinned in real
 * engines.**
 *
 * `@verajs/router` derives where the app is mounted from the document's `<base>`, and the deriving
 * code was wrong three times in one day — every time the same bug through a different door: *the
 * base silently became the current page*. No `<base>` at all, then `<base target="_blank">`, then
 * `<base href="">` — each is a shape where `document.baseURI` quietly equals the document's own URL,
 * and a mount point derived from it grows the address bar by a segment per navigation while every
 * route still matches.
 *
 * `tests/router-base-path.test.mjs` holds the behavioural table under jsdom. This file is its
 * oracle: the rows there assume the platform answers these questions the way jsdom does, and
 * `CLAUDE.md` is explicit that jsdom is never the oracle for a rule the platform owns. Measured
 * 2026-09-04 in Chromium, Firefox and WebKit before the jsdom table was written; this keeps that
 * measurement true.
 *
 * **Every read here is synchronous while the `<base>` is installed.** A `<base>` re-points every
 * relative URL on the page, including whatever the test runner itself fetches — so each case
 * installs, reads, and removes with no await in between, and the `finally` guarantees no case can
 * leak its element into the harness.
 */

/** Install markup in <head>, read the three facts the router relies on, remove, return. */
const measure = (markup) => {
  const holder = document.createElement('template');
  holder.innerHTML = markup;
  const nodes = [...holder.content.childNodes];
  for (const node of nodes) document.head.appendChild(node);
  try {
    const element = document.querySelector('base[href]');
    const url = new URL(document.baseURI);
    return {
      matches: element !== null,
      href: element === null ? null : element.getAttribute('href'),
      baseIsSelf: document.baseURI === location.href,
      pathname: url.pathname,
      sameOrigin: url.origin === new URL(document.URL).origin,
    };
  } finally {
    for (const node of nodes) node.remove();
  }
};

it('CONTROL: with no <base>, baseURI is the document itself', () => {
  const fact = measure('');
  expect(fact.matches).to.equal(false);
  expect(fact.baseIsSelf, 'nothing installed, nothing moved').to.equal(true);
});

it('a <base> without an href contributes nothing', () => {
  const fact = measure('<base target="_blank">');
  expect(fact.matches, 'and base[href] correctly does not match it').to.equal(false);
  expect(fact.baseIsSelf).to.equal(true);
});

/**
 * The third door. It MATCHES `base[href]` — an element check alone says "a base exists" — while the
 * platform resolves an empty href to the document itself. This single row is why the router checks
 * the attribute's value and not just the element's presence.
 */
it('<base href=""> matches the selector AND resolves to the document itself', () => {
  const fact = measure('<base href="">');
  expect(fact.matches, 'the selector alone cannot tell this from a real base').to.equal(true);
  expect(fact.href).to.equal('');
  expect(fact.baseIsSelf, 'yet the platform treats it as no base at all').to.equal(true);
});

it('an absolute href is the base, trailing slash or not', () => {
  expect(measure('<base href="/mount/">').pathname).to.equal('/mount/');
  expect(measure('<base href="/mount">').pathname).to.equal('/mount');
});

it('a relative href resolves against the document directory', () => {
  const directory = location.pathname.slice(0, location.pathname.lastIndexOf('/') + 1);
  expect(measure('<base href="sub/">').pathname).to.equal(`${directory}sub/`);
});

it('a cross-origin href is detectable by origin, in both spellings', () => {
  for (const markup of ['<base href="https://other.test/x/">', '<base href="//other.test/x/">']) {
    const fact = measure(markup);
    expect(fact.sameOrigin, `${markup} must not read as a local mount point`).to.equal(false);
    expect(fact.pathname, 'because the pathname alone looks perfectly plausible').to.equal('/x/');
  }
});

it('the first <base> WITH an href wins, and querySelector agrees with the platform', () => {
  const skipped = measure('<base target="_top"><base href="/mount/">');
  expect(skipped.href, 'an href-less first element is passed over').to.equal('/mount/');
  expect(skipped.pathname).to.equal('/mount/');

  const two = measure('<base href="/first/"><base href="/second/">');
  expect(two.href, 'querySelector returns the first in tree order').to.equal('/first/');
  expect(two.pathname, 'and the platform used the same one').to.equal('/first/');
});
