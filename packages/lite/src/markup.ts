/**
 * **What the lite tier reads in a template's static text, and what it refuses to write.** Where a hole is, the HTML
 * PARSER says: a rough scan only picks each hole's MARKER form (a comment in text, a value mark inside a start tag), the
 * template is parsed once in a `<template>`, and each hole must land EXACTLY ONCE where its form can be filled
 * (`patch.ts`'s `prepare`). A marker the rough scan misplaces lands in raw text, a comment, a name, a template's content
 * or nowhere — missing — and the template is refused: a scan error can only refuse, never misplace a value. (This
 * replaced a verbatim twin of core's scanner grammar and a separate parser check, 2026-11-17: the static sketch's design,
 * when static was retired into lite.) The refusals are the full tier's (`@verajs/core` with its renderer), from
 * shared-utils' one grammar: a bound inline handler or `srcdoc` is never written, and a script URL on a URL-bearing name
 * is removed.
 */
import { INLINE_HANDLER, SCRIPT_URL, SCRIPT_URL_ITEM, SHARED, URL_SINK, attributeValueKind, diagnostic, eventKey, eventNameGuess, warnOnce } from '@verajs/shared-utils';
import { PROSE } from './diagnostics.js';

/**
 * The rough scan: a hole is in a tag when the source before it ends inside a start tag — a `<` and a letter, then no
 * `>` outside quotes (so `<a title="Next >" href=${url}>` stays in the tag). Wrong only toward a marker that is then
 * missing, so the template is refused, never misrendered. Its group is the open quote's text when the hole is inside
 * a quoted value (`undefined` when it is not).
 */
