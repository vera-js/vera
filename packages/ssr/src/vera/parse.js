/**
 * A conservative HTML fragment parser, for giving markup a node view.
 *
 * **This exists to answer `querySelector`, not to render.** Markup assigned as a string used to have
 * no nodes at all, so `children` was empty and every query answered `null` while the content sat
 * plainly in the output. Parsing it is what closes that.
 *
 * Three rules shape everything here:
 *
 * 1. **Never change what the page renders.** Each element keeps the exact source text of its own
 *    tags, so re-serialising a parsed tree reproduces the input byte for byte — quoting style,
 *    entity spelling, attribute order and interior whitespace included. Only an element somebody
 *    *mutates* falls back to canonical output, which is the same rule the rest of this DOM follows.
 *    The caller re-serialises and compares anyway (`nodes.js`), so a defect here costs a declined
 *    parse rather than a corrupted page.
 * 2. **Decline rather than guess.** Anything needing the HTML spec's error recovery — misnested
 *    formatting, foster parenting, foreign content — returns `null` and the markup stays a string.
 *    A wrong tree is far worse than no tree: it would answer a query confidently and be wrong.
 * 3. **Never disagree with a real parser.** `tests/ssr-parse-differential.test.mjs` runs a corpus
 *    through both this and parse5 and fails on any input where the two produce *different* trees.
 *    Declining is allowed; disagreeing is not. parse5 is a devDependency and stays one — it is the
 *    oracle, never a runtime dependency.
 */
import { RAW_TEXT_ELEMENTS, VOID_ELEMENTS } from './escaping.js';

/** The entity spellings this package emits, plus the handful every document uses. */
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const ENTITY = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g;

const decode = (text) =>
  text.includes('&')
    ? text.replace(ENTITY, (match, decimal, hex, name) =>
        decimal
          ? String.fromCodePoint(Number(decimal))
          : hex
            ? String.fromCodePoint(parseInt(hex, 16))
            : (NAMED[name] ?? match)
      )
    : text;

/**
 * **Implied end tags.** A start tag in the value set closes an open element of the key's name — the
 * rule that makes `<li>a<li>b` two siblings rather than a nest. This is the part of the spec that
 * well-formed markup actually depends on; everything past it is error recovery.
 */
const CLOSED_BY = {
  li: new Set(['li']),
  dt: new Set(['dt', 'dd']),
  dd: new Set(['dt', 'dd']),
  option: new Set(['option', 'optgroup']),
  optgroup: new Set(['optgroup']),
  td: new Set(['td', 'th']),
  th: new Set(['td', 'th']),
  tr: new Set(['tr', 'td', 'th']),
  thead: new Set(['tbody', 'tfoot']),
  tbody: new Set(['tbody', 'tfoot']),
  tfoot: new Set(['tbody']),
  rt: new Set(['rt', 'rp']),
  rp: new Set(['rt', 'rp']),
};

/**
 * Elements whose end tag the spec makes optional, so finding one still open at the end of a fragment
 * is well-formed markup rather than error recovery. `<ul><li>a<li>b</ul>` and a trailing `<p>text`
 * are both ordinary hand-written HTML and both end with something open.
 */
const OPTIONAL_END_TAG = new Set([
  'p', 'li', 'dt', 'dd', 'option', 'optgroup', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'rt', 'rp',
]);

/** A `<p>` is closed by any of these opening, which is the one implied-end rule with a long list. */
const CLOSES_P = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figcaption',
  'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'main',
  'menu', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul',
]);

/**
 * Elements whose content this parser will not model. `svg` and `math` switch the spec into foreign
 * content, where self-closing means something different and names are case-sensitive; `template`
 * holds a separate document fragment. Each is a decline rather than a guess.
 */
const REFUSED = new Set(['svg', 'math', 'template']);

