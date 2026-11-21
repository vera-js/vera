/**
 * **What an adopted node answers, in a real engine** (2026-11-21): the platform fact the structural tests in router,
 * motion, styles and anchor rest on. An element and a shadow root made by a same-origin iframe's document and adopted
 * into the top document are in the top document, yet keep the iframe window's prototype, so `instanceof` the top
 * window's class is false. Their node type, namespace, name and a root's `host` answer as a native node's do, so
 * those are the tests that hold across realms. Booleans only (a cross-realm value can hang chai's printer).
 */
import { expect } from '@esm-bundle/chai';

const frameDocument = async () => {
  const iframe = document.createElement('iframe');
  document.body.append(iframe);
  const doc = iframe.contentDocument;
  doc.open();
  doc.write('<!doctype html><body></body>');
  doc.close();
  return { iframe, doc, view: iframe.contentWindow };
};

describe('an element made in an iframe and adopted into the top document', () => {
  it('is in the top document, and is not an instance of the top window\'s classes', async () => {
    const { iframe, doc, view } = await frameDocument();
    const element = document.adoptNode(doc.createElement('div'));
    document.body.append(element);
    expect(element.ownerDocument === document, 'CONTROL: adopted into the top document').to.equal(true);
    expect(element instanceof view.HTMLElement, "CONTROL: it is an instance of the iframe's class").to.equal(true);
    expect(element instanceof HTMLElement, "instanceof the top window's HTMLElement").to.equal(false);
    element.remove();
    iframe.remove();
  });

  it('answers node type, namespace and name as a native element does', async () => {
    const { iframe, doc } = await frameDocument();
    const element = document.adoptNode(doc.createElement('canvas'));
    const native = document.createElement('canvas');
    expect(element.nodeType === native.nodeType && element.nodeType === 1, 'node type 1').to.equal(true);
    expect(element.namespaceURI === native.namespaceURI && element.namespaceURI === 'http://www.w3.org/1999/xhtml', 'the HTML namespace').to.equal(true);
    expect(element.localName === 'canvas', 'its name').to.equal(true);
    iframe.remove();
  });

  it("its shadow root is a root by node type and 'host', not by the top window's ShadowRoot", async () => {
    const { iframe, doc, view } = await frameDocument();
    const host = doc.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    const inner = doc.createElement('span');
    root.append(inner);
    document.body.append(document.adoptNode(host));
    const found = inner.getRootNode();
    expect(found === root, 'CONTROL: the span is still in that root').to.equal(true);
    expect(root.ownerDocument === document, 'CONTROL: the root moved with its host').to.equal(true);
    expect(root instanceof view.ShadowRoot, "CONTROL: an instance of the iframe's ShadowRoot").to.equal(true);
    expect(root instanceof ShadowRoot, "instanceof the top window's ShadowRoot").to.equal(false);
    expect(found.nodeType === 11 && 'host' in found && found.host === host, "node type 11 with 'host'").to.equal(true);
    host.remove();
    iframe.remove();
  });
});
