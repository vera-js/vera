/**
 * **The svg/mathml corpus, one source per row, shared by every side that renders it** (2026-11-18): lite and core in
 * jsdom (`tests/lite-namespaces.test.mjs`), and lite on the server against lite in jsdom (`tests/lite-ssr.test.mjs`,
 * whose client side is `lite-namespaces-client.mjs`, a child process). Each source reads the host's `v` prop, so an
 * update is a prop write. Each covers one thing: a nested `svg` template, a list of them, `mathml`, the breakout, the
 * text-only elements (`<title>`, `<style>`) in SVG, an HTML integration point, SVG's case-adjusted attribute names,
 * sigils, MathML's annotations.
 */
/** Every element under `root`, in document order: its namespace, tag and attributes (sorted), then the root's text. */
export const signature = (root) => {
  const rows = [];
  const walk = (node) => {
    for (const child of node.childNodes)
      if (child.nodeType === 1) {
        const attributes = [...child.attributes].map((a) => `${a.name}=${a.value}`).sort().join(' ');
        rows.push(`${child.namespaceURI} ${child.localName} [${attributes}]`);
        walk(child);
      }
  };
  walk(root);
  return { rows, text: root.textContent };
};

export const SOURCES = {
  'svg inside an svg element': ({ html, svg }) => (host) => () => html`<svg viewBox="0 0 10 10">${svg`<circle r=${host.v} cx="5"/>`}</svg>`,
  'a list of svg templates': ({ html, svg }) => (host) => () => html`<svg>${[1, 2, 3].map((i) => svg`<rect x="${i}${host.v}" width=${host.v}/>`)}</svg>`,
  'mathml inside a math element': ({ html, mathml }) => (host) => () => html`<math>${mathml`<mi>${host.v}</mi><mo>+</mo><mn>1</mn>`}</math>`,
  'a top-level svg fragment': ({ svg }) => (host) => () => svg`<g fill=${host.v}><path d="M0 0"/></g>`,
  'html breaking out of svg content': ({ html, svg }) => (host) => () => html`<section>${svg`<g></g><div>${host.v}</div><circle/>`}</section>`,
  'svg title and style hold text': ({ html, svg }) => (host) => () => html`<svg>${svg`<title>t ${host.v}</title><style>.a{fill:${host.v}}</style><circle class="a"/>`}</svg>`,
  'html inside foreignObject': ({ html, svg }) => (host) => () => html`<svg>${svg`<foreignObject><p class=${host.v}>${host.v}</p></foreignObject>`}</svg>`,
  'case-adjusted svg attribute names': ({ html, svg }) => (host) => () =>
    html`<svg>${svg`<linearGradient gradientUnits=${host.v} spreadMethod="pad"/><circle ?hidden=${host.v === 'b'}/>`}</svg>`,
  'mathml annotation-xml holding html': ({ html, mathml }) => (host) => () =>
    html`<math>${mathml`<semantics><mi>x</mi><annotation-xml encoding="text/html"><p>${host.v}</p></annotation-xml></semantics>`}</math>`,
  'svg nested in mathml': ({ html, mathml }) => (host) => () => html`<math>${mathml`<mrow><annotation-xml encoding="image/svg+xml"><svg><circle r=${host.v}/></svg></annotation-xml></mrow>`}</math>`,
};


