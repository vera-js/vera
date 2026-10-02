/**
 * @verajs/renderer — a template-identity renderer.
 *
 * A tagged template's `strings` array is interned per call site, so it keys a parsed `<template>`.
 * An instance clones it and binds the expression positions; every later render of the same shape
 * commits only the values that changed. Lists reconcile by index here, by key through
 * `@verajs/renderer/keyed`.
 *
 * Contracts the speed pays for:
 * - The renderer owns its container below the mount point: a part that owns a whole parent clears it
 *   with one `textContent = ''`.
 * - Do not `normalize()` rendered content — child anchors are text nodes.
 * - A string renders as text, never as markup. There is no `innerHTML` sink.
 *
 * Internal members are `_`-prefixed because the production build mangles `/^_[a-z]/`. `$`-named
 * members cross bundle boundaries (keyed, spread, slots) and survive mangling by not matching it.
 */

import {
  adoptProperty,
  call,
  CONTENT_PROPERTY,
  contentClash,
  ownsContent,
  TAG_NAME_HOLE,
  tagHole,
  INLINE_HANDLER,
  isSelection,
  read,
  reportUncaught,
  SCRIPT_URL,
  SCRIPT_URL_ITEM,
  URL_SINK,
} from '@verajs/shared-utils';
import { attributeValueComplaint, eventNameComplaint } from './dev-values.js';
import type { Untracked } from '@verajs/shared-utils';

import type { InstanceHook, TemplateResult } from './types.js';

export type { TemplateResult } from './types.js';

/**
 * The marker the one parse per template writes into each hole — into an attribute name (`0\uFFFF`), a bogus
 * comment (`<?\uFFFF0>`) and raw text (`\uFFFF0\uFFFF`). U+FFFF is a Unicode noncharacter: real text never contains
 * it, so an author's statics cannot collide with it, and the HTML preprocessor keeps it (a parse error, never a
 * rewrite) — in every engine, `tests/browser/template-marker.test.js`. Data never reaches the parsed string at all:
 * values are committed through the DOM, and the one path that builds strings at runtime (`tag`) refuses any name
 * outside `[a-zA-Z0-9._-]`. Fixed rather than random, so the parse is deterministic.
 */
const MARKER = '\uFFFF';
/** Every marker as a nested `<template>` serializes it: an addressed attribute, a child comment, a raw-text pair. */
const INERT_MARKERS = / \d+\uFFFF(?:="[^"]*")?|<!--\?\uFFFF\d+-->|\uFFFF\d+\uFFFF/g;

const doc = document;
const comment = () => doc.createComment('');

/**
 * The scanner — one regex per state, each finding the next thing that matters (lit-html's design). It
 * decides only what each expression position IS; the browser's parser builds the tree. Every marker
 * carries its binding's index, so pairing is ADDRESSED: an element the parser drops takes only its own
 * binding with it and never shifts a later value onto another element (a security property —
 * `tests/dropped-element-bindings.test.mjs`).
 */
