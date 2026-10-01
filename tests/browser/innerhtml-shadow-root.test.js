/**
 * **Served trusted markup cannot attach a declarative shadow root — in the engines that implement one.**
 *
 * `@verajs/ssr` serves a `.innerHTML` binding's markup as an `innerHTML` ASSIGNMENT would behave, and an assignment
 * never attaches a shadow root from `<template shadowrootmode>`, while a page parse does. So the server renames the
 * attribute (`tests/server-content.test.mjs` pins the exact served string). jsdom implements no declarative shadow DOM,
 * so it can only check the string; whether the renamed form is truly inert is the PLATFORM's decision, made here by
 * the document parser of every engine — with the un-renamed form as the control that must attach, so a silence means
 * something.
 */
import { expect } from '@esm-bundle/chai';

/** Parses `body` as a whole document, the way a served page is parsed, and answers the `#host` element in it. */
const parsed = (body) =>
  new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.srcdoc = `<!doctype html><body>${body}</body>`;
    iframe.addEventListener('load', () => resolve([iframe, iframe.contentDocument.getElementById('host')]), { once: true });
    document.body.append(iframe);
  });

it('the control: an un-renamed template, parsed as a page, does attach a shadow root', async () => {
  const [iframe, host] = await parsed('<div id="host"><template shadowrootmode="open"><b>s</b></template></div>');
  /** Booleans, not the nodes: chai inspects a cross-realm ShadowRoot for a failure message and never finishes. */
  expect(host.shadowRoot !== null, 'this engine implements declarative shadow DOM, so the row below can fail').to.equal(true);
  iframe.remove();
});

it('the served forms attach none — every spelling the server renames', async () => {
  const served = [
    '<template data-vera-shadowrootmode="open"><b>s</b></template>',
    '<template data-vera-shadowrootMODE="open"><b>s</b></template>',
    '<template\ndata-vera-shadowrootmode="open"><b>s</b></template>',
    '<template data-vera-shadowroot="open"><b>s</b></template>',
  ];
  for (const markup of served) {
    const [iframe, host] = await parsed(`<div id="host">${markup}</div>`);
    expect(host.shadowRoot === null, markup).to.equal(true);
    expect(host.querySelector('template') !== null, `${markup}: an ordinary inert template, as the assignment leaves`).to.equal(true);
    iframe.remove();
  }
});
