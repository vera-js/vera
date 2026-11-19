/**
 * **The server's DOM applies HTML's name-keyed rules only to HTML elements** (2026-11-18). Raw text and RCDATA (`style`,
 * `script`, `title`, `textarea`…), void serialization (`link`, `img`, `br`…) and the leading-newline rule (`pre`,
 * `textarea`, `listing`) are HTML's: an SVG or MathML element of the same name is an ordinary element, whose text is
 * escaped as text and whose children and end tag are kept. The shim used to key them on `localName` alone, so an SVG
 * `<style>`'s text was written with raw-text escaping, and a value in it broke out of the element in the browser (found
 * by a security row in the lite svg work; it predated it).
 *
 * Audited by DIFFERENTIAL, never by reading (CLAUDE.md): each name, in the SVG and the MathML namespace, built the same
 * way in this DOM and in jsdom, and the answers compared — the serialized markup as a real parser reads it back, the
 * children `innerHTML` makes, and what `innerHTML` reads. The HTML element of each name is the positive control: it
 * still takes the raw-text or void path, or the rows would be measuring nothing.
 */
import '@verajs/ssr';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const SVG = 'http://www.w3.org/2000/svg';
const MATHML = 'http://www.w3.org/1998/Math/MathML';
const HTML = 'http://www.w3.org/1999/xhtml';
const shim = globalThis.document;
const real = new JSDOM('<!doctype html><body></body>').window.document;