const TAG_NAME = /^[a-zA-Z][^\s/>]*/;
const ATTRIBUTE = /^([^\s/>="'<]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/;

/**
 * Parse a fragment into entries — elements and raw text.
 *
 * @param {string} markup
 * @param {(name: string) => any} makeElement builds a bare element; the caller owns node identity
 * @returns {Array<any> | null} entries, or `null` when the markup needs more than this will guess at
 */
export const parseFragment = (markup, makeElement) => {
  if (typeof markup !== 'string' || markup === '') return null;

  const root = { children: /** @type {Array<any>} */ ([]), localName: '#root' };
  /** @type {Array<any>} */
  const stack = [root];
  const open = () => stack[stack.length - 1];
  let index = 0;
  let text = '';

  /** Text is kept verbatim, so it needs no escaping on the way back out. */
  const flushText = () => {
    if (text !== '') open().children.push(text);
    text = '';
  };

  while (index < markup.length) {
    const next = markup.indexOf('<', index);
    if (next === -1) {
      text += markup.slice(index);
      break;
    }
    text += markup.slice(index, next);

    /** A comment or a doctype is content this DOM has no node for; keep the bytes and move on. */
    if (markup.startsWith('<!--', next)) {
      const end = markup.indexOf('-->', next + 4);
      if (end === -1) return null;
      text += markup.slice(next, end + 3);
      index = end + 3;
      continue;
    }
    if (markup.startsWith('<!', next)) {
      const end = markup.indexOf('>', next);
      if (end === -1) return null;
      text += markup.slice(next, end + 1);
      index = end + 1;
      continue;
    }

    /* ── an end tag ──────────────────────────────────────────────────────────────────────────── */
    if (markup.startsWith('</', next)) {
      const end = markup.indexOf('>', next);
      if (end === -1) return null;
      const name = markup.slice(next + 2, end).trim().toLowerCase();
      if (!name) return null;
      flushText();
      /** Close through anything the spec would have closed implicitly; anything else is recovery. */
      let depth = stack.length - 1;
      while (depth > 0 && stack[depth].localName !== name) {
        if (!CLOSED_BY[stack[depth].localName] && stack[depth].localName !== 'p') return null;
        depth--;
      }
      if (depth === 0) return null;
      stack[depth].closeTag = markup.slice(next, end + 1);
      stack.length = depth;
      index = end + 1;
      continue;
    }

    /* ── a start tag ─────────────────────────────────────────────────────────────────────────── */
    const nameMatch = TAG_NAME.exec(markup.slice(next + 1));
    if (!nameMatch) {
      /** A bare `<` that is not a tag is text in the spec, and text is all it can be here. */
      text += '<';
      index = next + 1;
      continue;
    }
    const name = nameMatch[0].toLowerCase();
    if (REFUSED.has(name)) return null;

    let cursor = next + 1 + nameMatch[0].length;
    /** @type {Array<[string, string]>} */
    const attributes = [];
    for (;;) {
      const rest = markup.slice(cursor);
      const space = /^\s+/.exec(rest);
      if (space) {
        cursor += space[0].length;
        continue;
      }
      if (markup.startsWith('/>', cursor) || markup[cursor] === '>') break;
      const attribute = ATTRIBUTE.exec(markup.slice(cursor));
      if (!attribute || cursor >= markup.length) return null;
      const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? '';
      attributes.push([attribute[1].toLowerCase(), decode(value)]);
      cursor += attribute[0].length;
    }
    const selfClosing = markup.startsWith('/>', cursor);
    const end = markup.indexOf('>', cursor);
    if (end === -1) return null;
    const openTag = markup.slice(next, end + 1);

    flushText();
    /** The implied end tags, before this element joins the stack. */
    for (;;) {
      const current = open().localName;
      const closes = CLOSED_BY[name]?.has(current) || (current === 'p' && CLOSES_P.has(name));
      if (!closes || stack.length === 1) break;
      stack.pop();
    }

    /**
     * **A row directly inside `<table>` is declined.** The spec inserts an implied `<tbody>` there,
     * and this parser cannot both reproduce the input byte for byte (which forbids inventing that
     * tag) and agree with a real parser about the tree (which requires it). Markup that writes the
     * section itself parses normally, so the common explicit form is unaffected.
     */
    if ((name === 'tr' || name === 'td' || name === 'th') && open().localName === 'table') return null;

    const element = makeElement(name);
    for (const [attributeName, value] of attributes) element.setAttribute(attributeName, value);
    element._sourceOpenTag = openTag;
    /**
     * **`''` means "no end tag in the source", which is different from "not parsed".** `<li>a<li>b`
     * closes the first item implicitly and writing `</li>` back would add bytes the input never had
     * — the round-trip would fail and this whole parse would be discarded for markup that is
     * perfectly ordinary. An element built by `createElement` has no source close tag at all and
     * still gets the canonical one.
     */
    const node = { element, children: /** @type {Array<any>} */ ([]), localName: name, closeTag: '' };
    open().children.push(node);
    index = end + 1;

    /** A void element never has children and never has an end tag. */
    if (VOID_ELEMENTS.has(name)) continue;
    /**
     * `<div/>` is **not** self-closing in HTML — the slash is ignored and the element stays open.
     * Treating it as closed is a common and quiet way to build the wrong tree, so it declines.
     */
    if (selfClosing) return null;

    /** Raw text runs to its own end tag and is never parsed as markup. */
    if (RAW_TEXT_ELEMENTS.has(name)) {
      const close = markup.toLowerCase().indexOf(`</${name}`, index);
      if (close === -1) return null;
      const closeEnd = markup.indexOf('>', close);
      if (closeEnd === -1) return null;
      const content = markup.slice(index, close);
      if (content !== '') node.children.push(content);
      node.closeTag = markup.slice(close, closeEnd + 1);
      index = closeEnd + 1;
      continue;
    }
    stack.push(node);
  }
  flushText();
  /**
   * What is still open at the end is fine if the spec would have closed it implicitly, and is error
   * recovery otherwise — an unclosed `<div>` is a mistake this parser will not guess about.
   */
  while (stack.length > 1 && OPTIONAL_END_TAG.has(open().localName)) stack.pop();
  if (stack.length !== 1) return null;

  /** Build the real nodes now that the shape is known to be sound. */
  const build = (node) => {
    for (const child of node.children) {
      if (typeof child === 'string') node.element._entries.push(child);
      else {
        build(child);
        /**
         * Pushed rather than appended: `appendChild` marks an unrendered registered component so
         * the scan can find that instance, which would write a marker attribute into markup this
         * parse must reproduce exactly — and would enrol a node nobody is going to render.
         */
        node.element._entries.push(child.element);
        child.element._parent = node.element;
      }
    }
    node.element._sourceCloseTag = node.closeTag;
    return node.element;
  };
  return root.children.map((child) => (typeof child === 'string' ? child : build(child)));
};
