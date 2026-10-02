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
import { registry } from './shim.js';
/** The attribute-name charset, from the parser that owns it — see `ATTRIBUTE` below. */
import { ATTRIBUTE_NAME } from './parse.js';
import { freshScan, scanTag } from './tokenizer.js';
import type { ScannedTag } from './types.js';


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
 * single-fact-two-copies shape this file's own tag walk had with the tokenizer, and the same fix.
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

  /**
   * **The tags come from the server's one tag scanner** (`tokenizer.ts`), so this reads markup where the browser
   * does. It used to walk the markup with its own copy — a quote-aware tag end, a name pattern, a comment skip, a
   * `<template>` skip and a raw-text skip — and each part drifted: `<b x"><x-kid>` read the quote as opening a value
   * and missed the live component; `<x-kid.y>` stopped the name at the dot, rendered `x-kid` and rewrote the tag as
   * `<x-kid .y="">`; `</textareax>` and `</scripts>` ended raw text, so a component was rendered into a textarea's
   * value and a script's source; and `<svg><x-kid>` was rendered, where the browser never upgrades a foreign element.
   * Comments, raw text, `<template>` content, quoted values, foreign content and its integration points
   * (`<svg><foreignObject><x-kid>` IS live) are now the scanner's answers, the same ones every template gets.
   */
  const tags: ScannedTag[] = [];
  scanTag(markup, freshScan(0), undefined, tags);
  let out = '';
  let at = 0;
  for (let k = 0; k < tags.length; k++) {
    const tag = tags[k];
    if (!tag.live || !registry.has(tag.name)) continue;
    const { name } = tag;
    const tagText = markup.slice(tag.at, tag.end);
    /** Rewritten, not kept — the component may have changed its own attributes. */
    const attrs = tagText.slice(1 + name.length, -1);
    out += markup.slice(at, tag.at);
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
     * Its children end at the matching end tag of its name, counting nested elements of the same name — read from
     * the same scan, so a `</x-kid>` inside a comment, a `<template>` or an attribute value is not one. Malformed
     * markup keeps the old path exactly — an unclosed or self-closing tag hands over nothing and lets the stream carry
     * on, so nothing the fuzz suites feed it changes shape.
     */
    let close = -1;
    if (!tagText.endsWith('/>'))
      for (let open = 1, j = k + 1; j < tags.length; j++)
        if (tags[j].name === name && (tags[j].closing ? --open : ++open) === 0) {
          close = j;
          break;
        }
    out += emit(name, attrs, depth + 1, close === -1 ? undefined : markup.slice(tag.end, tags[close].at));
    if (close === -1) at = tag.end;
    else {
      /** The close tag is consumed with the children, so it is written back here — normalized, like the open tag the component just rewrote. */
      out += `</${name}>`;
      at = tags[close].end;
      k = close;
    }
  }
  out += markup.slice(at);
  return out;
};
