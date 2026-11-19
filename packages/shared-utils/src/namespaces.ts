/**
 * **Content in the wrong namespace does not render — DEVELOPMENT ONLY, said by two renderers** (2026-11-18):
 * `` html`<path/>` `` handed into an `<svg>` builds an HTML `<path>`, which draws nothing and says nothing.
 * `@verajs/renderer` and `@verajs/lite` both say it, so the decision and its words live here, once (the shared-emitter
 * rule, `diagnostics.ts`); each renderer passes its own area and the one sentence that differs between them (`retag`:
 * how else a template could get the right namespace). Every call site is behind `__DEV__`, so production drops it whole.
 *
 * The host is read from where the content LANDS, and a mismatch is named once per host and content (a toggled subtree
 * would otherwise warn every frame). Silent where HTML is correct — integration points (`<foreignObject>`, `<desc>`,
 * `<title>`, MathML's token elements, an HTML-encoded `<annotation-xml>`) and `<style>`/`<script>`, which never draw.
 */
import { hasWarned, warnOnce } from './diagnostic.js';
import * as SHARED from './diagnostics.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

/** The name of a foreign host where HTML does not render, or `null` (not SVG/MathML, or an integration point). */
const foreignHost = (parent: Node): string | null => {
  const element = parent as Element;
  const namespace = element.namespaceURI;
  const svg = namespace === SVG_NS;
  if (!svg && namespace !== MATHML_NS) return null;
  const name = element.localName;
  if (svg) return name === 'foreignObject' || name === 'desc' || name === 'title' ? null : name;
  if (name === 'mi' || name === 'mo' || name === 'mn' || name === 'ms' || name === 'mtext') return null;
  if (name === 'annotation-xml') {
    /** The ATTRIBUTE — what the parser reads; `image/svg+xml` is MathML's own spelling for an SVG annotation. */
    const encoding = element.getAttribute('encoding')?.toLowerCase();
    return encoding === 'text/html' || encoding === 'application/xhtml+xml' || encoding === 'image/svg+xml' ? null : name;
  }
  return name;
};

/** The nodes an insert is about to place — a fragment empties as it is inserted, so they are read first. */
export const landing = (node: Node): Node[] => (node.nodeType === 11 ? [...node.childNodes] : [node]);

/**
 * **Development: each element of `nodes`, placed in `parent`, that will not render there, named once.** `area` is the
 * emitter's label; `retag` is its sentence on another way to the right namespace, read only for HTML content, between
 * "needs the svg`…` or mathml`…` tag at the call site" and the advice for content that is genuinely HTML.
 */
export const checkForeign = (area: string, parent: Node, nodes: Node[], retag: string) => {
  const host = foreignHost(parent);
  if (host === null) return;
  const hostNamespace = (parent as Element).namespaceURI;
  for (const node of nodes) {
    if (node.nodeType !== 1) continue;
    const element = node as Element;
    if (element.namespaceURI === hostNamespace) continue;
    const tag = element.localName;
    if (tag === 'style' || tag === 'script') continue;
    /** The parser itself opens SVG content for an `<svg>` inside `<annotation-xml>`, whatever the encoding. */
    if (host === 'annotation-xml' && tag === 'svg' && element.namespaceURI === SVG_NS) continue;
    const built = element.namespaceURI === MATHML_NS ? 'MathML' : element.namespaceURI === SVG_NS ? 'SVG' : 'HTML';
    /** The island and its placement are chosen by the HOST's namespace; the encoding follows the CONTENT. */
    const island =
      hostNamespace === MATHML_NS
        ? `<mtext>, or <annotation-xml encoding="${built === 'SVG' ? 'image/svg+xml' : 'text/html'}">, ` +
          'inside a MathML container such as <mrow> or <math> rather than inside a token element'
        : 'a <foreignObject>, which has to sit in an element whose content model accepts one — a container such as ' +
          '<g> or <svg>, not a text, clipping, gradient or filter element';
    /** Keyed by host namespace AND content namespace: `<a>` is a real element in all three. */
    const seen = `${hostNamespace}${host}>${element.namespaceURI}${tag}`;
    /** `hasWarned` first: the advice below is built only for a case not yet said. */
    if (hasWarned('wrong-namespace', seen)) continue;
    const advice =
      built === 'HTML'
        ? `If it is meant to be an SVG or MathML element, the template holding it needs the svg\`…\` or mathml\`…\` tag ` +
          `at the call site${retag}. If it is ` +
          `genuinely HTML (a <div>, a custom element), it belongs in ${island}: tagging it will not help, and a custom ` +
          `element only upgrades in the HTML namespace.`
        : `The template's tag is already right — these two namespaces cannot nest directly. Put the ` +
          `${built === 'SVG' ? '<svg>' : '<math>'} root inside ${island}.`;
    warnOnce(area, `<${tag}>`, 'wrong-namespace', __DEV__ && (() => SHARED.wrongNamespace(tag, built, host, advice)), seen);
  }
};