const RAW = ['style', 'script', 'title', 'textarea', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext'];
const VOID = ['link', 'meta', 'source', 'img', 'br', 'input', 'area', 'base', 'col', 'embed', 'hr', 'param', 'track', 'wbr'];
const NEWLINE = ['pre', 'listing'];
const NAMES = [...RAW, ...VOID, ...NEWLINE, 'template', 'select', 'option'];
const SPACES = [[SVG, 'svg'], [MATHML, 'math']];

/** Every node under `root`, in order: type, namespace, name, sorted attributes, text. */
const signature = (root) => {
  const rows = [];
  const walk = (node) => {
    for (const child of node.childNodes)
      if (child.nodeType === 1) {
        rows.push(`${child.namespaceURI} ${child.localName} [${[...child.attributes].map((a) => `${a.name}=${a.value}`).sort().join(' ')}]`);
        walk(child);
      } else rows.push(`${child.nodeType}:${child.data}`);
  };
  walk(root);
  return rows;
};
const reparsed = (markup) => new JSDOM(`<!doctype html><body>${markup}</body>`).window.document.body;
const payload = (name) => `\n</${name}><img src=x onerror=1>`;

/** The element in `space`, given `payload`'s text and then a child, inside its root, serialized by `doc`'s DOM. */
const served = (doc, namespace, rootName, name) => {
  const host = doc.createElement('div');
  const root = doc.createElementNS(namespace, rootName);
  const element = doc.createElementNS(namespace, name);
  element.textContent = payload(name);
  element.appendChild(doc.createElementNS(namespace, 'g'));
  root.appendChild(element);
  host.appendChild(root);
  return host.innerHTML;
};
const inject = (body) => [...body.querySelectorAll('*')].some((element) => element.hasAttribute('onerror'));

for (const [namespace, rootName] of SPACES)
  for (const name of NAMES) {
    test(`${rootName} ${name}: served text is escaped as text and its child and end tag kept — read back as jsdom's is, nothing injected`, () => {
      const ours = reparsed(served(shim, namespace, rootName, name));
      const theirs = reparsed(served(real, namespace, rootName, name));
      assert.ok(signature(theirs).length > 2, 'CONTROL: jsdom served the element and its child');
      assert.equal(inject(ours), false, 'no element carries the payload\'s handler');
      assert.deepEqual(signature(ours), signature(theirs));
    });
    /** A text NODE appended (`createTextNode`), the path a renderer's text write takes: serialized by the text's own rule. */
    test(`${rootName} ${name}: an appended text node is escaped as text — read back as jsdom's is, nothing injected`, () => {
      const [ours, theirs] = [shim, real].map((doc) => {
        const host = doc.createElement('div');
        const root = doc.createElementNS(namespace, rootName);
        const element = doc.createElementNS(namespace, name);
        element.appendChild(doc.createTextNode(payload(name)));
        root.appendChild(element);
        host.appendChild(root);
        return reparsed(host.innerHTML);
      });
      assert.equal(inject(ours), false, 'no element carries the payload\'s handler');
      assert.deepEqual(signature(ours), signature(theirs));
    });
    test(`${rootName} ${name}: innerHTML makes children and reads them back as jsdom does`, () => {
      const [ours, theirs] = [shim, real].map((doc) => {
        const element = doc.createElementNS(namespace, name);
        element.innerHTML = '<g>x</g>';
        return element;
      });
      assert.deepEqual(signature(ours), signature(theirs), 'the children innerHTML made');
      assert.ok(signature(theirs).some((row) => row.includes(' g ')), 'CONTROL: jsdom made a <g>');
      assert.equal(ours.innerHTML, theirs.innerHTML, 'what innerHTML reads');
    });
  }

/**
 * The positive controls: the HTML element of each name still takes HTML's path in this DOM — the six raw-text names this
 * DOM knows (`escaping.ts`'s `RAW_TEXT_ELEMENTS`, measured on three engines).
 */
const HTML_RAW = ['style', 'script', 'textarea', 'title', 'iframe', 'noscript'];
for (const name of HTML_RAW)
  test(`html ${name}: still raw text — innerHTML makes ONE text node, and nothing injects`, () => {
    const element = shim.createElement(name);
    element.innerHTML = '<g>x</g>';
    assert.equal(element.childNodes.length, 1);
    assert.equal(element.childNodes[0].nodeType, 3, 'a text node, not a <g>');
    const host = shim.createElement('div');
    const served = shim.createElement(name);
    served.textContent = payload(name);
    host.appendChild(served);
    assert.equal(inject(reparsed(host.innerHTML)), false);
  });
for (const name of VOID)
  test(`html ${name}: still void — serialized with no end tag and no children`, () => {
    const element = shim.createElement(name);
    element.appendChild(shim.createElement('b'));
    const host = shim.createElement('div');
    host.appendChild(element);
    assert.equal(element.innerHTML, '');
    assert.doesNotMatch(host.innerHTML, new RegExp(`</${name}>|<b>`));
  });

test('the audit covers every name in both foreign namespaces, and its HTML controls', () => {
  assert.equal(NAMES.length, RAW.length + VOID.length + NEWLINE.length + 3);
  assert.equal(SPACES.length, 2);
  assert.ok(RAW.length >= 10 && VOID.length >= 14);
  assert.equal(shim.createElementNS(SVG, 'style').namespaceURI, SVG, 'CONTROL: the shim builds an SVG element');
  assert.equal(shim.createElement('style').namespaceURI, HTML);
});

/**
 * **Pinned, a separate finding (2026-11-18): the four OBSOLETE raw-text names are not raw text to this DOM even in HTML.**
 * `xmp`, `noembed`, `noframes` and `plaintext` are raw text in every engine (and core's own server tokenizer knows them),
 * but `RAW_TEXT_ELEMENTS` lacks them, so `innerHTML` builds elements inside one. Not an injection path — their text is
 * escaped as ordinary text, which over-escapes — but a tree no browser builds. This row goes red when the set gains them.
 */
test('html xmp, noembed, noframes, plaintext: NOT raw text to this DOM today (a separate finding, pinned)', () => {
  for (const name of ['xmp', 'noembed', 'noframes', 'plaintext']) {
    const element = shim.createElement(name);
    element.innerHTML = '<g>x</g>';
    assert.equal(element.childNodes[0]?.nodeType, 1, `${name}: an element child, where a browser makes text`);
    const host = shim.createElement('div');
    const served = shim.createElement(name);
    served.textContent = payload(name);
    host.appendChild(served);
    assert.equal(inject(reparsed(host.innerHTML)), false, `${name}: still nothing injects`);
  }
});
