/**
 * **The markup scanner** — finds the registered component tags in markup the server has just written,
 * and hands each one to the renderer that called it. Never an HTML parse: a walk that knows exactly
 * what a component render needs to know — quoted attribute values, comments, raw-text elements,
 * `<template>` contents, and where a component's children end.
 *
 * Moved out of the render pipeline unchanged in the lean rebuild (2026-09-28): it is finely tuned
 * parsing work, audited in place rather than rewritten, and the pipeline around it is what was rebuilt.
 * The per-component renderer is a parameter — both chains pass their own — so this file imports
 * nothing of the pipeline.
 */
import { RAW_TEXT_ELEMENTS as RAW_TEXT, registry } from './shim.js';
/** The attribute-name charset, from the parser that owns it — see `ATTRIBUTE` below. */
import { ATTRIBUTE_NAME } from './parse.js';
import { commentEnd } from './escaping.js';

/**
 * The index just past the `>` that closes the tag starting at `start`, respecting quoted attribute
 * values.
 *
 * `>` is legal unescaped inside an attribute value, and a regex that stops at the first one cuts
 * the tag in half: `<mark-comp title="x > y">` was read as a tag ending after `x `, giving the
 * component an attribute value of `"x` and leaving ` y">` behind as text next to it.
 */
const tagEnd = (markup: string, start: number): number => {
  let quote = '';
  for (let i = start + 1; i < markup.length; i++) {
    const char = markup[i];
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '>') return i + 1;
  }
  return markup.length;
};

/**
 * `name`, `name="v"`, `name='v'` and `name=v` — every form an author may have written.
 *
 * Only the double-quoted form used to be recognized. `<x-y a='one' b=two>` gave the child three
 * empty attributes *and invented two more*, because the value text fell through to the next
 * iteration and matched as a name.
 *
 * **The NAME charset comes from `parse.js`, which owns it.** This file kept its own `[\w:-]+`,
 * which is narrower than what a start tag may carry: `data-a.b="v"` split at the dot into
 * `data-a=""` and `b="v"`, so a nested component was rebuilt with attributes its author never
 * wrote and read `null` for the one they did — server-side only, silently (arc-2 run 2). The same
 * single-fact-two-copies shape as `RAW_TEXT_ELEMENTS` above, and the same fix.
 */
export const ATTRIBUTE = new RegExp(`(${ATTRIBUTE_NAME})(?:=(?:"([^"]*)"|'([^']*)'|([^\\s>]+)))?`, 'g');

/**
 * **How deep a component tree may nest before the server calls it a cycle.**
 *
 * A component that renders itself recurses without bound, and on a server that is a hung request
 * rather than a hung tab, so a limit has to exist. It is a **divergence from the client**, which has
 * no such limit — measured on both sides.
 *
 * **256, raised from 32.** A cycle recurses without bound, so 256 refuses it as surely as 32 did, a
 * few microseconds later; 32 was low enough for a real tree to reach — router children inside
 * design-system wrappers inside a card grid — and reaching it meant a 500 for a page that renders
 * fine in a browser. The ceiling is set *below where the client breaks*: the client managed ~340
 * levels before `RangeError`, so the server still fails first, and fails with a sentence rather than
 * a stack overflow. That ~340 is engine- and frame-dependent and not a constant to design against,
 * which is the argument for an explicit limit rather than waiting for our own stack to go.
 *
 * The client's own floor for a genuine cycle is the JavaScript stack — it built ~340 levels before
 * `RangeError: Maximum call stack size exceeded`, reported through the `'error'` insert. That number
 * is engine- and frame-dependent and cannot be relied on, which is the argument for the server
 * having an explicit limit rather than waiting for its own stack to go.
 *
 * Documented in the README, because a hard limit nobody can find is a 500 nobody can explain.
 */
const MAX_DEPTH = 256;

/**
 * Renders every registered component tag found in `markup` to declarative shadow DOM, spliced in
 * as strings right after each opening tag. Recursion covers components rendered by components.
 */
/**
 * **One scanner, two chains.** The synchronous render calls it with nothing and it behaves exactly
 * as it always has; the asynchronous one hands it an `emit` that records a promise and returns a
 * placeholder, substituting the real markup once everything has settled.
 *
 * This is what lets the two chains share the intricate half — comments, raw-text elements, nesting,
 * attribute spans — rather than keeping two copies of a parser that must agree forever. Two paths
 * drifting is the failure this package has spent a week deleting; a shared parser makes it
 * impossible for the parsing half rather than merely tested-against.
 *
 * **It costs the synchronous path nothing measurable**: a call through a parameter instead of a
 * direct one is ~6% of the scanning step, and the scanning step is a fraction of a percent of a
 * render. The alternative considered — collecting segments into an array for a caller to assemble —
 * was 1.85x on the same step and was rejected for it.
 *
 * @param markup @param depth
 * @param emit renders one component tag — its open tag and contents; the scanner writes the close tag
 */
/**
 * Where the element opened at `after` ends, counting nested opens of the same name — `[contentEnd,
 * elementEnd]`, or `null` when nothing closes it.
 *
 * Two callers, and they were one hand-rolled loop and one absence. `<template>` skips its content
 * whole; a COMPONENT tag needs the same span for the opposite reason — that span is its children,
 * and it has to be handed them rather than letting them trail it in the stream.
 *
 * The name boundary is checked, which the `<template>` loop did not do: `<templates>` counted as a
 * nested `<template>` and threw the depth off for the rest of the document.
 *
 * @param markup @param name @param after
 */