export const IN_TAG = /<[a-zA-Z](?:[^>"']|"[^"]*"|'[^']*')*("[^"]*|'[^']*)?$/;

/** The name of the attribute a hole's value starts in, AS WRITTEN (case kept: the parser lowercases), from the source before it. */
export const WRITTEN_NAME = /([^\s"'>/=]+)\s*=\s*(?:"[^"]*|'[^']*|[^\s"'>]*)$/;

/** A text hole's marker is a comment holding `\u0001` and its index; a value hole's is its index between two `\u0002`s. */
// eslint-disable-next-line no-control-regex -- the markers ARE control characters: ones no template's own text holds
export const TEXT_MARK = /^\u0001(\d+)$/;
/** A value hole's marker, inside an attribute value: its index between two `\u0002`s. */
// eslint-disable-next-line no-control-regex -- the same
export const VALUE_MARK = /\u0002(\d+)\u0002/g;
/** A text marker as it reads inside HTML's RCDATA or raw text, where the parser leaves the comment as text. */
// eslint-disable-next-line no-control-regex -- the same
export const TEXT_MARKS = /<!--\u0001(\d+)-->/g;

/**
 * Elements a value never enters, by name in ANY namespace (Brian, 2026-11-17): `script` (its text is code, unless a JSON
 * data block), and those whose content is never shown — `iframe`, `noscript`, a `template`'s inert content, the obsolete
 * raw-text four. Never walked, so a hole anywhere inside one is missing, and refused. Their own attributes bind.
 */
export const RAW = /^(?:script|iframe|noscript|xmp|noembed|noframes|plaintext|template)$/i;

/**
 * Elements whose content is TEXT, in any namespace (Brian, 2026-11-17): `title` (HTML's and SVG's accessible name),
 * `textarea`, and `style` — an author writing `<style>:host{--accent:${c}}</style>` means CSS. Their holes fill the
 * element's text, composed with its statics, never parsed.
 */
export const TEXT_ONLY = /^(?:title|textarea|style)$/i;

/** A script start tag, whole and quote-aware (a `>` inside a quoted value does not end it). */
export const SCRIPT_START = /<script\b(?:[^>"']|"[^"]*"|'[^']*')*>?/gi;

/**
 * The strings every FORGED template renders as: the text any object renders as (`[object Object]`), one shared literal.
 * Module state, immutable: shared so every forgery reuses one preparation. A REAL tagged literal, so it is frozen and
 * owns `raw` by the language's own rule — the forged-template rule holds for it by construction (and it is 31 B gz
 * smaller than building that shape by hand, 2026-11-17).
 */
const FORGED = ((strings: TemplateStringsArray) => strings)`[object Object]`;

/** A tagged template literal's strings: an array owning `raw` (core's check, identical). */
const literal = (strings: unknown) => Array.isArray(strings) && Object.hasOwn(strings, 'raw');

/**
 * **Only a tagged template literal is a template** — core's rule, identical (`@verajs/renderer`'s `getTemplate`, the check
 * Lit makes): its strings array OWNS `raw`, which `JSON.parse` cannot give an array. A value from JSON shaped like a
 * template result (an API field an attacker can turn into an object) otherwise rendered as MARKUP in the small tiers
 * (found 2026-11-17; unreleased). Asked on a call site's cache MISS, which a forged array always is, so a cached
 * template pays nothing. A forgery renders as `FORGED`'s text, never a throw (the value is attacker-controlled);
 * development says so (`forged-template`, core's words).
 */
export const genuine = (strings: TemplateStringsArray): TemplateStringsArray => {
  if (literal(strings)) return strings;
  if (__DEV__) console.warn(diagnostic('lite', 'a child value', 'forged-template', __DEV__ && SHARED.forgedTemplate()));
  return FORGED;
};

/**
 * **Development: a binding refused, said as core's renderer says it** (its codes and `SHARED`'s words; lite's own label,
 * as its other diagnostics) — a refusal nobody is told about reads as a bug (CODE-PRINCIPLES §11: `onclick=${fn}` doing
 * nothing). Said at preparation, once per call site and name, as core decides it when it prepares a template: `bound`
 * is the binding as `check` reads it (a sigil name as written, else the parser's attribute name).
 */
export const sayRefused = (element: Element, bound: string) => {
  const where = `<${element.localName}>`;
  if (/^[.!]__proto__$/.test(bound)) console.warn(diagnostic('lite', where, 'proto-binding', __DEV__ && SHARED.protoBinding(bound)));
  else if (/^[@.!?]/.test(bound)) return;
  else if (bound === 'srcdoc') console.warn(diagnostic('lite', where, 'srcdoc-attribute', __DEV__ && SHARED.srcdocAttribute('.srcdoc=${…}')));
  else if (INLINE_HANDLER.test(bound))
    console.warn(
      diagnostic('lite', where, 'handler-attribute',
        __DEV__ && SHARED.handlerAttribute(bound, `\`@${bound.slice(2)}=\${…}\` (or \`on${bound[2]!.toUpperCase()}${bound.slice(3)}=\${…}\`)`))
    );
};

/** Development: a script URL refused at commit, said as core's renderer says it (`script-url`), each time the refused value changes. */
export const sayScriptUrl = (element: Element, name: string) =>
  console.warn(diagnostic('lite', `<${element.localName}>`, 'script-url', __DEV__ && SHARED.scriptUrl(name)));

/** A name whose bound value would run or render as code, never written (an inline handler, `srcdoc`), as core refuses it. */
export const refusedName = (name: string) => INLINE_HANDLER.test(name) || name.toLowerCase() === 'srcdoc';

/**
 * The pattern a URL-bearing name's value is checked against, or `null` for any other name: a whole URL (`href`, `src`,
 * `action`, `formaction`, `xlink:href`, `data`) is checked whole, an animation value list (`to`, `from`, `by`,
 * `values`) item by item.
 */
export const urlCheck = (name: string) => {
  const sink = URL_SINK.exec(name);
  return sink === null ? null : sink[1] ? SCRIPT_URL : SCRIPT_URL_ITEM;
};

/**
 * **Development: core's value diagnostics, in core's words** (Brian, 2026-11-19: lite says them too — the same checks
 * and prose, shared from `@verajs/shared-utils`; production carries none of it). A boolean at a child position renders
 * as the word, said on each change to one (core's rule).
 */
export const sayBooleanChild = (value: unknown) => {
  if (typeof value === 'boolean') console.warn(diagnostic('lite', 'a child position', 'boolean-child', __DEV__ && SHARED.booleanChild(String(value))));
};
/** Development: a whole attribute value that is not text (a function, an array, a Date…), once per element, name and kind. */
export const sayAttributeValue = (element: Element, name: string, value: unknown) => {
  const kind = value == null ? null : attributeValueKind(element.localName, name, value);
  if (kind !== null) console.warn(diagnostic('lite', `<${element.localName}>`, 'attribute-value', __DEV__ && SHARED.attributeValue(name, kind, `.${name}=\${value}`)));
};
/**
 * Development: a handler that cannot listen (`@click=${'alert(1)'}` — `false`/`undefined` are the deliberate "none"), and
 * at a binding's FIRST handler a misspelled event name (`@clik`), once per tag and name — core's two checks.
 */
export const sayListener = (element: Element, name: string, value: unknown, first: boolean) => {
  if (value == null || value === false) return;
  if (typeof value !== 'function' && typeof (value as EventListenerObject).handleEvent !== 'function')
    console.warn(diagnostic('lite', `<${element.localName}>`, 'not-a-listener', __DEV__ && SHARED.notAListener(name, typeof value)));
  const best = first ? eventNameGuess(element, name) : null;
  if (best !== null) warnOnce('lite', `<${element.localName}>`, 'event-name-typo', __DEV__ && (() => SHARED.eventNameTypo(name, element.localName, best)), eventKey(element, name));
};

/**
 * Development: a value only core renders, in a text position — an object that is not a template or a list (a `keyed` or
 * `spread` result, a DOM node: rendered as its text here). Said once.
 */
export const onlyCore = (value: unknown) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
  /**
   * Template-SHAPED (it holds `strings`) but no template: a forgery (`JSON.parse`), said in core's words
   * (`forged-template`), or a wrapper around a real literal's strings, which only core's `hold`/`tag` build — a template
   * to core, text here (2026-11-19, Brian: a recorded difference, said in development).
   */
  const strings = (value as { strings?: unknown }).strings;
  if (strings !== undefined) {
    if (Array.isArray(strings) && Object.hasOwn(strings, 'raw'))
      warnOnce('lite', 'html', 'template-wrapper', __DEV__ && (() => SHARED.templateWrapper()), 'template-wrapper');
    else warnOnce('lite', 'html', 'forged-template', __DEV__ && (() => SHARED.forgedTemplate()), 'forged-template');
    return;
  }
  const what = 'an object value (a `keyed` or `spread` result, a DOM node)';
  warnOnce('lite', 'html', 'tier-needs-core', __DEV__ && (() => PROSE['tier-needs-core'](what)), what);
};