/** `<!-->` and `<!--->` are not opened at all: they close themselves (the tokenizer's abrupt close), so they stay text. */
const TEXT_END = /<(?:(!--(?!-?>)|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g;
/**
 * A comment ends at `-->` or `--!>` — read as a comment past either, a value after one was dropped while the browser
 * rendered it. The abrupt `<!-->`/`<!--->` never open one (`TEXT_END`'s lookahead; a lookBEHIND would not even parse
 * in an older Safari).
 */
const COMMENT_END = /--!?>/g;
const COMMENT2_END = />/g;
/** `>`, or whitespace then an attribute name (with `=` and the start of its value), or the string's end. */
const TAG_END = />|[ \t\n\f\r](?:([^\s"'>=/]+)([ \t\n\f\r]*=[ \t\n\f\r]*(?:[^ \t\n\f\r"'`<>=]|("|')|))|$)/g;
const DOUBLE_QUOTE_END = /"/g;


/**
 * **An expression inside an attribute NAME is refused in development** (`<p data-${k}="1">`, `<b ${name}="x">`,
 * `<p ${k}-x>`): the parser sees the marker before the value exists, so no position can hold it, and the server
 * refuses the same template in every build. Development only, by Brian's call (2026-09-30): a template is fixed
 * source, so its first render in development finds it, and production pays nothing (the check cost 101 B). A name known only at runtime is a one-key spread, which applies the
 * refusals a runtime name needs (handlers, `srcdoc`, URL values); development shows the rewrite. A hole is in a name
 * when, inside a tag and outside a value, a name character touches it on either side — never a ref (whitespace or
 * `>`/`/>` around it) and never the TAG name (`<${tag}>`, the tag entry's).
 */
/** A name character ends the static, after a space or quote since the tag's `<` — so never a TAG-name hole (`<my-${x}`). */
const NAME_BEFORE = /[\s"'][^\s<>]*[^\s"'>=/<]$/;
const NAME_AFTER = /^(?:[^\s"'>=/]|[ \t\n\f\r]*=)/;
const nameHole = (before: string, after: string): never => {
  const prefix = /[^\s"'>=/]*$/.exec(before)![0];
  const suffix = /^[^\s"'>=/]*/.exec(after)![0];
  const value = /^[ \t\n\f\r]*=[ \t\n\f\r]*(?:"([^"]*)("?)|'([^']*)('?)|([^\s>]*))/.exec(after.slice(suffix.length));
  /** The value as spread takes it: a closed static is that string, an open one (or none written) is a binding. */
  const given =
    value === null ? "''" : value[2] === '"' ? JSON.stringify(value[1]) : value[4] === "'" ? JSON.stringify(value[3]) : value[5] ? JSON.stringify(value[5]) : '…';
  throw new Error(
    `renderer: an attribute name cannot be an expression — \`${prefix}\${…}${suffix}\` is read by the parser before any ` +
      `value exists. A name known only at runtime is a spread: \`\${spread({ [\`${prefix}\${…}${suffix}\`]: ${given} })}\` ` +
      `(from @verajs/renderer/spread).`
  );
};
const SINGLE_QUOTE_END = /'/g;
/**
 * Elements whose content the parser reads as TEXT, so a comment marker cannot live there: the scan
 * writes a text marker and construction turns it into an anchor. `noscript` because Firefox parses it
 * as raw text in a template while Chromium and WebKit do not — listed, it is right in both.
 */
const RAW_TEXT_TAGS = /^(?:script|style|textarea|title|iframe|noscript)$/i;
/**
 * The 14 void elements — a start tag with no content and no end tag. Read only by the development tag-shape pass
 * (`<div />` is an open tag; `</br>` is another `<br>`), so production drops it. A regex rather than shared-utils'
 * Set, as `RAW_TEXT_TAGS` is: an imported `new Set` measured 62 B in production.
 */
const VOID_TAGS = /^(?:area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr|param)$/i;

/** A binding's kind, resolved once per template. */
const IGNORED = 0; // consumed, nothing rendered: inside a comment, the later values of a multi-part attribute
const CHILD = 1; // anchored on a primed empty text node the template carries
const SOLE = 2; // its element's only content: no anchor in the template, the first commit writes `textContent`
const ATTR = 3;
const PROPERTY = 4;
const BOOLEAN = 5;
/** `EVENT` through `ADOPT` hold a `Slot` record in their node slot — one range test, in `instantiate` and `commit`. */
const EVENT = 6;
/** An element-position expression: a ref, or a value that applies itself (`_$apply$`). */
const REF = 7;
/** An element-position expression ON a `<select>`: a value applying itself there (a spread) waits for `flush`. */
const SELECT_REF = 8;
/** `.name` on a custom element — see `adoptProperty` in shared-utils. */
const ADOPT = 9;
/**
 * Kinds from here on re-assert on EVERY render, so the update loop never skips them as unchanged:
 * `!name` writes from the live DOM's point of view (a sibling radio's click unchecks this one with no
 * event on it), and a `<select>`'s selection is re-applied after its options exist — see `flush`.
 */
const LIVE = 10;
/** A `<select>`'s selection — `value` or `selectedIndex` (`isSelection`) — written when the pass ends: see `flush`. */
const SELECT = 11;
/** `!name` on a custom element: compared against the LIVE value — read through `untracked`, it is the component's getter. */
const LIVE_CUSTOM = 12;
/** A binding that must never write — and, from here on, the kinds `commit` handles before anything is computed. */
const REFUSED = 13;
/** A `<select>`'s `selectedIndex` — the rare spelling of its selection, queued as `SELECT` is (see `flush`). */
const SELECT_INDEX = 14;

/** A binding slot's value before its first commit — never equal to a user value. */
const UNSET = {};
/** The value slot of a child binding whose node slot holds a `ChildPart`. */
const UPGRADED = {};

/**
 * A template's bindings are indexed by VALUE position: a multi-part attribute sits at its first value
 * and the positions of its other values are `IGNORED`, so the commit loop needs no bookkeeping.
 */
/**
 * **Tag-shape mistakes, development only** — a self-closed non-void element (`<div />` is an OPEN tag: what follows
 * becomes its child) and an end tag on a void one (`</br>` is ANOTHER `<br>`), in HTML content only (`<svg>`/`<math>`
 * keep self-closing). A separate pass over ALL the statics, the last one too — the production scan never reads it,
 * and a template with no expressions is never scanned — and it only READS: a development-only counter once changed
 * the SCAN, so development and production parsed one template differently.
 */
const SHAPE = /<!--(?:-?>|[\s\S]*?(?:--!?>|$))|<(\/?)([a-zA-Z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
/** The obsolete elements a parser reads as text whole, which the scanner does not list (production pays nothing for them). */
const OBSOLETE_RAW = /^(?:xmp|noembed|noframes|plaintext)$/i;
const tagShape = (strings: TemplateStringsArray, type: number): string[] | undefined => {
  const markup = strings.join('');
  /** Where each binding sits in `markup`, so a refusal can ask whether one falls inside an element's content. */
  const holes: number[] = [];
  for (let i = 0, at = 0; i < strings.length - 1; i++) holes.push((at += strings[i].length));
  const bound = (from: number, to: number) => holes.some((at) => at >= from && at <= to);
  let foreign = type === 1 ? 0 : 1;
  let found: string[] | undefined;
  SHAPE.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = SHAPE.exec(markup)) !== null; ) {
    if (m[2] === undefined) continue;
    const tag = m[2].toLowerCase();
    const closing = m[1] === '/';
    const selfClosed = !closing && m[3].trimEnd().endsWith('/');
    if (tag === 'svg' || tag === 'math') {
      if (closing) foreign--;
      else if (!selfClosed) foreign++;
      continue;
    }
    if (!closing && (RAW_TEXT_TAGS.test(tag) || OBSOLETE_RAW.test(tag))) {
      const end = markup.toLowerCase().indexOf(`</${tag}`, SHAPE.lastIndex);
      const stop = end === -1 ? markup.length : end;
      /**
       * Two shapes that silently lose a binding, refused. Inside `<svg>`/`<math>` a `<title>` or `<style>` is a
       * foreign element whose content the browser reads as MARKUP, while the renderer reads it as raw text and
       * rebuilds that text around its bindings — destroying any element inside it. And the obsolete raw-text
       * elements are text to the parser whole, which the scanner does not know, so a binding there never renders.
       */
      if (foreign > 0 && RAW_TEXT_TAGS.test(tag) && bound(SHAPE.lastIndex, stop) && /<[a-zA-Z]/.test(markup.slice(SHAPE.lastIndex, stop)))
        throw new Error(
          `renderer: a binding inside <${tag}> in SVG or MathML cannot sit beside an element there — the renderer reads ` +
            `<${tag}> as text and rebuilds it around its bindings, which destroys the elements in it. Bind text ` +
            `directly in the <${tag}> (no elements), or move the element out of it.`
        );
      if (foreign === 0 && OBSOLETE_RAW.test(tag) && bound(SHAPE.lastIndex, stop))
        throw new Error(
          `renderer: a binding inside <${tag}> is never rendered — the parser reads its content as text whole, and ` +
            `<${tag}> is obsolete. Use <pre> for preformatted text.`
        );
      SHAPE.lastIndex = stop;
    }
    if (foreign > 0) continue;
    if (selfClosed && !VOID_TAGS.test(tag))
      (found ??= []).push(
        `<${tag}> is left OPEN by this template, so everything after it becomes its child rather than its sibling. HTML ` +
          `has no self-closing syntax outside <svg> and <math> — \`<${tag} />\` is an open tag, not an empty element. ` +
          `Write \`<${tag}></${tag}>\`. (@verajs/jsx rewrites this for you; a hand-written template has to say it.)`
      );
    else if (closing && VOID_TAGS.test(tag))
      (found ??= []).push(
        `\`</${tag}>\` is read by the parser as ANOTHER <${tag}>, so this template renders two where it describes one. A ` +
          `void element has no end tag — write \`<${tag}>\` alone.`
      );
  }
  return found;
};
/**
 * Said at the template's FIRST instance, not at construction: `namespaces` constructs an HTML build of a template it
 * then only ever instantiates in SVG, and that build's shape is not a mistake anyone wrote.
 */
/**
 * **A `<slot>` rendered into LIGHT DOM that nothing will distribute** — slots not wired, or wired after this template
 * was built. Said once per host tag and case; a shadow root is never warned about, the platform slots there.
 */
const warnedSlotless = /* @__PURE__ */ new Set<string>();
const saySlotless = () => {
  const host = renderRoot;
  if (host === null || host.nodeType !== 1) return;
  const tag = (host as Element).localName;
  const late = (registry as { _$done$?: unknown } | null)?._$done$ !== undefined;
  if (warnedSlotless.has(tag + late)) return;
  warnedSlotless.add(tag + late);
  if (late)
    console.warn(
      `[vera] renderer: <${tag}> renders a \`<slot>\` into LIGHT DOM from a template built before @verajs/renderer/slots ` +
        `was wired — slots was wired after this template first rendered, so it stays slotless. Wire it BEFORE anything ` +
        `renders: wire([renderer, slots]).`
    );
  else
    console.warn(
      `[vera] renderer: <${tag}> renders a \`<slot>\` into LIGHT DOM, but @verajs/renderer/slots is not wired, so ` +
        `nothing is distributed. Wire it BEFORE anything renders: wire([renderer, slots]).`
    );
};
export const sayShape = (template: Template) => {
  const shape = template._shape;
  if (shape !== undefined) {
    template._shape = undefined;
    for (let i = 0; i < shape.length; i++) console.warn(`[vera] renderer: ${shape[i]}`);
  }
};

class Template {
  /** What an instance clones: the single root element, or the whole content fragment. */
  $R: Node;
  /** No element in it can be custom — see `instantiate`. */
  _plain = true;
  $K: number[];
  $N: string[];
  /** The statics around a bound attribute's values; `null` for one full-value expression. */
  _statics: (string[] | null)[];
  /** Child-index hops from `$R` to each binding's node. */
  $P: number[][] = [];
  /** The template statically writes the attribute too, so a first nullish commit must still remove it. */
  _present: boolean[];
  /**
   * Per binding, whether it names a URL a browser navigates to (a `javascript:` value is refused, see `SCRIPT_URL`):
   * 0 not one; 1 converted once, and that string checked and written; 2 a custom element's property — strings only.
   */
  _urls: number[];
  /**
   * **An extension marked this template** (`'template'` insert): namespaces' resolver, an instance hook. False for
   * every template of an app that wires none — ONE read per instance created, never a per-row cost otherwise.
   */
  $X = false;
  /** Namespaces' resolver: which template to build at a position, given its parent. */
  declare _$at$?: (parent: Node) => Template;
  /** The namespace this template was parsed in, for a resolver asked about a detached fragment. */
  declare _$ns$?: string | null;
  /** The instance hook — elements (and slots): claim at creation, mount at the render's end, unmount at teardown. */
  declare _$inst$?: InstanceHook;
  /** Development only: tag-shape mistakes found at construction, said at the template's FIRST instance (`sayShape`). */
  declare _shape?: string[];
  /**
   * Development only: element positions on an element a SOLE binding owns — see `ownsContent`. Marked per instance in
   * `instantiate`; hydration needs no mark, because the server's output carries the content or its empty anchor.
   */
  declare _owned?: number[];
  /** Development only: the template holds a `<slot>` and was built while light-DOM slots was not wired (`saySlotless`). */
  declare _slotless?: boolean;

  constructor(result: TemplateResult) {
    const strings = result.strings;
    const count = strings.length - 1;
    const kinds = (this.$K = new Array(count).fill(IGNORED));
    const names = (this.$N = new Array(count).fill(''));
    const statics = (this._statics = new Array(count).fill(null));
    const present = (this._present = new Array(count).fill(false));
    const urls = (this._urls = new Array(count).fill(0));
    const nodes: (Node | null)[] = new Array(count).fill(null);
    /**
     * Development bookkeeping for a binding whose marker never arrives: the tag it was written in, whether it is an
     * element position (a ref has no name), and which bindings sat in a nested `<template>`'s inert content — so a
     * DROPPED element is told apart from inert markup. Read only; production never builds them.
     */
    let tags: string[] | undefined;
    let refs: boolean[] | undefined;
    let inert: Set<number> | undefined;
    if (__DEV__) {
      tags = [];
      refs = [];
      inert = new Set();
      this._shape = tagShape(strings, result._$litType$ ?? 1);
    }

    // ── scan ──
    let markup = '';
    let regex = TEXT_END;
    let rawEnd: RegExp | undefined;
    /** The previous binding opened an UNQUOTED value, so a string that matches nothing continues it (`a=${x}${y}`). */
    let open: boolean = false;
    /** Development also scans the LAST static, so a template that ends inside a tag is refused (below); production does not. */
    for (let i = 0; __DEV__ ? i <= count : i < count; i++) {
      const s = strings[i];
      if (__DEV__ && i > 0) tags![i] = tags![i - 1];
      /** Where this string's bound attribute name ends (≥ 0), -1 for none, -2 for an element position. */
      let nameEnd = -1;
      let continues: boolean = open;
      let name = '';
      let at = 0;
      let match: RegExpExecArray | null;
      while (at < s.length) {
        regex.lastIndex = at;
        if ((match = regex.exec(s)) === null) break;
        at = regex.lastIndex;
        if (regex === TEXT_END) {
          if (match[1] === '!--') regex = COMMENT_END;
          else if (match[1] !== undefined) regex = COMMENT2_END;
          else {
            if (match[2] !== undefined && RAW_TEXT_TAGS.test(match[2])) rawEnd = new RegExp(`</${match[2]}`, 'gi');
            if (__DEV__) tags![i] = match[2] ?? '';
            regex = TAG_END;
          }
        } else if (regex === TAG_END) {
          continues = false;
          if (match[0] === '>') {
            regex = rawEnd ?? TEXT_END;
            nameEnd = -1;
          } else if (match[1] === undefined) nameEnd = -2;
          else {
            name = match[1];
            nameEnd = at - match[2].length;
            regex = match[3] === undefined ? TAG_END : match[3] === '"' ? DOUBLE_QUOTE_END : SINGLE_QUOTE_END;
          }
        } else if (regex === DOUBLE_QUOTE_END || regex === SINGLE_QUOTE_END) {
          regex = TAG_END;
          /** A value that closes with nothing after it before the expression: the expression is an element position. */
          nameEnd = -2;
        } else if (regex === COMMENT_END || regex === COMMENT2_END) regex = TEXT_END;
        else {
          regex = TAG_END;
          rawEnd = undefined;
        }
      }
      /**
       * A template that ends INSIDE a tag (`<b title="${x}`) renders nothing of it: the parser drops an unfinished tag
       * whole. Refused, as the server refuses it in every build — there, left open, the tag swallowed the markup after
       * the template into its attributes.
       */
      if (__DEV__ && i === count) {
        if (regex !== TEXT_END && regex !== rawEnd && regex !== COMMENT_END && regex !== COMMENT2_END)
          throw new Error('renderer: a template cannot end inside a tag — the parser drops an unfinished tag. Close the tag inside the template.');
        break;
      }
      if (regex === TEXT_END) {
        markup += `${s}<?${MARKER}${i}>`;
        kinds[i] = CHILD;
      } else if (regex === rawEnd) {
        markup += `${s}${MARKER}${i}${MARKER}`;
        kinds[i] = CHILD;
      } else if (regex === COMMENT_END || regex === COMMENT2_END) markup += s;
      else if (nameEnd >= 0) {
        /** The attribute is renamed to its binding's address; the value keeps its statics, split by the marker. */
        names[i] = name;
        markup += `${s.slice(0, nameEnd - name.length)}${i}${MARKER}${s.slice(nameEnd)}${MARKER}`;
        /** An unquoted value followed by `/>` would absorb the slash. */
        if (regex === TAG_END && strings[i + 1].startsWith('/>')) markup += ' ';
      } else if (nameEnd === -2) {
        if (__DEV__ && NAME_AFTER.test(strings[i + 1])) nameHole(s, strings[i + 1]);
        if (__DEV__) refs![i] = true;
        markup += `${s} ${i}${MARKER}`;
      }
      else if (continues || regex !== TAG_END) markup += s + MARKER; // another value of the attribute a previous binding opened
      /**
       * A tag-name position (`<${x}>`, `</${x}>`, `<my-${x}>` — no whitespace since the `<`): refused in development.
       * Production keeps no marker, consumes the value and stays aligned.
       */
      else {
        if (__DEV__ && TAG_NAME_HOLE.test(s)) tagHole('renderer');
        /** Nothing before it at all (`${ref}${n}="x"`): only what follows can say it is a name. */
        if (__DEV__ && (NAME_BEFORE.test(s) || (s === '' && NAME_AFTER.test(strings[i + 1])))) nameHole(s, strings[i + 1]);
        markup += s;
      }
      open = regex === TAG_END && (nameEnd >= 0 || continues);
    }
    markup += strings[count];

    // ── parse, then one walk ──
    const type = result._$litType$ ?? 1;
    const element = doc.createElement('template');
    /** svg/mathml fragments only parse inside their root: wrap, then unwrap. */
    element.innerHTML = type === 2 ? `<svg>${markup}</svg>` : type === 3 ? `<math>${markup}</math>` : markup;
    const content = element.content;
    /**
     * Unwrapped by removing the wrapper and keeping EVERYTHING the parser made: an HTML element in foreign content
     * (`<div>` inside `<svg>`) breaks out, and the parser places it AFTER the wrapper — keeping only the wrapper's
     * children dropped it, and everything it held, silently.
     */
    if (type !== 1) (content.firstChild as Element).replaceWith(...content.firstChild!.childNodes);
    const walker = doc.createTreeWalker(content, 129 /* ELEMENT | COMMENT */);
    let node: Node | null;
    while ((node = walker.nextNode()) !== null) {
      if (node.nodeType === 8) {
        const data = (node as Comment).data;
        if (!data.startsWith('?' + MARKER)) continue;
        const anchor = doc.createTextNode('');
        (node as Comment).replaceWith(anchor);
        walker.currentNode = anchor;
        nodes[+data.slice(MARKER.length + 1)] = anchor;
        continue;
      }
      const el = node as Element;
      /**
       * A nested `<template>`'s content is inert markup the walk never enters, so its bindings can never be
       * reached — they are ignored, as the server ignores them. Their markers are scrubbed from its markup,
       * every depth at once, or they would sit in the live page.
       */
      if (el.localName === 'template') {
        const held = (el as HTMLTemplateElement).innerHTML;
        if (__DEV__) for (const m of held.matchAll(/(\d+)\uFFFF|\uFFFF(\d+)/g)) inert!.add(+(m[1] ?? m[2]));
        (el as HTMLTemplateElement).innerHTML = held.replace(INERT_MARKERS, '');
      }
      if (el.localName.includes('-') || el.hasAttribute('is')) this._plain = false;
      for (const attribute of el.getAttributeNames()) {
        if (!attribute.endsWith(MARKER)) continue;
        const i = parseInt(attribute, 10);
        const value = el.getAttribute(attribute)!.split(MARKER);
        el.removeAttribute(attribute);
        nodes[i] = el;
        const written = names[i];
        const first = written[0];
        /** An element position (`<p ${ref}>`) arrives with no value; `&=${ref}` is its explicit spelling. */
        if (value.length === 1 || first === '&') {
          /** Decided here, once: `localName` is a DOM accessor, too dear to read on every commit. */
          kinds[i] = el.localName === 'select' ? SELECT_REF : REF;
          continue;
        }
        let kind =
          first === '.' ? PROPERTY : first === '?' ? BOOLEAN : first === '@' ? EVENT : first === '!' ? LIVE : ATTR;
        /** The parser lowercases attribute names; the scan kept the author's case (`.someProp`). */
        let real = kind === ATTR ? written : written.slice(1);
        /** React muscle memory, buildless: `onClick=${fn}` is `@click`. Strictly `on` + a capital — `onclick` stays an attribute. */
        if (kind === ATTR && /^on[A-Z]/.test(written)) {
          kind = EVENT;
          real = written.slice(2).toLowerCase();
        }
        /**
         * A `<select>`'s selection is re-asserted every render and compared against the LIVE value (as `!value` is):
         * its options can be replaced under an unchanged value, which drops the selection. It is written when the
         * pass ends, once its options exist — see `flush`.
         */
        if ((kind === PROPERTY || kind === LIVE) && isSelection(el, real)) kind = real === 'value' ? SELECT : SELECT_INDEX;
        /**
         * `el.__proto__ = v` is not a property write: it replaces the element's prototype and destroys it.
         * No use is legitimate, so the binding is refused — the deliberate twin of spread's `refusedSink`
         * (`tests/dangerous-binding-matrix.test.mjs` holds the two together).
         */
        if ((kind === PROPERTY || kind === LIVE) && real === '__proto__') {
          kind = REFUSED;
          if (__DEV__)
            console.warn(
              `[vera] <${el.localName}> binds \`${written}\`, which would replace the element's own prototype ` +
                `and destroy it — no property write does this, and no use of it is legitimate. The binding is ignored.`
            );
        } else if (kind === ATTR && real.toLowerCase() === 'srcdoc') {
          /** A bound `srcdoc` ATTRIBUTE renders its value as an HTML document: markup injection by construction. */
          kind = REFUSED;
          if (__DEV__)
            console.warn(
              `[vera] <${el.localName}> binds the \`srcdoc\` attribute, which renders its value as an HTML ` +
                `document — refused. If the markup is trusted and sanitized, bind the property: \`.srcdoc=\${…}\`.`
            );
        } else if (kind === ATTR && INLINE_HANDLER.test(real)) {
          /** A bound inline handler runs its value as code: refused, as spread and the server refuse it. */
          kind = REFUSED;
          if (__DEV__)
            console.warn(
              `[vera] <${el.localName}> binds the \`${real}\` attribute, which runs its value as code — refused. ` +
                `Bind a function as an event instead: \`@${real.slice(2).toLowerCase()}=\${…}\` (or \`on${real[2].toUpperCase()}${real.slice(3)}=\${…}\`).`
            );
        } else if (kind === PROPERTY && el.localName.includes('-')) kind = ADOPT;
        else if (kind === LIVE && el.localName.includes('-')) kind = LIVE_CUSTOM;
        /**
         * A property that REPLACES an element's content (`.textContent`, `.innerHTML`…) on an element that also has
         * content of its own — markup, or a child binding whose anchor is in it: the write strands the binding, and a
         * later commit into it throws on a missing parent. Cannot work as written, so development throws.
         */
        if (__DEV__ && kind !== ATTR && kind !== EVENT && kind !== BOOLEAN && CONTENT_PROPERTY.test(real) && ownsContent(el))
          contentClash(el.localName, real);
        kinds[i] = kind;
        names[i] = real;
        statics[i] = value.length === 2 && value[0] === '' && value[1] === '' ? null : value;
        present[i] = kind === ATTR && el.hasAttribute(real);
        /**
         * A custom element's `src` or `data` PROPERTY is its own business — often an object (`.data=${rows}`) —
         * so only a string is checked there (1), and nothing else is converted; everywhere else the value is converted
         * once (2) — and an animation's value (`to`, `values`…) is checked item by item (3).
         */
        const sink = URL_SINK.exec(real);
        urls[i] =
          kind === REFUSED || kind === BOOLEAN || kind === EVENT || sink === null
            ? 0
            : kind !== ATTR && el.localName.includes('-')
              ? 1
              : sink[1]
                ? 2
                : 3;
      }
      /** A raw-text element's markers arrived as characters: rebuild its content with anchors in their place. */
      if (RAW_TEXT_TAGS.test(el.localName) && el.textContent!.includes(MARKER)) {
        const pieces = el.textContent!.split(MARKER);
        el.textContent = '';
        for (let p = 0; p < pieces.length; p++) {
          if (p % 2 === 0) {
            if (pieces[p]) el.append(pieces[p]);
          } else el.append((nodes[+pieces[p]] = doc.createTextNode('')));
        }
      }
    }

    /**
     * A child binding that is its element's only content needs no anchor in the template — except inside
     * a raw-text element, whose content is never markup. Then each binding's path from the root.
     */
    const first = content.firstChild;
    const root = (this.$R = first !== null && first.nodeType === 1 && first.nextSibling === null ? first : content);
    for (let i = 0; i < count; i++) {
      let at = nodes[i];
      if (at === null) {
        if (__DEV__ && (kinds[i] === CHILD || names[i] !== '' || refs![i])) {
          if (inert!.has(i))
            console.warn(
              `[vera] renderer: the value at position ${i} sits inside a nested <template>'s content — inert markup that is ` +
                `never rendered — so it is ignored (and the server ignores it too). Render into the live tree instead.`
            );
          /** A run of consecutive casualties is one dropped element: said once, naming the first. */
          else if (i === 0 || nodes[i - 1] !== null || inert!.has(i - 1) || !(kinds[i - 1] === CHILD || names[i - 1] !== '' || refs![i - 1])) {
            let lost = 1;
            while (i + lost < count && nodes[i + lost] === null && !inert!.has(i + lost)) lost++;
            const where = tags![i] ? `\`${names[i] !== '' ? `${names[i]}=` : refs![i] ? '&=' : ''}\` on <${tags![i]}>` : 'a binding';
            console.warn(
              `[vera] renderer: ${where} never reached the parsed tree — the HTML parser DROPPED the element it was written ` +
                `on, because its parent's content model forbids it (\`<select>\` takes only options, \`<form>\` cannot nest, ` +
                `and so on).\n${lost} binding(s) lost. The element is gone from the DOM and its binding does nothing; the ` +
                `bindings AFTER it are unaffected, because each marker carries its own index.\nMove the element out of its ` +
                `parent, or use one the parent can hold.`
            );
          }
        }
        kinds[i] = IGNORED;
      } else if (kinds[i] === CHILD) {
        const parent = at!.parentNode!;
        if (__DEV__ && (parent as Element).localName === 'table')
          console.warn(
            '[vera] renderer: a binding sits directly inside <table>, where the HTML parser inserts a <tbody> that a ' +
              'client render does not. The same template then renders as `table > tr` and parses as `table > tbody > tr`, ' +
              'so `table > tr` selectors match on only one path and hydration rebuilds this container instead of adopting ' +
              'it. Write the section explicitly — `<table><tbody>${rows}</tbody></table>` — and every path agrees.'
          );
        /**
         * Only on a PLAIN element (no dash, no `is`): a light-DOM component renders into its own children, and the part
         * this position may become owns its element's whole content — so there it keeps its anchor, bounded by markers.
         */
        const host = parent as Element;
        if (
          parent.nodeType === 1 &&
          parent.childNodes.length === 1 &&
          !RAW_TEXT_TAGS.test(host.localName) &&
          !host.localName.includes('-') &&
          !host.hasAttribute('is')
        ) {
          parent.removeChild(at!);
          nodes[i] = at = parent;
          kinds[i] = SOLE;
        }
      }
      const path: number[] = [];
      for (; at != null && at !== root; at = at.parentNode) {
        let index = 0;
        for (let sibling = at.previousSibling; sibling !== null; sibling = sibling.previousSibling) index++;
        path.unshift(index);
      }
      this.$P.push(path);
    }
    /**
     * Development: an element position (a spread) on an element whose whole content is a SOLE binding — the content is
     * invisible until that binding commits, so the spread's content-property check is told by a mark per instance.
     */
    if (__DEV__) {
      for (let i = 0; i < count; i++)
        if ((kinds[i] === REF || kinds[i] === SELECT_REF) && nodes.some((n, j) => kinds[j] === SOLE && n === nodes[i]))
          (this._owned ??= []).push(i);
    }
    /**
     * **The `'template'` insert** — asked once, as each template is built (cold): a hook may set `_$at$`/`_$inst$`.
     * A module wired AFTER a template was built never hears about it; development says so at `wire` (core reads the
     * mark below).
     */
    if (__DEV__ && registry !== null) (registry as unknown as { $b?: boolean }).$b = true;
    const hooks = registry?.get('template') as TemplateHook[] | undefined;
    /**
     * **Marked by what the hooks LEFT, never by their existing**: a resolver (`_$at$`), an instance hook (`_$inst$`), or a
     * variant's namespace (`_$ns$` — its instances must set the create scope, or a position at their top level cannot
     * be resolved). The fields are the truth, so the mark cannot disagree with them, and the public `'template'` insert
     * keeps its contract (a hook returns nothing). Marking whenever a hook merely existed put every template of an app
     * wiring `elements` — every slots app — on the marked instance path, claimed or not.
     */
    if (hooks !== undefined) for (let i = 0; i < hooks.length; i++) hooks[i](this, result, readScope, root);
    this.$X = !!(this._$at$ || this._$inst$ || this._$ns$);
    /** Light-DOM slots claims a `<slot>` as the template is built — so a template built before it is wired never will. */
    if (__DEV__ && (root as ParentNode).querySelector?.('slot') && (registry as { _$done$?: unknown } | null)?._$done$ === undefined)
      this._slotless = true;
  }
}

/** A `'template'` insert: called once as each template is built. */
type TemplateHook = (template: Template, result: TemplateResult, readScope: () => unknown, root: Node) => void;

/**
 * **The create scope**: the template whose instance is being built, while its first update runs — how a resolver
 * answers for a position whose parent is still the instance's detached FRAGMENT (a fragment-rooted template's top
 * level). Set only by a marked template's instantiation.
 */
let scope: unknown = null;
const readScope = () => scope;

/** The template to build at a position — the same one, unless an extension resolves it by `parent` (namespaces). */
const resolved = (template: Template, parent: Node) => (template._$at$ !== undefined ? template._$at$(parent) : template);

const templateCache = new WeakMap<TemplateStringsArray, Template>();
/**
 * **Only a tagged template literal is a template.** Detection is by shape (`strings`), so a value from `JSON.parse` —
 * a request body, an API field an attacker can turn into an object — that looked like a template was rendered as
 * MARKUP. A literal's strings array owns `raw`, which JSON cannot give an array (and an object owning one is not an
 * array): the check Lit makes. It runs here, on the cache's miss, which a forged array always is, so a cached
 * template pays nothing. A forgery is the text any object renders as, `[object Object]` — one shared template, never
 * cached under the forger's own `strings` (a WeakMap throws on a primitive key) — and never a throw: the value is
 * attacker-controlled, and a throw would hand over the subtree.
 */
let forged: Template | undefined;
const getTemplate = (result: TemplateResult) => {
  let template = templateCache.get(result.strings);
  if (template === undefined) {
    const strings = result.strings;
    if (!(Array.isArray(strings) && Object.hasOwn(strings, 'raw'))) {
      if (__DEV__)
        console.warn(
          '[vera] renderer: a value shaped like a template was not made by html`` — rendered as text. A template from ' +
            'data (JSON, or html([markup])) is never markup; for trusted markup, bind it: <div .innerHTML=${markup}>.'
        );
      return (forged ??= new Template({ strings: [`${{}}`] } as unknown as TemplateResult));
    }
    templateCache.set(strings, (template = new Template(result)));
  }
  return template;
};

/** `${value}` rather than `String(value)`: a symbol throws here as it does at every other sink. */
const toText = (value: unknown) => (value == null ? '' : `${value}`);

/**
 * The record an `@event`, element-position or custom-element `.prop` binding holds in its node slot.
 * For an event it is the LISTENER — a stable object, so swapping handlers never touches the DOM and a
 * re-add through `null` is deduped by the platform; for a ref it is the key an `_$apply$` value keeps
 * its ownership by; for `.prop` on a custom element, `_state` is where adoption stands (`adoptProperty`:
 * 0 still adopting, 1 received, 2 refused).
 */
class Slot {
  _element: Element;
  _handler: unknown = null;
  _state = 0;
  constructor(element: Element) {
    this._element = element;
  }
  /** A function is called with the element as `this`; an object is invoked through its `handleEvent`. */
  handleEvent(event: Event) {
    const handler = this._handler as EventListener | EventListenerObject | null;
    if (typeof handler === 'function') handler.call(this._element as never, event);
    else if (typeof handler?.handleEvent === 'function') handler.handleEvent(event);
  }
}

/**
 * Calls an element ref, and survives one that throws — it runs mid-commit, and an unguarded throw left
 * the render half applied. Reported where a hook's error is: the app's `'error'` chain, handed the
 * component being rendered, else `reportError`.
 */
const applyRef = (callback: (element: Element | null) => void, element: Element | null) => {
  try {
    callback(element);
  } catch (error) {
    const handlers = registry?.get('error') as ((error: unknown, element?: Element) => void)[] | undefined;
    if (handlers?.length) {
      const host = renderRoot?.nodeType === 11 ? (renderRoot as ShadowRoot).host : (renderRoot as Element | null);
      for (const handler of handlers) handler(error, host ?? undefined);
    } else reportUncaught(error, __DEV__ ? 'an element ref threw; the render continued without it.' : 'ref threw');
  }
};

/**
 * A rendered template. Its bindings live in ONE array of `[node, committed value]` pairs rather than a
 * part object each — a row allocates the instance and that array, nothing else. The instance is also
 * its own list item: `$k` is the key a keyed list reads.
 */
class Instance {
  $k: unknown = undefined;
  _template: Template;
  /** The strings this instance was built from — the same-shape identity. */
  _strings: TemplateStringsArray;
  /** The cloned root: the element for a single-root template, else the (soon emptied) fragment. */
  $R: Node;
  _bindings: unknown[];
  constructor(template: Template, strings: TemplateStringsArray, root: Node, bindings: unknown[]) {
    this._template = template;
    this._strings = strings;
    this.$R = root;
    this._bindings = bindings;
  }
}

/**
 * Builds an instance and commits its first values.
 *
 * **The clone.** Creating an element in a document WITH a custom-element registry costs a definition
 * lookup per element; the template's inert document has none. So a template that cannot contain a
 * custom element is cloned with `cloneNode` — its nodes adopt into the page on insertion — and one that
 * can is imported into `owner`, which upgrades defined elements at clone time in the owner's own
 * registry, so a `.prop` commit reaches the class's setter rather than shadowing it. A foreign `owner`
 * (a popped-out window, an iframe) always imports.
 *
 * **Every node is located before anything commits.** The paths index the pristine clone; an upgrading
 * child position inserts markers and content, which would shift the siblings a later path counts.
 */
const instantiate = (template: Template, result: TemplateResult, owner: Document): Instance => {
  if (__DEV__) sayShape(template);
  if (__DEV__ && template._slotless) saySlotless();
  const source = template.$R;
  const root = template._plain && owner === doc ? source.cloneNode(true) : owner.importNode(source, true);
  const kinds = template.$K;
  const paths = template.$P;
  const marked = template.$X;
  /** A marked template's instance keeps its hook's state in ONE slot after its bindings — the hook's own object. */
  const bindings = new Array(kinds.length * 2 + (marked ? 1 : 0));
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i];
    if (kind === IGNORED) continue;
    let node = root;
    const path = paths[i];
    for (let step = 0; step < path.length; step++) {
      node = node.firstChild!;
      for (let hops = path[step]; hops > 0; hops--) node = node.nextSibling!;
    }
    bindings[i * 2] = kind >= EVENT && kind <= ADOPT ? new Slot(node as Element) : node;
    bindings[i * 2 + 1] = kind === CHILD ? '' : UNSET;
  }
  if (__DEV__ && template._owned !== undefined)
    for (const i of template._owned) ((bindings[i * 2] as Slot)._element as Element & { $content?: boolean }).$content = true;
  const instance = new Instance(template, result.strings, root, bindings);
  if (marked) {
    hookUp(instance, root, false);
    const outer = scope;
    scope = template;
    update(instance, result.values);
    scope = outer;
  } else update(instance, result.values);
  return instance;
};

/**
 * **An instance of a marked template meets its instance hook** — before its first update (claims see the inert
 * clone), with its mount queued for when the render that created it finishes. Arms removal work, so an instance
 * discarded before then is walked at teardown and never mounts. Also how hydration hooks an adopted instance.
 */
export const hookUp = (instance: Instance, root: Node, adopted: boolean) => {
  const hook = instance._template._$inst$;
  if (hook === undefined) return;
  /** The hook's own state — what to mount, and later what to unmount — or nothing to take part. */
  const state = hook.$c(root, renderRoot, adopted);
  if (state === undefined) return;
  instance._bindings[instance._template.$K.length * 2] = state;
  /** Mounted by the ref flush: a record whose second half is not a slot number is a mount. */
  (pendingRefs ??= []).push(hook, state);
  notifyOnRemoval = true;
};

/**
 * Commits new values into an instance of the same shape. An unchanged single-value binding — nearly
 * every binding of nearly every row on a list update — is skipped here, before any call.
 */
const update = (instance: Instance, values: unknown[]) => {
  const template = instance._template;
  const kinds = template.$K;
  const statics = template._statics;
  const bindings = instance._bindings;
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i];
    if (kind !== IGNORED && (kind >= LIVE || statics[i] !== null || values[i] !== bindings[i * 2 + 1]))
      commit(template, bindings, i, kind, values);
  }
};

/** Commits the binding at value position `i`. */
/**
 * **A boolean at a child position renders as the WORD** — `${cond && …}` with a false `cond` shows "false". Said in
 * development on each CHANGE to a boolean (the dirty check already skips a repeat), so a binding that keeps
 * producing `false` speaks once, and one that flips to `true` speaks again.
 */
const warnBooleanChild = (value: boolean) =>
  console.warn(
    `[vera] renderer: a child position was given \`${value}\`, which renders as the word "${value}" — the usual cause ` +
      `is \`\${cond && …}\` with a false \`cond\`.\nWrite \`\${cond ? … : null}\`, or \`\${(cond && …) || null}\`; \`null\` ` +
      `and \`undefined\` are the values that render nothing. If you meant to display the boolean, say so with ` +
      `\`\${String(value)}\` and this goes quiet.`
  );

/**
 * **Content in the wrong namespace does not render** — `` html`<path/>` `` handed into an `<svg>` builds an HTML
 * `<path>`, which draws nothing and says nothing. Development only, at each insert: the host is read from where the
 * content LANDS, and a mismatch is named once per host and content (a toggled subtree would otherwise warn every
 * frame). Silent where HTML is correct — integration points (`<foreignObject>`, `<desc>`, `<title>`, MathML's token
 * elements, an HTML-encoded `<annotation-xml>`) and `<style>`/`<script>`, which never draw.
 */
const SVG_NS = 'http://www.w3.org/2000/svg';
const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';
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
const warnedForeign = /* @__PURE__ */ new Set<string>();
/** The nodes an insert is about to place — a fragment empties as it is inserted, so they are read first. */
const landing = (node: Node): Node[] => (node.nodeType === 11 ? [...node.childNodes] : [node]);
const checkForeign = (parent: Node, nodes: Node[]) => {
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
    if (warnedForeign.has(seen)) continue;
    warnedForeign.add(seen);
    const advice =
      built === 'HTML'
        ? `If it is meant to be an SVG or MathML element, the template holding it needs the svg\`…\` or mathml\`…\` tag ` +
          `at the call site — or wire @verajs/renderer/namespaces, which parses a template where it lands (compiled JSX ` +
          `wires it itself). A template built before it was wired keeps the namespace it was first built in. If it is ` +
          `genuinely HTML (a <div>, a custom element), it belongs in ${island}: tagging it will not help, and a custom ` +
          `element only upgrades in the HTML namespace.`
        : `The template's tag is already right — these two namespaces cannot nest directly. Put the ` +
          `${built === 'SVG' ? '<svg>' : '<math>'} root inside ${island}.`;
    console.warn(`[vera] renderer: <${tag}> was built as ${built} and placed inside <${host}>, where it will not render. ${advice}`);
  }
};

/**
 * **The profiler's hook** (`@verajs/renderer/profiler`, a development-only entry): told of each same-shape update, each
 * first template, each REBUILD (the template identity changed, so the subtree is torn down) and each `renderInto`
 * frame. Every call site is `if (__DEV__ && profileHook !== null)`, so production carries neither the hook nor a call.
 */
type ProfileHook = (kind: number, subject: unknown, shape: TemplateStringsArray | null) => void;
const PROFILE_UPDATE = 0;
const PROFILE_CREATE = 1;
const PROFILE_REBUILD = 2;
const PROFILE_FRAME_START = 3;
const PROFILE_FRAME_END = 4;
let profileHook: ProfileHook | null = null;
const setProfileHook = (hook: ProfileHook | null) => {
  profileHook = hook;
};

/** How many times a part's child applier changed identity — development only; `@__PURE__` keeps it out of production. */
const applierSwaps = /* @__PURE__ */ new WeakMap<object, number>();

const commit = (template: Template, bindings: unknown[], i: number, kind: number, values: unknown[]) => {
  const slot = i * 2;
  const committed = bindings[slot + 1];
  const node = bindings[slot];
  if (kind <= SOLE) {
    const value = values[i];
    if (committed === UPGRADED) (node as ChildPart).$p(value);
    else if (value == null || typeof value === 'object') {
      /** A template, list, node or nothing: the position becomes a full part, anchored where its text was. */
      let part: ChildPart;
      if (kind === SOLE) {
        /** Its plain element's whole content is this binding's: the element is the range, and no comment is added. */
        part = new ChildPart(null, null);
        if (committed === UNSET) part.$w = node as Element;
        else {
          part.$w = (node as Text).parentNode;
          part.$o = TEXT;
          part.$l = node as Text;
          part.$v = committed;
        }
      } else {
        part = markered((node as Text).parentNode!, node as Text);
        (node as Text).parentNode!.insertBefore(node as Text, part.$e);
        part.$o = TEXT;
        part.$l = node as Text;
        part.$v = committed;
      }
      bindings[slot] = part;
      bindings[slot + 1] = UPGRADED;
      part.$p(value);
    } else if (value !== committed) {
      if (__DEV__ && typeof value === 'boolean') warnBooleanChild(value);
      if (committed === UNSET) {
        /** SOLE's first text: created holding its value. `''` creates no node, so that one is appended. */
        if (value === '') (node as Element).append('');
        else (node as Element).textContent = value as string;
        bindings[slot] = (node as Element).firstChild;
      } else (node as Text).data = value as string;
      bindings[slot + 1] = value;
    }
    return;
  }
  /**
   * One test for the kinds decided before anything is computed — the same one comparison `REFUSED` alone cost. A
   * `selectedIndex` has no statics and no URL: queued, as a select's value is — except while adopting, where the
   * server marked the option and whatever the user chose before the script arrived stands.
   */
  if (kind >= REFUSED) {
    if (kind === SELECT_INDEX) {
      bindings[slot + 1] = values[i];
      if (!(__HYDRATING__ && adopting)) (pendingSelects ??= []).push(LATER, [node, values[i]]);
    }
    return;
  }
  const parts = template._statics[i];
  let value = values[i];
  if (parts !== null && kind !== EVENT && kind !== REF) {
    value = parts[0];
    for (let p = 1; p < parts.length; p++) value += toText(values[i + p - 1]) + parts[p];
  }
  const name = template.$N[i];
  const element = (kind >= EVENT && kind <= ADOPT ? (node as Slot)._element : node) as Element;
  /**
   * A `javascript:` URL bound where a browser navigates is code arriving as data: refused, and the
   * attribute removed, on the JOINED value (so `href="java${x}"` is caught too). Statics are the author's
   * and never checked alone; only bindings the template marked as URL-bearing pay for the test.
   *
   * **Converted ONCE, and the string checked is the string written.** Testing the value and then handing it
   * to `setAttribute` converted it twice, so an object whose `toString` answered differently each time
   * passed the check as `https:` and was written as `javascript:`.
   */
  const url = template._urls[i];
  if (url > 1 && value != null && typeof value !== 'string') value = `${value}`;
  if (url !== 0 && typeof value === 'string' && (url === 3 ? SCRIPT_URL_ITEM : SCRIPT_URL).test(value)) {
    if (__DEV__ && value !== committed)
      console.warn(
        `[vera] renderer: \`${name}\` was given a javascript: URL — refused, and the attribute removed. A bound ` +
          `URL is data, and data must never become code.`
      );
    bindings[slot + 1] = value;
    element.removeAttribute(name);
    return;
  }
  /**
   * **Adopting server markup** (the hydrate entry only — `__HYDRATING__` folds this away everywhere else). The server
   * wrote the attribute already, so it is READ and written only on a difference — a wrong one is repaired, a right one
   * costs no write. A form control's value, a `!name` on a plain element and a select's selection are RECORDED, not
   * written: the server's default, and anything the user typed before the script arrived, stand. (A `!name` then
   * compares on the next render and overwrites what was typed — the controlled contract, unchanged.)
   */
  if (__HYDRATING__ && adopting) {
    if (kind === ATTR) {
      bindings[slot + 1] = value;
      if (value == null) {
        if (element.hasAttribute(name)) element.removeAttribute(name);
      } else if (element.getAttribute(name) !== toText(value)) element.setAttribute(name, value as string);
      return;
    }
    if (kind === BOOLEAN) {
      bindings[slot + 1] = value;
      if (element.hasAttribute(name) !== !!value) element.toggleAttribute(name, !!value);
      return;
    }
    if (kind === SELECT || kind === LIVE || (kind === PROPERTY && (name === 'value' || name === 'checked' || name === 'selected'))) {
      bindings[slot + 1] = value;
      return;
    }
  }
  /** The kinds that re-assert every render sit from `LIVE` up (`REFUSED` returned above): ONE test routes them all. */
  if (kind >= LIVE) {
    if (kind === SELECT) (pendingSelects ??= []).push(element, value);
    /** A component's getter is its own code: read on the parent's behalf, it must not subscribe the parent's render. */
    else if ((kind === LIVE ? (element as unknown as Record<string, unknown>)[name] : untracked(read, element, name)) !== value)
      (element as unknown as Record<string, unknown>)[name] = value;
  } else if (value === committed) return;
  bindings[slot + 1] = value;
  if (kind === ATTR) {
    /**
     * A value that is not text becomes something nobody meant — a function's source, an array joined by commas, a
     * Date in the machine's timezone. Asked of the RAW value: a URL-bearing name was converted above. Said once per
     * element, name and kind of value (`dev-values`), so fixing one mistake never hides the next.
     */
    if (__DEV__ && value != null) {
      const complaint = attributeValueComplaint(element.localName, name, parts === null ? values[i] : value);
      if (complaint !== null) console.warn(`[vera] ${complaint}`);
    }
    if (value != null) element.setAttribute(name, value as string);
    /** A fresh clone carries no attribute to remove unless the template itself wrote one. */
    else if (committed !== UNSET || template._present[i]) element.removeAttribute(name);
  } else if (kind === PROPERTY) (element as unknown as Record<string, unknown>)[name] = value;
  else if (kind === BOOLEAN) element.toggleAttribute(name, !!value);
  else if (kind === EVENT) {
    const listener = node as Slot;
    if (__DEV__ && value != null && value !== false) {
      /** Something that cannot listen does nothing, silently — `false`/`undefined` are the deliberate "no handler". */
      if (typeof value !== 'function' && typeof (value as EventListenerObject).handleEvent !== 'function')
        console.warn(
          `[vera] @${name} on <${element.localName}> was given ${typeof value === 'object' ? 'an object with no handleEvent method' : `a ${typeof value}`}, ` +
            `which cannot listen — the event will do nothing.\nPass a function, or an object with a handleEvent method. A ` +
            `missing handler is \`undefined\` or \`false\`, both of which are fine; this is neither.`
        );
      /** A misspelled event name (`@clik`), asked at the first attachment, once per tag and name. */
      if (listener._handler === null) {
        const complaint = eventNameComplaint(element, name);
        if (complaint !== null) console.warn('[vera] ' + complaint);
      }
    }
    /** Registered once, as the listener OBJECT: the platform dedupes it, so toggling through null never stacks. */
    if (listener._handler === null && value != null) element.addEventListener(name, listener);
    listener._handler = value ?? null;
  } else if (kind === ADOPT) {
    const adopting = node as Slot;
    if (adopting._state === 1) (element as unknown as Record<string, unknown>)[name] = value;
    else if (adopting._state === 0) adopting._state = adoptProperty(element, name, value);
  } else if (kind === REF || kind === SELECT_REF) {
    /**
     * The ref this binding held was handed its element (it is not still queued), and it is being replaced or
     * removed: it is told now, before its successor is handed the element after the pass.
     */
    if (committed !== UNSET && (node as Slot)._state === 0) release(committed);
    if (value == null) return;
    notifyOnRemoval = true;
    /**
     * A value with `_$apply$` applies itself NOW, mid-commit, keyed by this binding — spread delivers
     * properties through it, and they must arrive before the element is inserted and upgraded.
     */
    /** A FUNCTION, not merely present: parsed JSON can carry the key, never a function — data stays data. */
    if (typeof (value as { _$apply$?: unknown })._$apply$ === 'function') {
      /** On a `<select>` it may set the selection (a spread's `.value`), so it waits for the options too — see `flush`. */
      if (kind === SELECT_REF) (pendingSelects ??= []).push(LATER, __HYDRATING__ ? [value, element, node, adopting] : [value, element, node]);
      /** Adopting, it is told so (the hydrate entry only): a form control's value the user typed must stand. */
      else if (__HYDRATING__) (value as Applies)._$apply$(element, node as Slot, untracked, adopting);
      else (value as Applies)._$apply$(element, node as Slot, untracked);
    }
    /**
     * A ref — a function, or an object taking `.value` (core's `ref()`) — is handed its element once the pass's
     * DOM exists: inserted, upgraded, in its own document. Queued at most once per pass (`_state`), and the
     * flush reads whatever the binding holds THEN, so a ref replaced, removed or torn down in the meantime is
     * never handed a stale element.
     */
    else if ((typeof value === 'function' || typeof value === 'object') && (node as Slot)._state === 0) {
      (node as Slot)._state = 1;
      (pendingRefs ??= []).push(bindings, slot);
    }
  }
};

/**
 * Tells what an instance holds that it is going away: a ref is released (`null`, so a component reading
 * it after a subtree was replaced does not get a detached element back), and a child position that
 * became a part passes the news down. Reached only when `notifyOnRemoval` is set.
 */
const teardown = (instance: Instance) => {
  const kinds = instance._template.$K;
  const bindings = instance._bindings;
  /** An instance hook is told, with its state: it unmounts what it mounted, and one not yet mounted never mounts. */
  if (instance._template.$X) {
    const at = kinds.length * 2;
    const state = bindings[at];
    if (state !== undefined) {
      bindings[at] = undefined;
      instance._template._$inst$!.$q(state);
    }
  }
  for (let i = 0; i < kinds.length; i++) {
    const value = bindings[i * 2 + 1];
    if (kinds[i] === REF || kinds[i] === SELECT_REF) {
      /** A ref still queued was never handed its element, so it is not told it is gone. */
      if ((bindings[i * 2] as Slot)._state !== 1) release(value);
      bindings[i * 2 + 1] = UNSET;
    } else if (value === UPGRADED) (bindings[i * 2] as ChildPart)._destroy();
  }
};
/** A list item is going away for good. */
const detachItem = (item: Item) => (item instanceof ChildPart ? item._destroy() : teardown(item));

/**
 * Tells a ref its element is no longer its: a function is called with `null`, an object's `.value` becomes
 * `null` (core's `ref()` — "deliberately nothing"). A value with `_$apply$` owns its own lifecycle.
 */
const release = (value: unknown) => {
  if (typeof value === 'function') applyRef(value as (element: Element | null) => void, null);
  else if (value !== null && typeof value === 'object' && value !== UNSET && (value as { _$apply$?: unknown })._$apply$ === undefined)
    (value as { value: unknown }).value = null;
};

/** A single property read — it runs once per list item per render. */
const isTemplateResult = (value: object): value is TemplateResult =>
  (value as TemplateResult).strings !== undefined;

/** What a ChildPart holds. */
const EMPTY = 0;
const TEXT = 1;
const TEMPLATE = 2;
const LIST = 3;
const NODE = 4;

/** Removal is a move into this fragment, then one clear. */
const SCRATCH = doc.createDocumentFragment();

/**
 * Internals the hydrate entry adopts through. The base entry (`index.ts`) re-exports none of them, so its bundle
 * tree-shakes them away; the hydrate bundle inlines this module and reaches them.
 */
export {
  setProfileHook,
  PROFILE_UPDATE,
  PROFILE_CREATE,
  PROFILE_REBUILD,
  PROFILE_FRAME_START,
  PROFILE_FRAME_END,
  getTemplate,
  resolved,
  Instance,
  ChildPart,
  Slot,
  comment,
  toText,
  isTemplateResult,
  rootParts,
  registry,
  renderRoot,
  UNSET,
  UPGRADED,
  IGNORED,
  CHILD,
  SOLE,
  EVENT,
  ADOPT,
  TEXT,
  TEMPLATE,
  LIST,
  NODE,
  PROPERTY,
  LIVE,
};
export type { Template };

/** A list item: an instance of a single-root template (its element is its whole range), or a markered part. */
export type Item = Instance | ChildPart;

/**
 * A value that names the strategy able to reconcile a list of its kind — `keyed()` is the producer.
 * It lives here rather than in `types.ts` because it names `ChildPart`, a runtime class of this file.
 */
export type ListStrategy = (part: ChildPart, values: unknown[], items: Item[], parent: Node, end: Node | null) => Item[];

/** A `TemplateResult` that `keyed()` marked with its strategy. */
export interface KeyedResult extends TemplateResult {
  $r?: ListStrategy;
}

/**
 * A child position that holds anything but plain text: a template, a list, a node, or nothing — or
 * text it took over from an upgraded binding. It owns the range between two comment markers
 * — the root part's too, so content before and after a render stays — or, for a SOLE position, its element's whole
 * content (`$w`, no markers at all).
 *
 * **The ownership invariant — whoever writes an element's content owns it, and owns its verification.** Two cases:
 * a PLAIN element whose whole content is one binding belongs to that binding (the part is its range, and hydration
 * adopts it with no markers); a CUSTOM element's children belong to the component (a binding inside it keeps its
 * markers, and hydration compares them only when the template itself writes content inside the tag). Slots (piece 8)
 * inherit both.
 */
class ChildPart {
  $s: Comment | null;
  $e: Node | null;
  /** The element this part owns entirely (a SOLE position), or `null` for a part between markers. */
  $w: Node | null = null;
  $o = EMPTY;
  $v: unknown = undefined;
  $l: Text | null = null;
  $n: Instance | null = null;
  $i: Item[] | null = null;
  /** The key a keyed list reads when this part is one of its items. */
  $k: unknown = undefined;
  /** Instances `hold()` parked here, by template identity — they outlive interim content. */
  _held: Map<TemplateStringsArray, Instance> | null = null;
  /** Whatever the last `_$child$` applier returned here (its continuity), and which applier that was. */
  $z: unknown = undefined;
  $a: unknown = undefined;
  /** The container whose render attached the applier — a later `_$commit$` runs as a render of it. */
  declare $R?: Node | null;

  constructor(start: Comment | null, end: Node | null) {
    this.$s = start;
    this.$e = end;
  }

  _insert(node: Node) {
    const placed = __DEV__ ? landing(node) : undefined;
    (this.$w ?? this.$s!.parentNode!).insertBefore(node, this.$e);
    if (__DEV__) checkForeign(this.$w ?? this.$s!.parentNode!, placed!);
  }

  /**
   * Tells the CURRENT content that it is going away — the part itself stays, so what `hold()` parked here stays
   * parked and can still come back. Reached only when `notifyOnRemoval` is set.
   */
  _detach() {
    if (this.$a !== undefined) (this.$a as Applier)._$detach$?.(this.$z);
    if (this.$n !== null) teardown(this.$n);
    const items = this.$i;
    if (items !== null) for (let i = 0; i < items.length; i++) detachItem(items[i]);
  }

  /** The part itself is going away: its current content, and everything `hold()` parked here (then collectable). */
  _destroy() {
    this._detach();
    const held = this._held;
    if (held !== null) {
      for (const instance of held.values()) teardown(instance);
      this._held = null;
    }
  }

  _clear() {
    if (notifyOnRemoval) this._detach();
    const owner = this.$w;
    const start = this.$s!;
    const end = this.$e;
    /** Owning the parent's whole content, one `textContent = ''` replaces a removal per node. */
    if (owner !== null) owner.textContent = '';
    else if (start.previousSibling === null && end!.nextSibling === null) {
      const parent = start.parentNode!;
      parent.textContent = '';
      parent.appendChild(start);
      parent.appendChild(end!);
    } else {
      const parent = start.parentNode!;
      let node = start.nextSibling;
      /** `node !== null` is a backstop: a detached boundary leaves nodes behind rather than throwing mid-render. */
      while (node !== null && node !== end) {
        const next = node.nextSibling;
        parent.removeChild(node);
        node = next;
      }
    }
    this.$o = EMPTY;
    this.$l = null;
    this.$n = null;
    this.$i = null;
    this.$z = undefined;
    this.$a = undefined;
  }

  /**
   * How a `_$child$` applier renders — `_$`-named so it survives mangling, because third parties call
   * it. Its own state survives its own commit. A commit that arrives outside its container's render (an
   * applier resolving later) runs as a render of that container, while it still contains the part.
   */
  _$commit$(value: unknown) {
    const applierState = this.$z;
    const applier = this.$a;
    if (renderRoot !== this.$R || renderRoot === null)
      commitAs(this.$R != null && this.$R.contains(this.$w ?? this.$s) ? this.$R : null, this, value, this.$R ?? null);
    else this.$p(value);
    this.$z = applierState;
    this.$a = applier;
  }

  $p(value: unknown) {
    if (value == null) {
      if (this.$o !== EMPTY) this._clear();
      return;
    }
    if (typeof value !== 'object') {
      if (__DEV__ && typeof value === 'boolean' && (this.$o !== TEXT || this.$v !== value)) warnBooleanChild(value);
      if (this.$o === TEXT) {
        if (this.$v !== value) this.$l!.data = value as string;
      } else {
        if (this.$o !== EMPTY) this._clear();
        this._insert((this.$l = doc.createTextNode(value as string)));
        this.$o = TEXT;
      }
      this.$v = value;
      return;
    }
    /** `hold()` wraps a template as `{ $h }`: the one it replaces is parked by template identity, not destroyed. */
    const held = (value as { $h?: TemplateResult }).$h;
    if (held !== undefined || isTemplateResult(value)) {
      const result = held ?? (value as TemplateResult);
      /** The hottest line of a list update: same strings, commit the values and nothing else. */
      if (this.$o === TEMPLATE && this.$n!._strings === result.strings) {
        if (__DEV__ && profileHook !== null) profileHook(PROFILE_UPDATE, this, result.strings);
        update(this.$n!, result.values);
        return;
      }
      if (__DEV__ && profileHook !== null) profileHook(this.$o === TEMPLATE ? PROFILE_REBUILD : PROFILE_CREATE, this, result.strings);
      let instance: Instance | undefined;
      if (held !== undefined) {
        const parked = (this._held ??= new Map());
        if (this.$o === TEMPLATE) {
          const current = this.$n!;
          const root = current.$R;
          /** A fragment root takes its nodes back; an element root IS the range. */
          if (root.nodeType === 11) {
            let node = this.$w !== null ? this.$w.firstChild : this.$s!.nextSibling;
            while (node !== this.$e) {
              const next = node!.nextSibling;
              root.appendChild(node!);
              node = next;
            }
          } else (root as ChildNode).remove();
          parked.set(current._strings, current);
          this.$o = EMPTY;
        }
        /** The map holds exactly what is PARKED: an instance coming back leaves it, so a later clear cannot strand it there. */
        instance = parked.get(result.strings);
        if (instance !== undefined) parked.delete(result.strings);
      }
      if (this.$o !== EMPTY) this._clear();
      if (instance === undefined) {
        let template = getTemplate(result);
        if (template.$X) template = resolved(template, this.$w ?? this.$s!.parentNode!);
        instance = instantiate(template, result, passDoc);
        this._insert(instance.$R);
      } else {
        /** Inserted first, then updated, as every update is: its nodes are live when its values commit. */
        this._insert(instance.$R);
        update(instance, result.values);
      }
      this.$n = instance;
      this.$o = TEMPLATE;
      return;
    }
    /** A value kind a module handles (`'value'` insert) — how a kind becomes a package, not a branch here. */
    const handlers = registry?.get('value') as ValueHandler[] | undefined;
    if (handlers !== undefined) for (let i = 0; i < handlers.length; i++) if (handlers[i](this, value)) return;
    if (Array.isArray(value)) return this._commitList(value);
    /** Any other iterable is a list — but a node is placed, not iterated (a `<select>`, a `<form>`). */
    if (typeof (value as Iterable<unknown>)[Symbol.iterator] === 'function' && (value as Node).nodeType === undefined)
      return this._commitList([...(value as Iterable<unknown>)]);
    /**
     * A value that applies itself at a child position: `_$child$(part, previous)` renders through
     * `part._$commit$` and returns its continuity, handed back next time — to THIS applier only.
     */
    const applyChild = (value as { _$child$?: Applier })._$child$;
    if (applyChild !== undefined) {
      const previous = this.$a === applyChild ? this.$z : undefined;
      /**
       * An applier written as an object-literal method is a new function every call, so `previous` is always
       * undefined and it restarts every render. Said on the third swap at one part — once or twice is a real change.
       */
      if (__DEV__ && this.$a !== undefined && this.$a !== applyChild) {
        const swaps = (applierSwaps.get(this) ?? 0) + 1;
        applierSwaps.set(this, swaps);
        if (swaps === 3)
          console.warn(
            `[vera] a child applier changed identity ${swaps} times at one part, so \`previous\` is always undefined ` +
              `and it restarts every render.\nHoist the applier — written as an object-literal method it is a new ` +
              `function per call:\n\n  function applyThing(part, previous) { … }            // once, at module scope\n` +
              `  const thing = (x) => ({ _$child$: applyThing, x });  // state on the object\n`
          );
      }
      this.$a = applyChild;
      this.$R = renderRoot;
      if (applyChild._$detach$ !== undefined) notifyOnRemoval = true;
      this.$z = applyChild.call(value, this, previous);
      return;
    }
    if ((value as Node).nodeType !== undefined) {
      if (this.$o !== NODE || this.$v !== value) {
        if (this.$o !== EMPTY) this._clear();
        this._insert(value as Node);
        this.$v = value;
        this.$o = NODE;
      }
      return;
    }
    this.$p(String(value));
  }

  /** Creates one list item before `ref`. */
  $c(value: unknown, parent: Node, ref: Node | null): Item {
    if (value !== null && typeof value === 'object' && isTemplateResult(value)) {
      let template = getTemplate(value);
      if (template.$X) template = resolved(template, parent);
      if (template.$R.nodeType === 1) {
        const instance = instantiate(template, value, passDoc);
        into(parent, ref).insertBefore(instance.$R, ref);
        if (__DEV__) checkForeign(parent, [instance.$R]);
        instance.$k = value.key;
        return instance;
      }
    }
    const part = markered(parent, ref);
    part.$p(value);
    part.$k = (value as TemplateResult | null)?.key;
    return part;
  }

  /** Commits `value` into an item; returns the item now standing there (an instance whose shape changed becomes a part). */
  $u(item: Item, value: unknown): Item {
    if (item instanceof ChildPart) {
      item.$p(value);
      return item;
    }
    if (value !== null && typeof value === 'object' && (value as TemplateResult).strings === item._strings) {
      update(item, (value as TemplateResult).values);
      return item;
    }
    const element = item.$R as Element;
    const part = markered(element.parentNode!, element);
    /** The row's shape changed: the instance is gone for good, so what it holds is told. */
    if (notifyOnRemoval) teardown(item);
    element.remove();
    part.$k = item.$k;
    part.$p(value);
    return part;
  }

  /** The item's first node — its move handle and the insertion reference before it. */
  $f(item: Item): Node {
    return item instanceof ChildPart ? item.$s! : item.$R;
  }

  /** Moves an item before `ref`. */
  $m(item: Item, ref: Node | null, parent: Node = this.$w ?? this.$s!.parentNode!) {
    const at = into(parent, ref);
    if (!(item instanceof ChildPart)) {
      at.insertBefore(item.$R, ref);
      return;
    }
    let node: Node | null = item.$s!;
    const stop = item.$e!.nextSibling;
    while (node !== stop) {
      const next: Node | null = node!.nextSibling;
      at.insertBefore(node!, ref);
      node = next;
    }
  }

  /** Removes an item. */
  $d(item: Item) {
    if (notifyOnRemoval) detachItem(item);
    this.$m(item, null, SCRATCH);
    SCRATCH.textContent = '';
  }

  _commitList(values: unknown[]) {
    const count = values.length;
    /**
     * A keyed list names its own strategy (`keyed()` stamps `$r`). Keyed and index items are the same
     * kind of item — an unkeyed one carries `$k === undefined`, which a keyed pass treats as not found —
     * so a list can change between the two without being rebuilt.
     */
    const strategy = count ? (values[0] as KeyedResult | null)?.$r : undefined;
    if (this.$o !== LIST) {
      if (this.$o !== EMPTY) this._clear();
      this.$i = [];
      this.$o = LIST;
    }
    const items = this.$i!;
    if (count === 0) {
      if (items.length) {
        this._clear();
        this.$i = [];
        this.$o = LIST;
      }
      return;
    }
    const parent = this.$w ?? this.$s!.parentNode!;
    const end = this.$e;
    if (strategy !== undefined) {
      this.$i = strategy(this, values, items, parent, end);
      return;
    }
    /** Index mode: update in place, grow at the end, shrink from the end. Rows go straight into the parent. */
    const shared = items.length < count ? items.length : count;
    for (let i = 0; i < shared; i++) items[i] = this.$u(items[i], values[i]);
    for (let i = items.length; i < count; i++) items.push(this.$c(values[i], parent, end));
    if (count < items.length) {
      if (notifyOnRemoval) for (let i = count; i < items.length; i++) detachItem(items[i]);
      for (let i = count; i < items.length; i++) this.$m(items[i], null, SCRATCH);
      SCRATCH.textContent = '';
      items.length = count;
    }
  }
}

/** A value at a child position a module claims — the `'value'` insert. Return `true` to take it. */
type ValueHandler = (part: object, value: unknown) => boolean | void;
/** An element-position value that applies itself — a spread. */
type Applies = { _$apply$: (element: Element, key: object, run: Untracked, adopting?: boolean) => void };

/** A child-position applier: renders through `part._$commit$`, keeps continuity in its return value. */
type Applier = ((part: { _$commit$(value: unknown): void }, previous: unknown) => unknown) & {
  /** Told, with its last state, when its position goes away. */
  _$detach$?: (previous: unknown) => void;
};

/**
 * The registry `renderer.connect` was handed — the app's own, so a CDN page with separate bundles still
 * meets one `'value'`/`'error'` chain. Never imported: a production bundle inlines `@verajs/inserts`.
 */
let registry: { get(name: string): unknown[] | undefined } | null = null;

/**
 * Core's `untracked`, taken off that registry at `connect` (`call` without core): what the renderer runs someone
 * else's code through during a render — a ref, and a component's getter it reads on the parent's behalf — so that
 * code's reads subscribe nothing. What the renderer reads ITSELF stays tracked: a store array handed to a template
 * is walked here, and that walk is what subscribes the parent to its length and items.
 */
let untracked: Untracked = call;

/** The container of the `renderInto` in progress — a ref's error names its component through it. */
let renderRoot: Node | null = null;

/**
 * Whether anything asked to be told when a subtree goes away: a ref to release, an applier with
 * `_$detach$`. Process-wide — an app with neither walks nothing, and a clear stays one `textContent = ''`.
 */
let notifyOnRemoval = false;

/**
 * The binding being committed belongs to ADOPTED server markup — true only inside `commitAdopting`, only in the hydrate
 * entry. Scoped to one commit, never to the pass: client code runs during adoption (an applier rendering, a component
 * setter rendering), and what it instantiates is fresh and must be written in full — `commitAs` clears it for them.
 */
let adopting = false;

/** Something adopted must be told when it goes away — an applier with `_$detach$` (the hydrate entry's setter). */
export const needRemovalWork = () => {
  notifyOnRemoval = true;
};

/** Commits one binding of adopted server markup. */
export const commitAdopting = (template: Template, bindings: unknown[], i: number, kind: number, values: unknown[]) => {
  adopting = true;
  try {
    commit(template, bindings, i, kind, values);
  } finally {
    adopting = false;
  }
};

/**
 * Refs held until the pass's DOM exists, as flat `(bindings, slot)` pairs: each is handed its element once that
 * element is inserted, upgraded and in its own document. A render flushes only what it queued, so a nested render
 * cannot apply its caller's early. Refs run in commit order, which is document PRE-order — `<div ${a}>${child}</div><p
 * ${b}>` runs a, then the child's refs, then b — not all parents first.
 */
let pendingRefs: unknown[] | null = null;
/**
 * **A `<select>`'s selection is written when the pass ends**, once its options exist. In document order a binding ON
 * the select comes before the options inside it, so a selection written in place — `.value`, `!value`,
 * `.selectedIndex`, or a spread's key — found no options and fell back to the first. Every source of options is
 * content inside the select (a list, a nested template, a keyed list: the content model allows only `<option>`,
 * `<optgroup>` and `<hr>`), so all of it exists when the pass ends. Options a user's code appends later are out of
 * scope.
 *
 * Flat PAIRS, one queue, in commit order. The common record is `(select, value)` for a `value` binding — compared
 * against the live value and written only on a difference (the write resets every option). The rare ones are
 * `(LATER, [select, index])` for `selectedIndex` and `(LATER, [applier, element, slot])` for a value applying itself
 * on a select, a spread. Flushed first, so a ref on the select sees its selection. A render flushes only what it
 * queued, however it ends, so nothing it held can land on a later, unrelated render.
 *
 * The shape is measured, on a table with a bound select per row (`.probe/renderer-lean/runs/race-late-*`): committing
 * each instance's selects after its own bindings, 2–4% slower; deferring the whole binding to a second commit,
 * 8–13%; records of three with the name in them, 3–6%. Pairs whose common case is exactly `(select, value)` tie.
 */
const LATER = {};
let pendingSelects: unknown[] | null = null;
const flush = (selectsFrom: number, refsFrom: number) => {
  const selects = pendingSelects;
  if (selects !== null && selects.length > selectsFrom) {
    const mine = selects.splice(selectsFrom);
    if (selects.length === 0) pendingSelects = null;
    for (let i = 0; i < mine.length; i += 2) {
      const a = mine[i];
      const b = mine[i + 1];
      if (a === LATER) {
        const r = b as unknown[];
        /** Read and written BY NAME: a computed `select[name]` on a DOM accessor measured 5% slower. */
        if (r.length === 2) {
          if ((r[0] as HTMLSelectElement).selectedIndex !== r[1]) (r[0] as HTMLSelectElement).selectedIndex = r[1] as number;
        } else if (__HYDRATING__) (r[0] as Applies)._$apply$(r[1] as Element, r[2] as Slot, untracked, r[3] === true);
        else (r[0] as Applies)._$apply$(r[1] as Element, r[2] as Slot, untracked);
      } else if ((a as HTMLSelectElement).value !== b) (a as HTMLSelectElement).value = b as string;
    }
  }
  /** Taken off first: a ref can render again. */
  const refs = pendingRefs;
  if (refs === null || refs.length <= refsFrom) return;
  const mine = refs.splice(refsFrom);
  if (refs.length === 0) pendingRefs = null;
  /** A ref is someone else's code: what it reads must not subscribe the render that handed it the element. */
  untracked(applyRefs, mine);
};

/**
 * Refs, and instance mounts, in commit order — once the pass's DOM exists, so a claim sees the finished tree. (A
 * claim that RELOCATES a node — elements', slots' — may run after refs inside it, so such a ref saw its element before
 * the move: the same element, but pre-claim geometry. Measure in a mount, or after the render, not in a ref.)
 */
const applyRefs = (mine: unknown[]) => {
  for (let i = 0; i < mine.length; i += 2) {
    const bindings = mine[i] as unknown[];
    const at = mine[i + 1] as number;
    if (typeof at !== 'number') {
      (mine[i] as InstanceHook).$m(at);
      continue;
    }
    const record = bindings[at] as Slot;
    const value = bindings[at + 1];
    record._state = 0;
    if (typeof value === 'function') applyRef(value as (element: Element | null) => void, record._element);
    else if (value !== null && typeof value === 'object' && value !== UNSET) (value as { value: unknown }).value = record._element;
  }
};

/**
 * The document the pass renders into — the container's own (a popped-out window's, an iframe's), so every
 * instance is built in its realm. Read off the container once per pass, never off a node that may still sit
 * in the inert template document.
 */
let passDoc: Document = doc;

/**
 * Preserves the DOM of a template a position toggles away from, instead of destroying it — form values
 * and media state survive the round trip. Anything that is not a template passes straight through, so
 * `hold(editing && editor())` is fine.
 *
 * ```js
 * html`<div>${hold(editing ? editor() : viewer())}</div>`
 * ```
 */
export const hold = <T>(result: T): T | { $h: TemplateResult } =>
  result != null && typeof result === 'object' && isTemplateResult(result) ? { $h: result as TemplateResult } : result;

/**
 * **Where an insert before `ref` goes** — the parent given, unless light-DOM slots moved `ref` (it marks what it moves,
 * `_$slotted$`, sigiled so both bundles read it): then `ref`'s own, which is where the light child now lives. A node
 * anything ELSE moved is not followed — the insert throws as it always has, rather than land in a stranger's container.
 */
const into = (parent: Node, ref: Node | null): Node =>
  ref !== null && (ref as { _$slotted$?: boolean })._$slotted$ ? ref.parentNode! : parent;

/** A fresh part whose two markers sit before `ref` in `parent`. */
const markered = (parent: Node, ref: Node | null) => {
  const end = comment();
  const part = new ChildPart(comment(), end);
  const at = into(parent, ref);
  at.insertBefore(part.$s!, ref);
  at.insertBefore(end, ref);
  return part;
};

/**
 * Commits `value` into `part` as a render of `root`: the root and its document are set and restored (a render
 * can run inside another's commit), and the work this pass queued is flushed however it ends — before the
 * restore, so a ref's error still names its own component and a ref that renders renders into this document.
 * `home` is where the document comes from when `root` is not the render being attributed: the container an
 * applier was attached under, even after the part has moved out of it (a parked `hold` fragment belongs to the
 * inert template document, and must never become the document a render builds in).
 */
const commitAs = (root: Node | null, part: ChildPart, value: unknown, home: Node | null = root) => {
  const outer = renderRoot;
  const outerDoc = passDoc;
  const selectsMark = pendingSelects?.length ?? 0;
  const refsMark = pendingRefs?.length ?? 0;
  const outerScope = scope;
  scope = null;
  /** A render nested inside an adopted binding's commit builds fresh DOM: it is never adopting (hydrate entry only). */
  const outerAdopting = __HYDRATING__ && adopting;
  if (__HYDRATING__) adopting = false;
  renderRoot = root;
  /** A document's own `ownerDocument` is null — so a document container is its own. */
  if (home !== null) passDoc = home.ownerDocument ?? (home as Document);
  try {
    part.$p(value);
  } finally {
    flush(selectsMark, refsMark);
    renderRoot = outer;
    passDoc = outerDoc;
    scope = outerScope;
    if (__HYDRATING__) adopting = outerAdopting;
  }
};

/**
 * **Hydration's bracket** — the hydrate entry's only way into the pass state, which another module cannot assign.
 * The same as `commitAs`, except that if `run` throws — a mismatch — everything the pass queued is dropped before
 * the flush, so a ref inside markup about to be discarded is
 * never handed its element. Unused by the base entry, so its bundle never carries it.
 */
export const adoptAs = (container: Node, run: () => void) => {
  const outer = renderRoot;
  const outerDoc = passDoc;
  const selectsMark = pendingSelects?.length ?? 0;
  const refsMark = pendingRefs?.length ?? 0;
  renderRoot = container;
  passDoc = container.ownerDocument ?? (container as Document);
  let adopted = false;
  try {
    run();
    adopted = true;
  } finally {
    if (!adopted) {
      if (pendingSelects !== null) pendingSelects.length = selectsMark;
      if (pendingRefs !== null) pendingRefs.length = refsMark;
    }
    flush(selectsMark, refsMark);
    renderRoot = outer;
    passDoc = outerDoc;
  }
};

const rootParts = new WeakMap<Node, ChildPart>();

/**
 * The container is the argument people forget, and forgetting it failed with `Cannot read properties of undefined`
 * — a message about the internals of a function the caller never named. Development only; the hydrate entry calls
 * it too, since it reads the container before it reaches the base render.
 */
export const expectContainer = (container: unknown) => {
  if (!container || typeof (container as Node).appendChild !== 'function')
    throw new TypeError(
      `renderInto: expected a container node as the second argument and received ${String(container)}. ` +
        `It renders *into* something — \`renderInto(html\`…\`, document.body)\`.`
    );
};

/**
 * Writes a template result into a container — the renderer's imperative draw: no reactivity, no
 * lifecycle. The first call appends two markers and anchors a root part between them; later calls reuse it
 * and commit only the values. Content already in the container stays, and so does content other code adds
 * after it — the render owns its range, never the container. lit-html's argument order.
 */
export const renderInto = (result: unknown, container: Node) => {
  if (__DEV__) expectContainer(container);
  if (__DEV__ && profileHook !== null) profileHook(PROFILE_FRAME_START, container, null);
  let part = rootParts.get(container);
  if (part === undefined) rootParts.set(container, (part = markered(container, null)));
  commitAs(container, part, result);
  /**
   * **A render has finished** — said to whatever asked (light-DOM slots, which re-distributes what this render did to
   * a host's light children before anything reads them, and at a container's first render takes what was there before
   * the render's own range — `start` — as its light children). Off-chain and sigiled, like `$t`: not an extension point.
   */
  (registry as { _$done$?: (container: Node, start: Node) => void } | null)?._$done$?.(container, part.$s!);
  if (__DEV__ && profileHook !== null) profileHook(PROFILE_FRAME_END, container, null);
};

/**
 * Marks the raw function so `wire(renderInto)` — wiring the draw instead of the module — is caught by name in
 * development: the inserts registry reads `$module` and says `did you mean \`renderer\``. Production carries neither.
 */
if (__DEV__) (renderInto as unknown as { $module?: string }).$module = 'renderer';

/** Everything this renderer needs, in one entry: `wire([renderer])`. */
export const renderer = {
  name: '@verajs/renderer',
  on: 'render' as const,
  fn: renderInto as never,
  priority: 50,
  /** Typed against the registry `wire` hands over, so `wire([renderer])` compiles in a consumer's project. */
  connect: (given: { get(name: never): unknown }) => {
    registry = given as { get(name: string): unknown[] | undefined };
    untracked = (given as { $t?: Untracked }).$t ?? call;
    /**
     * **The hydration hand-off** — the one door `hydration` reaches this renderer's internals through (a separately
     * bundled module cannot import them, and production mangles their names): only values the renderer already holds,
     * so it pulls no code in. Its fields are UPPERCASE single characters, so none reads like a part's own `$` fields.
     * `$V` is its protocol number; on a mismatch hydration declines and the page renders fresh, with a warning.
     */
    (given as { $H?: unknown }).$H = { $V: 1, $G: getTemplate, $C: ChildPart, $I: Instance, $M: commit, $A: commitAs, $U: hookUp, $Q: resolved, $O: rootParts, $T: toText };
  },
};
