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

import { adoptProperty, call, INLINE_HANDLER, isSelection, read, reportUncaught, SCRIPT_URL, URL_ATTRIBUTE } from '@verajs/shared-utils';
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
const TEXT_END = /<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g;
const COMMENT_END = /-->/g;
const COMMENT2_END = />/g;
/** `>`, or whitespace then an attribute name (with `=` and the start of its value), or the string's end. */
const TAG_END = />|[ \t\n\f\r](?:([^\s"'>=/]+)([ \t\n\f\r]*=[ \t\n\f\r]*(?:[^ \t\n\f\r"'`<>=]|("|')|))|$)/g;
const DOUBLE_QUOTE_END = /"/g;
const SINGLE_QUOTE_END = /'/g;
/**
 * Elements whose content the parser reads as TEXT, so a comment marker cannot live there: the scan
 * writes a text marker and construction turns it into an anchor. `noscript` because Firefox parses it
 * as raw text in a template while Chromium and WebKit do not — listed, it is right in both.
 */
const RAW_TEXT = /^(?:script|style|textarea|title|iframe|noscript)$/i;

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
class Template {
  /** What an instance clones: the single root element, or the whole content fragment. */
  _root: Node;
  /** No element in it can be custom — see `instantiate`. */
  _plain = true;
  _kinds: number[];
  _names: string[];
  /** The statics around a bound attribute's values; `null` for one full-value expression. */
  _statics: (string[] | null)[];
  /** Child-index hops from `_root` to each binding's node. */
  _paths: number[][] = [];
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
  _x = false;
  /** Namespaces' resolver: which template to build at a position, given its parent. */
  declare _$at$?: (parent: Node) => Template;
  /** The namespace this template was parsed in, for a resolver asked about a detached fragment. */
  declare _$ns$?: string | null;
  /** The instance hook — elements (and slots): claim at creation, mount at the render's end, unmount at teardown. */
  declare _$inst$?: InstanceHook;