const matchingEnd = (markup: string, name: string, after: number): [contentEnd: number, elementEnd: number] | null => {
  const lower = markup.toLowerCase();
  const openTag = `<${name}`;
  const closeTag = `</${name}`;
  /** A tag name ends where a name character stops — anything else continues the name. */
  const boundary = (at: number): boolean => !/[\w-]/.test(lower[at] ?? '');
  let depth = 1;
  let at = after;
  while (depth > 0) {
    let nextOpen = lower.indexOf(openTag, at);
    while (nextOpen !== -1 && !boundary(nextOpen + openTag.length))
      nextOpen = lower.indexOf(openTag, nextOpen + openTag.length);
    let nextClose = lower.indexOf(closeTag, at);
    while (nextClose !== -1 && !boundary(nextClose + closeTag.length))
      nextClose = lower.indexOf(closeTag, nextClose + closeTag.length);
    if (nextClose === -1) return null;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      at = nextOpen + openTag.length;
      depth++;
    } else {
      at = markup.indexOf('>', nextClose) + 1 || markup.length;
      depth--;
      if (depth === 0) return [nextClose, at];
    }
  }
  return null;
};

export const renderComponentTags = (
  markup: string,
  depth: number,
  emit: (name: string, attrs: string, depth: number, children?: string) => string
): string => {
  if (depth > MAX_DEPTH)
    throw new Error(
      `ssr: component nesting exceeded ${MAX_DEPTH} levels. A component that renders itself ` +
        `recurses without bound, and on a server that is a hung request — so this refuses rather ` +
        `than waiting for the stack to go.\nIf the tree is genuinely this deep it renders fine in a ` +
        `browser, which has no such limit; that difference is in the @verajs/ssr README.`
    );
  /** No dash, no custom element — cheaper to ask than to walk the string and find nothing. */
  if (!markup.includes('-')) return markup;

  let out = '';
  let at = 0;
  while (at < markup.length) {
    const open = markup.indexOf('<', at);
    if (open === -1) {
      out += markup.slice(at);
      break;
    }
    out += markup.slice(at, open);

    /**
     * A comment is text. Markup inside one used to be rendered — a `<!-- <some-comp> -->` produced
     * a whole shadow template inside the comment, which is wasted work at best and breaks the
     * comment at worst.
     */
    if (markup.startsWith('<!--', open)) {
      const end = commentEnd(markup, open);
      const stop = end === -1 ? markup.length : end;
      out += markup.slice(open, stop);
      at = stop;
      continue;
    }

    const end = tagEnd(markup, open);
    const tagText = markup.slice(open, end);
    /**
     * **Folded, because a tag name in markup is case-insensitive and every decision below is not.**
     * This required a lower-case first letter, so `<PROBE-KID>` matched nothing at all and the tag
     * fell through as inert text — and with it every guard keyed on the name. A component inside an
     * upper-case `<SCRIPT>` or `<TEXTAREA>` was rendered into its source rather than left as text,
     * and `<TEMPLATE>` lost its skip, so components inside a template were rendered on the server
     * that the client's parser would never upgrade.
     */
    const name = /^<([a-zA-Z][\w]*(?:-[\w-]*)?)/.exec(tagText)?.[1]?.toLowerCase();

    /**
     * A `<template>` is a blueprint, not live DOM: the parser builds its content into a fragment
     * and never upgrades custom elements inside it. Rendering one there produced markup the client
     * would never produce, inside content whose whole purpose is to be stamped out later.
     *
     * Skipped depth-aware, because templates nest — the raw-text elements below cannot, so a
     * search for their closing tag is enough for them and would mis-nest here.
     */
    if (name === 'template') {
      const at2 = matchingEnd(markup, 'template', end)?.[1] ?? markup.length;
      out += markup.slice(open, at2);
      at = at2;
      continue;
    }

    /**
     * `<textarea>`, `<script>`, `<style>`, `<title>`: their content is text. A component named
     * inside one was rendered into it, so the markup showed up as the textarea's value or the
     * script's source.
     */
    if (name && RAW_TEXT.has(name)) {
      const closeTag = markup.toLowerCase().indexOf(`</${name}`, end);
      const stop = closeTag === -1 ? markup.length : closeTag;
      out += tagText + markup.slice(end, stop);
      at = stop;
      continue;
    }

    if (name && registry.has(name)) {
      /** Rewritten, not kept — the component may have changed its own attributes. */
      const attrs = tagText.slice(1 + name.length, -1);
      /**
       * **A nested component is handed its children**, exactly as `renderToString` hands them to
       * the top-level one. They used to trail it in the stream instead: the scanner emitted the
       * component's rendered markup and then walked its children as ordinary markup after it.
       *
       * For a shadow component that happens to serialize the same way, which is why it went
       * unnoticed. For a LIGHT component with slots it is wrong — the component never sees the
       * content it is supposed to distribute, so every slot renders its fallback and the user's
       * markup sits after the template. The CLIENT distributes it correctly, which made this a
       * server/client divergence: a visibly wrong first paint, and a hydration mismatch after it.
       * It also means a nested component can now read its own children in `connectedCallback`,
       * which on the client it always could.
       *
       * Malformed markup keeps the old path exactly — an unclosed or self-closing tag hands over
       * nothing and lets the stream carry on, so nothing the fuzz suites feed it changes shape.
       */
      const span = tagText.endsWith('/>') ? null : matchingEnd(markup, name, end);
      const children = span === null ? undefined : markup.slice(end, span[0]);
      out += emit(name, attrs, depth + 1, children);
      if (span !== null) {
        /** The close tag is consumed with the children, so it is written back here — normalized,
         *  like the open tag the component just rewrote. */
        out += `</${name}>`;
        at = span[1];
        continue;
      }
    } else {
      out += tagText;
    }
    at = end;
  }
  return out;
};