  constructor(result: TemplateResult) {
    const strings = result.strings;
    const count = strings.length - 1;
    const kinds = (this._kinds = new Array(count).fill(IGNORED));
    const names = (this._names = new Array(count).fill(''));
    const statics = (this._statics = new Array(count).fill(null));
    const present = (this._present = new Array(count).fill(false));
    const urls = (this._urls = new Array(count).fill(0));
    const nodes: (Node | null)[] = new Array(count).fill(null);

    // ── scan ──
    let markup = '';
    let regex = TEXT_END;
    let rawEnd: RegExp | undefined;
    /** The previous binding opened an UNQUOTED value, so a string that matches nothing continues it (`a=${x}${y}`). */
    let open: boolean = false;
    for (let i = 0; i < count; i++) {
      const s = strings[i];
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
            if (match[2] !== undefined && RAW_TEXT.test(match[2])) rawEnd = new RegExp(`</${match[2]}`, 'gi');
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
      } else if (nameEnd === -2) markup += `${s} ${i}${MARKER}`;
      else if (continues || regex !== TAG_END) markup += s + MARKER; // another value of the attribute a previous binding opened
      /** A tag-name or attribute-name position (`<${x}>`, `<b data-${x}="1">`): no marker — the value is consumed and ignored. */
      else markup += s;
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
      if (el.localName === 'template') (el as HTMLTemplateElement).innerHTML = (el as HTMLTemplateElement).innerHTML.replace(INERT_MARKERS, '');
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
        kinds[i] = kind;
        names[i] = real;
        statics[i] = value.length === 2 && value[0] === '' && value[1] === '' ? null : value;
        present[i] = kind === ATTR && el.hasAttribute(real);
        /**
         * A custom element's `src` or `data` PROPERTY is its own business — often an object (`.data=${rows}`) —
         * so only a string is checked there, and nothing else is converted; everywhere else the value is converted once.
         */
        urls[i] =
          kind === REFUSED || kind === BOOLEAN || kind === EVENT || !URL_ATTRIBUTE.test(real)
            ? 0
            : kind !== ATTR && el.localName.includes('-')
              ? 2
              : 1;
      }
      /** A raw-text element's markers arrived as characters: rebuild its content with anchors in their place. */
      if (RAW_TEXT.test(el.localName) && el.textContent!.includes(MARKER)) {
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
    const root = (this._root = first !== null && first.nodeType === 1 && first.nextSibling === null ? first : content);
    for (let i = 0; i < count; i++) {
      let at = nodes[i];
      if (at === null) {
        if (__DEV__ && (kinds[i] === CHILD || names[i] !== ''))
          console.warn(
            `[vera] renderer: the value at position ${i} sits inside a nested <template>'s content — inert markup that is ` +
              `never rendered — so it is ignored (and the server ignores it too). Render into the live tree instead.`
          );
        kinds[i] = IGNORED;
      } else if (kinds[i] === CHILD) {
        const parent = at!.parentNode!;
        /**
         * Only on a PLAIN element (no dash, no `is`): a light-DOM component renders into its own children, and the part
         * this position may become owns its element's whole content — so there it keeps its anchor, bounded by markers.
         */
        const host = parent as Element;
        if (
          parent.nodeType === 1 &&
          parent.childNodes.length === 1 &&
          !RAW_TEXT.test(host.localName) &&
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
      this._paths.push(path);
    }
    /**
     * **The `'template'` insert** — asked once, as each template is built (cold): a hook may set `_$at$`/`_$inst$`.
     * A module wired AFTER a template was built never hears about it; development says so at `wire` (core reads the
     * mark below).
     */
    if (__DEV__ && registry !== null) (registry as unknown as { $b?: boolean }).$b = true;
    const hooks = registry?.get('template') as TemplateHook[] | undefined;
    /**
     * Marked whenever a hook exists, not only when one set a resolver or an instance hook here: a variant parsed in
     * another namespace carries only its namespace (`_$ns$`), and its instances must still set the create scope, or a
     * position at its top level cannot be resolved.
     */
    if (hooks !== undefined && hooks.length > 0) {
      for (let i = 0; i < hooks.length; i++) hooks[i](this, result, readScope, root);
      this._x = true;
    }
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
const getTemplate = (result: TemplateResult) => {
  let template = templateCache.get(result.strings);
  if (template === undefined) templateCache.set(result.strings, (template = new Template(result)));
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
  _root: Node;
  _bindings: unknown[];
  constructor(template: Template, strings: TemplateStringsArray, root: Node, bindings: unknown[]) {
    this._template = template;
    this._strings = strings;
    this._root = root;
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
  const source = template._root;
  const root = template._plain && owner === doc ? source.cloneNode(true) : owner.importNode(source, true);
  const kinds = template._kinds;
  const paths = template._paths;
  const marked = template._x;
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
  instance._bindings[instance._template._kinds.length * 2] = state;
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
  const kinds = template._kinds;
  const statics = template._statics;
  const bindings = instance._bindings;
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i];
    if (kind !== IGNORED && (kind >= LIVE || statics[i] !== null || values[i] !== bindings[i * 2 + 1]))
      commit(template, bindings, i, kind, values);
  }
};

/** Commits the binding at value position `i`. */
const commit = (template: Template, bindings: unknown[], i: number, kind: number, values: unknown[]) => {
  const slot = i * 2;
  const committed = bindings[slot + 1];
  const node = bindings[slot];
  if (kind <= SOLE) {
    const value = values[i];
    if (committed === UPGRADED) (node as ChildPart)._set(value);
    else if (value == null || typeof value === 'object') {
      /** A template, list, node or nothing: the position becomes a full part, anchored where its text was. */
      let part: ChildPart;
      if (kind === SOLE) {
        /** Its plain element's whole content is this binding's: the element is the range, and no comment is added. */
        part = new ChildPart(null, null);
        if (committed === UNSET) part._owner = node as Element;
        else {
          part._owner = (node as Text).parentNode;
          part._mode = TEXT;
          part._text = node as Text;
          part._value = committed;
        }
      } else {
        part = markered((node as Text).parentNode!, node as Text);
        (node as Text).parentNode!.insertBefore(node as Text, part._end);
        part._mode = TEXT;
        part._text = node as Text;
        part._value = committed;
      }
      bindings[slot] = part;
      bindings[slot + 1] = UPGRADED;
      part._set(value);
    } else if (value !== committed) {
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
  const name = template._names[i];
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
  if (url === 1 && value != null && typeof value !== 'string') value = `${value}`;
  if (url !== 0 && typeof value === 'string' && SCRIPT_URL.test(value)) {
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
    if (value != null) element.setAttribute(name, value as string);
    /** A fresh clone carries no attribute to remove unless the template itself wrote one. */
    else if (committed !== UNSET || template._present[i]) element.removeAttribute(name);
  } else if (kind === PROPERTY) (element as unknown as Record<string, unknown>)[name] = value;
  else if (kind === BOOLEAN) element.toggleAttribute(name, !!value);
  else if (kind === EVENT) {
    const listener = node as Slot;
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
    if ((value as { _$apply$?: unknown })._$apply$) {
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
  const kinds = instance._template._kinds;
  const bindings = instance._bindings;
  /** An instance hook is told, with its state: it unmounts what it mounted, and one not yet mounted never mounts. */
  if (instance._template._x) {
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
 * content (`_owner`, no markers at all).
 *
 * **The ownership invariant — whoever writes an element's content owns it, and owns its verification.** Two cases:
 * a PLAIN element whose whole content is one binding belongs to that binding (the part is its range, and hydration
 * adopts it with no markers); a CUSTOM element's children belong to the component (a binding inside it keeps its
 * markers, and hydration compares them only when the template itself writes content inside the tag). Slots (piece 8)
 * inherit both.
 */
class ChildPart {
  _start: Comment | null;
  _end: Node | null;
  /** The element this part owns entirely (a SOLE position), or `null` for a part between markers. */
  _owner: Node | null = null;
  _mode = EMPTY;
  _value: unknown = undefined;
  _text: Text | null = null;
  _instance: Instance | null = null;
  _items: Item[] | null = null;
  /** The key a keyed list reads when this part is one of its items. */
  $k: unknown = undefined;
  /** Instances `hold()` parked here, by template identity — they outlive interim content. */
  _held: Map<TemplateStringsArray, Instance> | null = null;
  /** Whatever the last `_$child$` applier returned here (its continuity), and which applier that was. */
  _applierState: unknown = undefined;
  _applier: unknown = undefined;
  /** The container whose render attached the applier — a later `_$commit$` runs as a render of it. */
  declare _root?: Node | null;

  constructor(start: Comment | null, end: Node | null) {
    this._start = start;
    this._end = end;
  }

  _insert(node: Node) {
    (this._owner ?? this._start!.parentNode!).insertBefore(node, this._end);
  }

  /**
   * Tells the CURRENT content that it is going away — the part itself stays, so what `hold()` parked here stays
   * parked and can still come back. Reached only when `notifyOnRemoval` is set.
   */
  _detach() {
    if (this._applier !== undefined) (this._applier as Applier)._$detach$?.(this._applierState);
    if (this._instance !== null) teardown(this._instance);
    const items = this._items;
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
    const owner = this._owner;
    const start = this._start!;
    const end = this._end;
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
    this._mode = EMPTY;
    this._text = null;
    this._instance = null;
    this._items = null;
    this._applierState = undefined;
    this._applier = undefined;
  }

  /**
   * How a `_$child$` applier renders — `_$`-named so it survives mangling, because third parties call
   * it. Its own state survives its own commit. A commit that arrives outside its container's render (an
   * applier resolving later) runs as a render of that container, while it still contains the part.
   */
  _$commit$(value: unknown) {
    const applierState = this._applierState;
    const applier = this._applier;
    if (renderRoot !== this._root || renderRoot === null)
      commitAs(this._root != null && this._root.contains(this._owner ?? this._start) ? this._root : null, this, value, this._root ?? null);
    else this._set(value);
    this._applierState = applierState;
    this._applier = applier;
  }

  _set(value: unknown) {
    if (value == null) {
      if (this._mode !== EMPTY) this._clear();
      return;
    }
    if (typeof value !== 'object') {
      if (this._mode === TEXT) {
        if (this._value !== value) this._text!.data = value as string;
      } else {
        if (this._mode !== EMPTY) this._clear();
        this._insert((this._text = doc.createTextNode(value as string)));
        this._mode = TEXT;
      }
      this._value = value;
      return;
    }
    /** `hold()` wraps a template as `{ $h }`: the one it replaces is parked by template identity, not destroyed. */
    const held = (value as { $h?: TemplateResult }).$h;
    if (held !== undefined || isTemplateResult(value)) {
      const result = held ?? (value as TemplateResult);
      /** The hottest line of a list update: same strings, commit the values and nothing else. */
      if (this._mode === TEMPLATE && this._instance!._strings === result.strings) {
        update(this._instance!, result.values);
        return;
      }
      let instance: Instance | undefined;
      if (held !== undefined) {
        const parked = (this._held ??= new Map());
        if (this._mode === TEMPLATE) {
          const current = this._instance!;
          const root = current._root;
          /** A fragment root takes its nodes back; an element root IS the range. */
          if (root.nodeType === 11) {
            let node = this._owner !== null ? this._owner.firstChild : this._start!.nextSibling;
            while (node !== this._end) {
              const next = node!.nextSibling;
              root.appendChild(node!);
              node = next;
            }
          } else (root as ChildNode).remove();
          parked.set(current._strings, current);
          this._mode = EMPTY;
        }
        /** The map holds exactly what is PARKED: an instance coming back leaves it, so a later clear cannot strand it there. */
        instance = parked.get(result.strings);
        if (instance !== undefined) parked.delete(result.strings);
      }
      if (this._mode !== EMPTY) this._clear();
      if (instance === undefined) {
        let template = getTemplate(result);
        if (template._x) template = resolved(template, this._owner ?? this._start!.parentNode!);
        instance = instantiate(template, result, passDoc);
        this._insert(instance._root);
      } else {
        /** Inserted first, then updated, as every update is: its nodes are live when its values commit. */
        this._insert(instance._root);
        update(instance, result.values);
      }
      this._instance = instance;
      this._mode = TEMPLATE;
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
      const previous = this._applier === applyChild ? this._applierState : undefined;
      this._applier = applyChild;
      this._root = renderRoot;
      if (applyChild._$detach$ !== undefined) notifyOnRemoval = true;
      this._applierState = applyChild.call(value, this, previous);
      return;
    }
    if ((value as Node).nodeType !== undefined) {
      if (this._mode !== NODE || this._value !== value) {
        if (this._mode !== EMPTY) this._clear();
        this._insert(value as Node);
        this._value = value;
        this._mode = NODE;
      }
      return;
    }
    this._set(String(value));
  }

  /** Creates one list item before `ref`. */
  $c(value: unknown, parent: Node, ref: Node | null): Item {
    if (value !== null && typeof value === 'object' && isTemplateResult(value)) {
      let template = getTemplate(value);
      if (template._x) template = resolved(template, parent);
      if (template._root.nodeType === 1) {
        const instance = instantiate(template, value, passDoc);
        parent.insertBefore(instance._root, ref);
        instance.$k = value.key;
        return instance;
      }
    }
    const part = markered(parent, ref);
    part._set(value);
    part.$k = (value as TemplateResult | null)?.key;
    return part;
  }

  /** Commits `value` into an item; returns the item now standing there (an instance whose shape changed becomes a part). */
  $u(item: Item, value: unknown): Item {
    if (item instanceof ChildPart) {
      item._set(value);
      return item;
    }
    if (value !== null && typeof value === 'object' && (value as TemplateResult).strings === item._strings) {
      update(item, (value as TemplateResult).values);
      return item;
    }
    const element = item._root as Element;
    const part = markered(element.parentNode!, element);
    /** The row's shape changed: the instance is gone for good, so what it holds is told. */
    if (notifyOnRemoval) teardown(item);
    element.remove();
    part.$k = item.$k;
    part._set(value);
    return part;
  }

  /** The item's first node — its move handle and the insertion reference before it. */
  $f(item: Item): Node {
    return item instanceof ChildPart ? item._start! : item._root;
  }

  /** Moves an item before `ref`. */
  $m(item: Item, ref: Node | null, parent: Node = this._owner ?? this._start!.parentNode!) {
    if (!(item instanceof ChildPart)) {
      parent.insertBefore(item._root, ref);
      return;
    }
    let node: Node | null = item._start!;
    const stop = item._end!.nextSibling;
    while (node !== stop) {
      const next: Node | null = node!.nextSibling;
      parent.insertBefore(node!, ref);
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
    if (this._mode !== LIST) {
      if (this._mode !== EMPTY) this._clear();
      this._items = [];
      this._mode = LIST;
    }
    const items = this._items!;
    if (count === 0) {
      if (items.length) {
        this._clear();
        this._items = [];
        this._mode = LIST;
      }
      return;
    }
    const parent = this._owner ?? this._start!.parentNode!;
    const end = this._end;
    if (strategy !== undefined) {
      this._items = strategy(this, values, items, parent, end);
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

/** A fresh part whose two markers sit before `ref` in `parent`. */
const markered = (parent: Node, ref: Node | null) => {
  const end = comment();
  const part = new ChildPart(comment(), end);
  parent.insertBefore(part._start!, ref);
  parent.insertBefore(end, ref);
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
    part._set(value);
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
 * Writes a template result into a container — the renderer's imperative draw: no reactivity, no
 * lifecycle. The first call appends two markers and anchors a root part between them; later calls reuse it
 * and commit only the values. Content already in the container stays, and so does content other code adds
 * after it — the render owns its range, never the container. lit-html's argument order.
 */
export const renderInto = (result: unknown, container: Node) => {
  let part = rootParts.get(container);
  if (part === undefined) rootParts.set(container, (part = markered(container, null)));
  commitAs(container, part, result);
};

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
  },
};
