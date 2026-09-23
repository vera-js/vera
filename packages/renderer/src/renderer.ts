/**
 * @verajs/renderer — a ground-up, keyed, template-identity renderer.
 *
 * Replaces the Reef-derived renderer, which flattened every template to an HTML string and
 * re-parsed it on each change — O(whole template) work for a one-row edit, measured at 85 ms for a
 * two-row swap that lit-html does in 3.5 ms.
 *
 * The architecture here is the one that wins that benchmark:
 *
 *   1. A tagged template literal's `strings` array is frozen and IDENTICAL for every call from the
 *      same call site, so it is a cache key for the template's static shape. The shape is parsed
 *      ONCE into a `<template>` element with markers where the expressions go.
 *   2. Rendering clones that template and binds "parts" to the marker positions. Every later render
 *      of the same shape only compares and commits the dynamic values — static content is never
 *      touched again.
 *   3. Arrays reconcile KEYED (see `keyed()`), with head/tail fast paths and map-based moves, so a
 *      reorder moves nodes instead of rebuilding them.
 *
 * Built in, where lit-html requires directive imports: keyed list reconciliation (`keyed`),
 * element refs (element-position expressions), toggled-DOM preservation (`hold`), and a
 * whole-range fast clear — one `textContent = ''` where lit removes thousands of nodes one at a
 * time. Like-for-like (lit-html + repeat + ref + cache: 5 021 B gzip), this file is ~28% smaller.
 *
 * What it deliberately does NOT have, which is why it is smaller than lit-html: no directive
 * protocol, no `noChange`/`nothing` sentinels (in a single-expression attribute, `null`/`undefined`
 * REMOVE the attribute; in a child, they clear it), no sanitizer indirection, no async parts, no
 * dev-mode branches.
 *
 * Known limits, deliberate and shared with lit-html's envelope: no bindings inside comments (the
 * value is consumed and ignored), no dynamic tag names, and nested `<template>` elements' contents
 * are not traversed.
 *
 * CONTRACTS THE SPEED PAYS FOR — these are the trade, documented rather than discovered:
 *
 * - **The renderer owns its container below the mount point.** The whole-range fast clear wipes
 *   everything in a parent the part fully owns, including nodes user code appended there by hand
 *   (lit-html would preserve them). Same contract as mounting Vue or React into a container.
 * - **Do not call `Node.normalize()` on rendered content.** Child anchors are text nodes, and
 *   normalize merges adjacent text — lit-html's comment anchors are immune to this; ours are not.
 * - **A plain string renders as text, never as HTML.** The Reef renderer parsed strings as markup;
 *   this one has no innerHTML sink at all (an XSS class removed). The deliberate escape hatch for
 *   trusted markup is a property binding: `.innerHTML=${trusted}`.
 * - **Hydration is automatic and markerless.** The first render into a container that already has
 *   children adopts them as server output of the same template (statics matched byte-for-byte,
 *   anchors installed by splitting live text at known value positions), falling back to a clean
 *   render on any mismatch. Requires the initial client render to match server state — same
 *   contract as React/Vue hydration.
 * - **No directive protocol.** The template language itself is closed to extension — Vera extends
 *   at the framework layer (inserts) and through element refs, not inside the renderer's value
 *   handling.
 * - Event handlers are invoked with `this` bound to the ELEMENT (lit binds its host).
 *
 * NAMING NOTE: internal class fields and methods are `_`-prefixed because the production build
 * mangles properties matching /^_[a-z]/ (see defaultRollupConfig). That is what lets this file use
 * full descriptive names while still shipping one-letter properties — locals and top-level names
 * are mangled by default anyway, but property names are not. `_$litType$` and `handleEvent`
 * deliberately do not match the pattern: the first is an interop wire format, the second is called
 * by the DOM itself.
 */

import { attributeValueComplaint } from './dev-values.js';

import type { Part, SlotSeamState, TemplateResult } from './types.js';

export type { Part, SlotSeamState, TemplateResult } from './types.js';


/**
 * Preserves the DOM of templates a child position toggles away from, instead of destroying it —
 * form values, scroll positions and media playback survive the round trip (lit-html calls this
 * `cache`). Stashed DOM is parked in its instance's own fragment and re-adopted on return.
 *
 * ```js
 * html`<div>${hold(editing ? editor() : viewer())}</div>`
 * ```
 *
 * **Anything that is not a template passes straight through.** There is nothing to park for a
 * string, a list, `null` or `false`, and the branch that produces one is the ordinary shape of the
 * expression this wraps — `hold(editing && editor())`, `hold(row ?? null)`. Wrapping those handed
 * the renderer a `{ $h }` carrying a non-template, which reached the held-commit path and threw on
 * `result.strings`: a whole render lost, from a value the same expression renders happily one
 * character to the left. Decided here rather than in the renderer so the hot path pays nothing.
 */
export const hold = <T>(result: T): T | { $h: TemplateResult } =>
  result != null && typeof result === 'object' && isTemplateResult(result)
    ? { $h: result as TemplateResult }
    : result;

/**
 * Unique per module load, so user text can never collide with it. Randomness here cannot break
 * template caching — the marker only ever pairs a scan with its own Template construction.
 */
// eslint-disable-next-line no-bitwise -- >>> 0 is the integer truncation, not arithmetic
const MARKER = '$v' + ((Math.random() * 1e9) >>> 0).toString(36) + '$';
/** `<?xyz>` parses as a bogus comment whose data is `?xyz`. */
const MARKER_COMMENT_DATA = '?' + MARKER;

const doc = document;
const comment = (data = '') => doc.createComment(data);

/**
 * One walker for every template construction, re-aimed by assigning `currentNode`. Traversal of a
 * detached fragment cannot escape it — ascent stops at a null parent — and no walk is ever
 * re-entered mid-flight: an inner instantiation only begins after the outer walk has finished
 * collecting its parts.
 */
const markerWalker = doc.createTreeWalker(doc, 129 /* ELEMENT | COMMENT */);
/**
 * Second shared walker for indexing and instantiation. Templates ship with NO marker comments —
 * every child slot's anchor is its primed text node — so instances index over elements and texts.
 * Marker comments exist only transiently during template construction, and are created lazily at
 * runtime only if a slot upgrades from text to template/array content. Sharing the walker saves a
 * TreeWalker allocation per instance, which is 10 000 allocations in a 10 000-row create.
 */
const instanceWalker = doc.createTreeWalker(doc, 5 /* ELEMENT | TEXT */);

/**
 * Elements whose children a parser reads as **text**, so a marker written inside one arrives as
 * characters rather than a comment and the binding never becomes a part.
 *
 * `iframe` and `noscript` were missing, and both were measured broken in a browser rather than
 * reasoned about: `html\`<iframe>${v}</iframe>\`` painted the literal marker — `<?$v8hpsho$>` — onto
 * the page in **all three engines** and never updated.
 *
 * **`noscript` is the one worth the comment, because the engines disagree.** A template's contents
 * are parsed with the scripting flag *disabled*, which is what decides whether `noscript` is raw
 * text — and Chromium and WebKit parse it as markup there while Firefox parses it as text. So
 * `html\`<noscript>${v}</noscript>\`` worked in two engines and painted the marker in the third: an
 * app developed in Chrome shipping the framework's internals onto the page for Firefox users.
 *
 * Listing it here is safe in both parses. Where the marker became a comment the raw-text branch does
 * not trigger, because it looks for the marker in `textContent` and finds none.
 *
 * **The rule is deliberately ONE rule, and the scanner and the parse must share it.**
 *
 * Both sites read THIS regex and nothing else — namespace-blind and identical in both builds. The
 * scan writes a TEXT marker inside a raw-text element, because a comment cannot be parsed there;
 * the parsed-tree pass finds the same elements by the same test and turns that text back into real
 * marker comments. Neither consults a namespace.
 *
 * It is wrong in foreign content — `<title>` holds MARKUP inside an `<svg>`, measured in all three
 * engines — and making it namespace-aware was tried, measured, and reverted. The attempt taught the
 * scan to skip raw text while inside an `<svg>`, keyed on the `foreign` depth counter — which is
 * incremented only under `__DEV__`, because it exists to gate `warnTagShape` and nothing else,
 * while the parsed-tree pass went on matching this regex in both builds. The two then disagreed by
 * BUILD: an inline `` svg`<title>${x}` `` scanned one way in development and the other in
 * production, and the shipped bundle rendered the raw marker sentinel into the DOM and shifted
 * every later child binding by one — silently, in the canonical accessible-icon shape.
 *
 * Both halves being wrong together is self-consistent; half-fixing it is not. It is why a
 * hand-written `` svg`<title>${x}` `` behaves exactly as it always has — the binding is text, so it
 * is found and committed, the one shape this rule gets right by being wrong twice.
 *
 * What it cannot survive is an ELEMENT inside a `<title>`. The browser really does parse one there,
 * so `<title>`'s `textContent` — which includes its descendants' — still holds the marker, and the
 * pass clears that `textContent` to rebuild the parts, taking the element with it. Hence a dropped
 * `<tspan>`, a binding's sigil stranded as a dead attribute, and a throwing spread. `@verajs/jsx`
 * refuses to upgrade a root over that ONE shape for exactly this reason; everything else about
 * `<title>` it treats as the integration point it is.
 */
const RAW_TEXT_TAGS = /^(?:script|style|textarea|title|iframe|noscript)$/i;


/**
 * The void elements, as a regex rather than the `Set` in `@verajs/shared-utils`, and NOT imported
 * from it — measured: an imported `new Set([...])` survives production because neither rollup nor
 * terser can prove the constructor call is side-effect-free, so it sat at module scope costing
 * **62 B gzipped on the base bundle** for a diagnostic production does not even run. A regex
 * literal read only by `warnTagShape` goes when that dead function goes.
 *
 * So this is a second home for a fact `@verajs/shared-utils` owns, kept deliberately and in a
 * different SHAPE because a hot file's byte budget forbids the shared one. That is only acceptable
 * with an enforcer: `tests/markup-grammar-homes.test.mjs` drives this regex and the canonical set
 * against each other, member by member, in both directions.
 */
const VOID_TAGS = /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;
const ATTR_NAME_DELIMITER = /[\s"'>=/]/;

/** What an expression position turned out to be. */
const CHILD = 0;
const ATTRIBUTE = 1;
const IGNORED = 2; // value consumed, nothing rendered (bindings inside comments, junk positions)

/**
 * `_tag` is `__DEV__` only and exists for one diagnostic: when the HTML parser DROPS the element a
 * binding was written on, the binding's marker never reaches the parsed tree, and the warning below
 * needs to name the element the author actually wrote rather than only the symptom.
 */
type Spec = ({ _type: 0 } | { _type: 1; _name: string } | { _type: 2 }) & { _tag?: string };

/** Scanner states. */
const IN_TEXT = 0;
const IN_TAG = 1;
const IN_QUOTED_VALUE = 2; // a static quoted attribute value (no binding seen yet)
const IN_COMMENT = 3;
const IN_RAW_TEXT = 4; // inside <script>/<style>/<textarea>/<title>
const IN_BOUND_VALUE = 5; // collecting a bound attribute's statics

/**
 * One pass over the template strings, producing parseable HTML with markers plus an ordered spec
 * list. Runs once per template shape, so clarity beats micro-optimisation here.
 *
 * A small state machine rather than tail regexes, because `>` inside quoted attribute values and
 * inside comments must not terminate a tag, and raw-text elements swallow markup.
 */
/**
 * `__DEV__` only: the two ways a hand-written template describes a tree the parser will not build.
 *
 * `@verajs/jsx` normalises both at compile time, so this is the channel for the BUILDLESS path —
 * which is this framework's baseline, not its fallback, and was the surface left broken when the
 * compiler fix landed. It reaches the browser console on the client and during hydration; a
 * server-only render never runs this scanner, so an SSR page that is never hydrated is not covered.
 *
 * The self-close test is `markup` ending in `/`, which is the same approximation the raw-text
 * branch below already makes: an unquoted attribute value ending in a slash (`<div data-x=a/>`)
 * reads the same way. That is not a false positive in any way that matters — measured, such a tag
 * is an OPEN tag too and swallows what follows it exactly as `<div/>` does, so both the warning and
 * the fix it names are correct for it.
 */
const warnTagShape = (tag: string, closing: boolean, selfClosed: boolean) => {
  if (!closing && selfClosed && !VOID_TAGS.test(tag))
    console.warn(
      `[vera] renderer: <${tag}> is left OPEN by this template, so everything after it becomes its ` +
        `child rather than its sibling. HTML has no self-closing syntax outside <svg> and <math> — ` +
        `\`<${tag} />\` is an open tag, not an empty element. Write \`<${tag}></${tag}>\`. ` +
        `(@verajs/jsx rewrites this for you; a hand-written template has to say it.)`
    );
  else if (closing && VOID_TAGS.test(tag))
    console.warn(
      `[vera] renderer: \`</${tag}>\` is read by the parser as ANOTHER <${tag}>, so this template ` +
        `renders two where it describes one. A void element has no end tag — write \`<${tag}>\` alone.`
    );
};

const scan = (strings: TemplateStringsArray, type = 1) => {
  const specs: Spec[] = [];
  let markup = '';
  let state = IN_TEXT;
  let quote = '';
  let quoteStart = 0; // markup index of the opening quote while IN_QUOTED_VALUE
  let rawTag = ''; // which raw-text element we are inside
  let tagNameStart = 0; // markup index where the current tag's name begins
  let isClosing = false;
  /**
   * `__DEV__` only. Depth of `<svg>`/`<math>` nesting, because foreign content is the one place the
   * parser DOES honour XML self-closing, so neither warning applies inside it. An `svg`/`mathml`
   * template is already inside one, hence the seed from `type`.
   *
   * `<foreignObject>` re-enters HTML content and is deliberately not tracked: suppressing a warning
   * there is a missed warning, while tracking it wrongly would be a wrong one, and a diagnostic
   * that cries wolf is worse than one that stays quiet.
   */
  let foreign = type === 1 ? 0 : 1;
  let attrName = '';
  let statics: string[] = [];
  let pending = ''; // the static chunk currently being collected IN_BOUND_VALUE

  /** Backscan an attribute name that ends at `end` (exclusive); '' when malformed. */
  const attrNameBefore = (end: number) => {
    let at = end;
    while (at > 0 && !ATTR_NAME_DELIMITER.test(markup[at - 1])) at--;
    return markup.slice(at, end);
  };

  for (let i = 0; i < strings.length; i++) {
    const segment = strings[i];
    let pos = 0;
    while (pos < segment.length) {
      const ch = segment[pos];
      if (state === IN_BOUND_VALUE) {
        if (
          ch === quote ||
          (quote === '' && (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '>' || ch === '/'))
        ) {
          /**
           * The bound attribute closes. Emit a marker attribute whose VALUE carries the statics
           * joined by the marker — reading them back from the parsed attribute means entities
           * arrive decoded, exactly as a static attribute would.
           */
          statics.push(pending);
          const quoteChar = quote || '"';
          markup += ` ${specs.length}${MARKER}=${quoteChar}${statics.join(MARKER)}${quoteChar}`;
          specs.push(
            __DEV__
              ? { _type: ATTRIBUTE, _name: attrName, _tag: markup.slice(tagNameStart).match(/^[a-zA-Z][^\s/>]*/)?.[0] }
              : { _type: ATTRIBUTE, _name: attrName }
          );
          state = IN_TAG;
          if (quote !== '') pos++; // consume the closing quote; unquoted terminators reprocess IN_TAG
          continue;
        }
        pending += ch;
        pos++;
      } else if (state === IN_TEXT) {
        if (ch === '<') {
          if (segment.startsWith('!--', pos + 1)) {
            state = IN_COMMENT;
            markup += '<!--';
            pos += 4;
            continue;
          }
          isClosing = segment[pos + 1] === '/';
          tagNameStart = markup.length + (isClosing ? 2 : 1);
          state = IN_TAG;
        }
        markup += ch;
        pos++;
      } else if (state === IN_TAG) {
        if (ch === '"' || ch === "'") {
          quote = ch;
          quoteStart = markup.length;
          state = IN_QUOTED_VALUE;
        } else if (ch === '>') {
          const tagName = markup.slice(tagNameStart).match(/^[a-zA-Z][^\s/>]*/)?.[0] ?? '';
          if (__DEV__) {
            const lower = tagName.toLowerCase();
            const selfClosed = markup.endsWith('/');
            if (lower === 'svg' || lower === 'math') foreign += isClosing ? -1 : selfClosed ? 0 : 1;
            else if (foreign < 1) warnTagShape(tagName, isClosing, selfClosed);
          }
          if (!isClosing && RAW_TEXT_TAGS.test(tagName) && !markup.endsWith('/')) {
            rawTag = tagName.toLowerCase();
            state = IN_RAW_TEXT;
          } else {
            state = IN_TEXT;
          }
        }
        markup += ch;
        pos++;
      } else if (state === IN_QUOTED_VALUE) {
        if (ch === quote) state = IN_TAG;
        markup += ch;
        pos++;
      } else if (state === IN_COMMENT) {
        if (ch === '-' && segment.startsWith('->', pos + 1)) {
          markup += '-->';
          pos += 3;
          state = IN_TEXT;
          continue;
        }
        markup += ch;
        pos++;
      } else {
        // IN_RAW_TEXT
        if (
          ch === '<' &&
          segment.slice(pos + 1, pos + 2 + rawTag.length).toLowerCase() === '/' + rawTag &&
          (pos + 2 + rawTag.length >= segment.length || /[\s/>]/.test(segment[pos + 2 + rawTag.length]))
        ) {
          isClosing = true;
          tagNameStart = markup.length + 2;
          state = IN_TAG;
        }
        markup += ch;
        pos++;
      }
    }

    // ── expression boundary ──────────────────────────────────────────────────
    if (i === strings.length - 1) break;
    if (state === IN_TEXT) {
      markup += `<?${MARKER}>`;
      specs.push({ _type: CHILD });
    } else if (state === IN_RAW_TEXT) {
      markup += MARKER; // a text marker; comments cannot be parsed inside raw-text elements
      specs.push({ _type: CHILD });
    } else if (state === IN_COMMENT) {
      specs.push({ _type: IGNORED }); // binding inside a comment: consumed, ignored
    } else if (state === IN_BOUND_VALUE) {
      statics.push(pending); // this attribute spans another expression
      pending = '';
    } else if (state === IN_QUOTED_VALUE) {
      // expression inside a quoted attribute value -> becomes a bound attribute
      const name = markup[quoteStart - 1] === '=' ? attrNameBefore(quoteStart - 1) : '';
      if (name) {
        attrName = name;
        statics = [markup.slice(quoteStart + 1)]; // the static prefix already inside the quotes
        pending = '';
        markup = markup.slice(0, quoteStart - 1 - name.length); // cut `name="` back out
        state = IN_BOUND_VALUE;
      } else {
        specs.push({ _type: IGNORED });
      }
    } else {
      // IN_TAG: `name=${x}` unquoted, or an element-position expression
      const name = markup.endsWith('=') ? attrNameBefore(markup.length - 1) : '';
      if (name) {
        attrName = name;
        statics = [''];
        pending = '';
        quote = '';
        markup = markup.slice(0, markup.length - 1 - name.length);
        state = IN_BOUND_VALUE;
      } else {
        /**
         * Element-position expression — an element REF, not a no-op. Marked exactly like a bound
         * attribute ('&' cannot begin a real attribute binding), so no new machinery exists for it.
         */
        if (__DEV__ && (markup.endsWith('<') || markup.endsWith('</'))) {
          /**
           * Except in **tag position**, where it is a mistake with no useful reading. `<${name}>`
           * lands here because the tag has no name yet, and what the parser then makes of a ref on
           * a nameless element is escaped punctuation. Naming the entry that does support it is
           * more use than an element ref nobody asked for.
           */
          console.error(
            `[vera] an expression in tag position (\`<\${…}>\`) is not a dynamic tag name — the ` +
              `template has no element there and the markup around it is rendered as text.\n` +
              `Runtime tag names live in @verajs/renderer/tag:\n\n` +
              `  import { html, tag } from '@verajs/renderer/tag';\n` +
              `  const heading = tag\`h1\`;\n` +
              `  html\`<\${heading}>…</\${heading}>\`\n`
          );
        }
        /**
         * **And in attribute-*name* position, which is the same mistake one step along.**
         *
         * `<b ${name}="x">`, `<b data-${name}="1">` and `<b a${name}b="1">` all land here: the
         * marker is not preceded by `=`, so it reads as an element ref, and the `="x"` after it
         * stays literal markup. The browser's parser then makes `<b ="x"="">` of it — attributes
         * nobody wrote, silently.
         *
         * **The server already refuses this**, and said so in its README while the client shipped
         * the garbage. A developer rendering only in a browser saw malformed output with no clue,
         * and adding SSR later turned it into a throw with no obvious connection.
         *
         * Told apart from a real element ref by what follows it: a ref is always followed by
         * whitespace, `>` or `/`. Anything else means the marker landed inside a name.
         */
        const after = strings[i + 1] ?? '';
        if (__DEV__ && after !== '' && !/^[\s>/]/.test(after)) {
          console.error(
            `[vera] an expression in attribute-name position (\`<b \${…}="x">\`) is not a dynamic ` +
              `attribute name — a marker is not a name, and the parser makes attributes nobody ` +
              `wrote out of what follows it.\n` +
              `Runtime-named bindings live in @verajs/renderer/spread:\n\n` +
              `  import { spread } from '@verajs/renderer/spread';\n` +
              `  html\`<b \${spread({ [name]: 'x' })}>…</b>\`\n`
          );
        }
        markup += ` ${specs.length}${MARKER}="${MARKER}"`;
        specs.push({ _type: ATTRIBUTE, _name: '&' });
      }
    }
  }
  return { markup, specs };
};

/** A part's position and shape inside a Template, resolved to a node index for instantiation. */
type TemplatePart = {
  _type: 0 | 1 | 2;
  _index: number;
  _name?: string;
  _statics?: string[];
  /** Whether the template statically writes an attribute of the same name — see `AttrPart._commit`. */
  _present?: boolean;
  _node?: Node; // only during construction, carrying identity between the two passes
};

/**
 * THE LIGHT-SLOTS SEAM. `@verajs/renderer/slots` registers one of these through core's `wire` on
 * the `'slot'` insert point; the renderer reads it from the registry `connect` was handed — the
 * app's single registry, so a CDN page loading separate bundles still meets ONE seam (the same
 * architecture the `'value'` point rides). All member names are `$`-sigiled: the mangle regex
 * cannot match them, so the contract survives production across bundle boundaries (the child-
 * applier precedent). An app that never wires it pays one registry lookup per template
 * CONSTRUCTION (once per shape) and nothing per render.
 */
/** The registered `'slot'` insert is a plain function per wire's contract: take over one cloned
 *  `<slot>` for the given root, or decline with null/undefined (native slotting proceeds). */
type SlotSeamFn = (slot: Element, root: Node, name: string) => SlotSeamState | null | undefined;
/**
 * The seam function plus the members it carries for callers that are not committing a slot —
 * sigil-named, so they survive property mangling across bundle boundaries (the child-applier
 * precedent). `_$capture$` lifts a light host's children on its first render; `_$rescue$` puts
 * them back when hydration has to discard the server's markup; `_$server$`/`_$adopt$` belong to
 * SSR and the hydrate entry and are reached off the same object.
 */
type SlotSeam = SlotSeamFn & {
  _$capture$?: (host: Element, boundary?: Comment) => void;
  _$rescue$?: (host: Element) => Node[] | null;
  /** A captured node's host-side anchor (the light-region sentinel) — see the upgrade below. */
  _$home$?: (node: Node) => Comment | null;
};
/**
 * A recorded `<slot>` position — just its node index in the instance walk. Slot records live
 * BESIDE the parts array, not in it, so `_update` never iterates them and non-slot apps pay
 * nothing per render.
 *
 * The NAME is deliberately not recorded. It used to be, read off the template's static markup,
 * which made `<slot name=${…}>` a slot with no name at all: it registered as a second DEFAULT
 * slot and stole the default content while the real default slot showed its fallback. The name is
 * read from the element at mount instead, which is after its own bindings have committed.
 */
type SlotRecord = number;

/**
 * The container of the renderInto call currently committing — how a slot part learns its root
 * (light element vs shadow root) at Instance construction. Commits are synchronous per flush, so
 * one module slot suffices (the `currentInstance` pattern); null outside renderInto (hydration's
 * adoption path constructs elsewhere and the seam stays inert there until it learns adoption).
 */
let _slotRoot: Node | null = null;

/** See the slotless branch in `Instance`. Once per host tag, so a list cannot flood a console. */
const warnedSlotless = /* @__PURE__ */ new Set<string>();
const warnSlotless = (root: Element) => {
  const tag = root.localName;
  if (warnedSlotless.has(tag)) return;
  warnedSlotless.add(tag);
  console.warn(
    `[vera] renderer: <${tag}> renders a \`<slot>\` into LIGHT DOM, but no 'slot' insert is wired — ` +
      `nothing can fill it, so it always shows its fallback, and any content the host is given for ` +
      `it sits beside the component as stray markup instead. Wire it at the app entry, BEFORE anything renders: ` +
      `\`import { slots } from '@verajs/renderer/slots'; wire([renderer, slots])\`. Wiring it later ` +
      `does not help a template that has already rendered — a template resolves this once, at ` +
      `construction, and is interned per call site for the life of the page.`
  );
};

/**
 * `__DEV__` only: the HTML parser dropped an element a binding was written on.
 *
 * Named where it is discovered rather than after the walk, because the SKIP knows exactly which
 * spec went missing — `specs[from]` is the casualty by construction. A post-hoc count can only
 * report the LAST unclaimed spec, which positional pairing makes the wrong element every time, and
 * pointing an author at a tag that rendered correctly is the precise failure this message exists
 * to cure.
 */
/**
 * **A child binding directly inside `<table>` renders one shape and PARSES as another.**
 *
 * `<table>${rows}</table>` is conforming HTML — `<tbody>` is omissible — and it is the one place a
 * legal template does not survive a round trip through the platform:
 *
 * - CLIENT RENDER inserts the rows with DOM calls, which apply no parser rules: `table > tr`.
 * - The SAME markup PARSED — a server render the browser re-parses, `innerHTML`, a static file —
 *   gets the implied section: `table > tbody > tr`.
 *
 * Measured, both shapes, same template. So a stylesheet written `table > tr` matches on one path
 * and not the other, and hydration discards the server's markup for that container and rebuilds it
 * (*"expected `<tr>` and found `<tbody>`"*) — silently in production, where this call is folded away.
 *
 * **Why this is a warning and not a repair.** Whatever is emitted, the browser re-parses it, and the
 * parser ALWAYS inserts the section — so the only shape all three paths agree on is one where the
 * section is already in the template. The framework could insert it, but that changes the DOM shape
 * of every existing client-rendered table, across the renderer AND `@verajs/ssr`'s serializer, and
 * rests on the SSR shim agreeing with browsers about implied tags. One word from the author reaches
 * the same fixed point with none of that. Owner's call, recorded rather than assumed.
 *
 * Scoped to `<table>` deliberately: `<tbody>` (from rows) and `<colgroup>` (from `<col>`) are the
 * only implied START tags reachable inside a template fragment, and both are children of `<table>`.
 * The omissible END tags — `</li>`, `</p>`, `</td>`, `</option>` and the rest — insert nothing, so
 * they round-trip correctly and are pinned doing so in `tests/dropped-element-bindings.test.mjs`.
 */
const warnImplicitSection = (parent: Element | null) => {
  if (parent?.localName !== 'table') return;
  console.warn(
    '[vera] renderer: a binding sits directly inside <table>, where the HTML parser inserts a ' +
      '<tbody> that a client render does not. The same template then renders as `table > tr` and ' +
      'parses as `table > tbody > tr`, so `table > tr` selectors match on only one path and ' +
      'hydration rebuilds this container instead of adopting it. Write the section explicitly — ' +
      '`<table><tbody>${rows}</tbody></table>` — and every path agrees.'
  );
};

const warnDroppedBinding = (specs: Spec[], from: number, count: number) => {
  const lost = specs[from];
  const where = lost?._tag
    ? `\`${lost._type === ATTRIBUTE ? `${lost._name}=` : ''}\` on <${lost._tag}>`
    : 'a binding';
  console.warn(
    `[vera] renderer: ${where} never reached the parsed tree — the HTML parser DROPPED the element ` +
      `it was written on, because its parent's content model forbids it (\`<select>\` takes only ` +
      `options, \`<form>\` cannot nest, and so on).\n` +
      `${count} binding(s) lost. The element is gone from the DOM and its binding does nothing; ` +
      `the bindings AFTER it are unaffected, because each marker carries its own index. ` +
      `(Before that they all shifted onto the wrong elements, which is why this kind of mistake ` +
      `used to surface somewhere you had not edited.)\n` +
      `Move the element out of its parent, or use one the parent can hold.`
  );
};

const templateCache = new WeakMap<TemplateStringsArray, Template>();

class Template {
  _element: HTMLTemplateElement;
  _parts: TemplatePart[] = [];
  /**
   * Present only when a 'slot' insert was wired at construction and the markup contains slots.
   *
   * `declare`, like the two below: under ES2022 class-field semantics a plain optional field is
   * DEFINED on every instance whether or not it is ever assigned, so a CONDITIONALLY assigned one
   * is weight every template pays for a case most of them do not have.
   *
   * Deliberately not applied to the fields the constructors always assign (`_element`, `_name`,
   * `_statics`, `_start`, `_end`, and the rest). Those need to exist, the saving is the same few
   * bytes, and they sit on the hot classes where changing when a property first appears can move
   * V8's hidden class — which is a measurement, not a tidy-up. If anyone takes that on, measure
   * update throughput before and after, three runs, the way the slot-mount deferral was.
   */
  declare _slots?: SlotRecord[];
  declare _seam?: SlotSeamFn;
  /** `__DEV__` only: this markup has `<slot>` and was built with no seam to hand them to.
   *  `declare`, so nothing is emitted — a plain optional field is DEFINED on every instance under
   *  ES2022 class-field semantics, which is production weight for a development-only check. */
  declare _slotless?: boolean;

  constructor(result: TemplateResult) {
    const type = result._$litType$ ?? 1;
    const { markup, specs } = scan(result.strings, type);
    this._element = doc.createElement('template');
    /** svg/mathml fragments only parse inside their root; wrap, then unwrap below. */
    this._element.innerHTML = type === 2 ? `<svg>${markup}</svg>` : type === 3 ? `<math>${markup}</math>` : markup;
    const content = this._element.content;
    if (type !== 1) {
      const wrapper = content.firstChild!;
      while (wrapper.firstChild) content.insertBefore(wrapper.firstChild, wrapper);
      content.removeChild(wrapper);
    }

    /**
     * Pass 1 — DISCOVER over ELEMENT | COMMENT: pair scan specs with parsed nodes in document
     * order (which is expression order), and swap every marker comment for a primed empty text
     * node. The shipped template then contains no comments at all: each clone is three nodes
     * lighter per typical row, and the primed text doubles as both anchor and first-commit target.
     */
    markerWalker.currentNode = content;
    let specIndex = 0;
    let node: Node | null;
    const parts = this._parts;
    const consumeIgnored = () => {
      while (specIndex < specs.length && specs[specIndex]._type === IGNORED) {
        parts.push({ _type: IGNORED, _index: -1 });
        specIndex++;
      }
    };
    consumeIgnored();
    while (specIndex < specs.length && (node = markerWalker.nextNode()) !== null) {
      if (node.nodeType === 1) {
        const element = node as Element;
        if (element.hasAttributes()) {
          for (const attributeName of element.getAttributeNames()) {
            if (attributeName.endsWith(MARKER)) {
              /**
               * **Each marker carries its own spec index in its NAME**, so pairing is addressed
               * rather than positional — and a marker that never arrived is visible the moment the
               * next one does. Both halves matter and neither works alone:
               *
               * - REPAIR: an element the parser drops takes its marker with it. Paired by walk
               *   order, that shifted every later binding onto the wrong element, silently —
               *   `html\`<select><div title=${'${a}'}>x</div></select><b title=${'${b}'}>\`` rendered
               *   `<b title="a">`. Consuming the gap keeps every surviving binding on its own
               *   element; only the dropped one is lost.
               * - REPORT: the repair would otherwise SILENCE the problem, which is a correct
               *   refusal with nothing to tell the author — so the skip is where the warning lives.
               */
              const declared = parseInt(attributeName, 10);
              if (declared > specIndex) {
                if (__DEV__) warnDroppedBinding(specs, specIndex, declared - specIndex);
                do parts.push({ _type: IGNORED, _index: -1 });
                while (++specIndex < declared);
              }
              /**
               * The marker attribute's value carries the statics; the REAL (case-preserved) name
               * comes from the spec — the HTML parser lowercases attribute names, which would
               * corrupt `.someProp`.
               */
              const spec = specs[specIndex++] as { _type: 1; _name: string };
              parts.push({
                _type: ATTRIBUTE,
                _index: -1,
                _name: spec._name,
                _statics: element.getAttribute(attributeName)!.split(MARKER),
                /**
                 * Computed here — once per template, ever — so the first commit of a nullish
                 * binding knows whether a fresh clone even carries the attribute. It usually does
                 * not, and the unconditional removal this feeds cost a real DOM call per element
                 * per create: 1,000 no-op `removeAttribute`s on the 1,000-row benchmark. The one
                 * case that must still remove — `<b title="a" title=${null}>`, where the parser
                 * keeps the first duplicate — is exactly what this reads.
                 */
                _present: element.hasAttribute(spec._name),
                _node: element,
              });
              element.removeAttribute(attributeName);
              consumeIgnored();
            }
          }
        }
        if (RAW_TEXT_TAGS.test(element.tagName) && element.textContent!.includes(MARKER)) {
          /**
           * Comments cannot be PARSED inside raw-text elements, but they are legal DOM once
           * created — so the scan left text markers, and here they become real marker comments.
           * The walker visits them next and they pair as ordinary child parts.
           */
          const pieces = element.textContent!.split(MARKER);
          element.textContent = '';
          for (let p = 0; p < pieces.length - 1; p++) {
            if (pieces[p]) element.append(pieces[p]);
            element.append(comment(MARKER_COMMENT_DATA));
          }
          if (pieces[pieces.length - 1]) element.append(pieces[pieces.length - 1]);
        }
      } else if ((node as Comment).data === MARKER_COMMENT_DATA) {
        specIndex++;
        const primedText = doc.createTextNode('');
        node.parentNode!.insertBefore(primedText, node);
        /** Re-aim the walker before removing the node it stands on. */
        markerWalker.currentNode = primedText;
        (node as Comment).remove();
        if (__DEV__) warnImplicitSection(primedText.parentNode as Element | null);
        parts.push({ _type: CHILD, _index: -1, _node: primedText });
        consumeIgnored();
      }
    }

    /**
     * **CONSERVATION OF MARKERS — the walk must claim every spec the scan emitted.**
     *
     * The loop above pairs specs with markers in document order. If the HTML parser DROPPED the
     * element a binding was written on, that marker never exists, the loop runs out of nodes early,
     * and `specIndex` stops short — and because pairing is POSITIONAL, every binding after the
     * missing one has already been handed the value of its predecessor. Measured:
     *
     *     html`<select><div title=${a}>x</div></select><b title=${b}>after</b>`
     *
     * renders `<b title="a">` — the value written for the `<div>`, on an unrelated element, with
     * no error anywhere. `<form>` inside `<form>` does the same. HTML's parser drops elements its
     * content model forbids, which is correct of it and invisible to everything else here.
     *
     * **This is deliberately not a content-model check.** A table of what may contain what is a
     * closed vocabulary over an open space: it catches what somebody enumerated, needs maintenance
     * as HTML evolves, and would cover the compiler only — while this counts what actually
     * happened, in JSX and hand-written templates alike, for every dropping context including the
     * ones nobody listed. The cost of knowing is one integer comparison the construction already
     * had lying around.
     *
     * The gap it cannot close, named rather than implied: a dropped element carrying NO bindings
     * loses nothing to count. That is harmless to the renderer — nothing shifts — and it is the
     * restructuring class, which `tests/jsx-tree-parity.test.mjs` records instead.
     */
    if (__DEV__ && specIndex < specs.length) {
      /** A casualty at the very END has no later marker to reveal it, so the tail is checked too. */
      warnDroppedBinding(specs, specIndex, specs.length - specIndex);
    }

    /** Pass 2 — INDEX over ELEMENT | TEXT, the mask instances walk with. */
    instanceWalker.currentNode = content;
    let nodeIndex = -1;
    let partIndex = 0;
    while (partIndex < parts.length && parts[partIndex]._type === IGNORED) partIndex++;
    while (partIndex < parts.length && (node = instanceWalker.nextNode()) !== null) {
      nodeIndex++;
      while (partIndex < parts.length && parts[partIndex]._node === node) {
        parts[partIndex]._index = nodeIndex;
        partIndex++;
        while (partIndex < parts.length && parts[partIndex]._type === IGNORED) partIndex++;
      }
    }
    for (const part of parts) part._node = undefined;

    /**
     * THE SLOT WALK — the whole template-side seam, and it runs only when a 'slot' insert is
     * wired at construction. One dedicated pass discovers `<slot>` elements AND indexes them in
     * the same ELEMENT|TEXT numbering the instance walk uses (Text has no localName, so no
     * nodeType check is needed). Passes 1 and 2 above are byte-identical to their pre-seam
     * selves: an unwired app's construction path is untouched, and its only cost is this one
     * registry lookup per template construction.
     *
     * **Resolved per TEMPLATE, and templates are cached per call site for the life of the page** —
     * so a shape first constructed before `wire([slots])` ran never gains slot support, silently.
     * That is the ordinary insert contract (wire at the app entry, beside the renderer, before
     * anything renders) and it is stated in the slots module's own docs; resolving per INSTANCE
     * instead would move a registry lookup onto the hot path for every app, which is the trade
     * this design refuses.
     */
    const seam = slotSeam();
    /**
     * **Dev-only: remember that this markup HAS slots even when nothing can distribute them.**
     * Without it the two ways of getting the wiring wrong are indistinguishable from a component
     * that simply has no slots — see the warning at the instance's slot mount.
     */
    if (__DEV__ && seam === undefined && markup.includes('<slot')) this._slotless = true;
    if (seam !== undefined) {
      instanceWalker.currentNode = content;
      let index = -1;
      while ((node = instanceWalker.nextNode()) !== null) {
        index++;
        if ((node as Element).localName === 'slot') {
          this._seam = seam;
          (this._slots ??= []).push(index);
        }
      }
    }
  }
}

/**
 * **Development only: an HTML element committed into an SVG or MathML parent draws nothing.**
 *
 * `<path>` parsed as HTML is an `HTMLUnknownElement` — right tag name, no geometry, invisible — and
 * the whole failure mode is that nothing complains. An app reported "every header icon vanished"
 * and had to bisect a component tree to find it.
 *
 * `@verajs/jsx` compiles a template whose ROOT is an SVG-only element with the `svg` tag, so JSX
 * reaches here for a name SVG shares with HTML (`<a>`, `<title>`), one deliberately left out of that
 * set, and — the commonest of the three — any in-set root the compiler REFUSED to upgrade, which it
 * does whenever a component or custom element lies in the subtree, JSX sits in an attribute, or a
 * static element sits in a `<title>`. A refused `<g>` is emitted as HTML and arrives here like any
 * other. What no compiler reaches is a HAND-WRITTEN `html` template handed across a function
 * boundary into an `<svg>` — `` Frame(html`<path/>`) `` — where `` svg`…` `` was correct and the call
 * site had no way to know, because the destination belongs to the callee. lit-html behaves
 * identically, so the behaviour is not the thing to change; the silence is.
 *
 * **It lives in `_insert` because that is the seam the template and list paths share.** Wired to the
 * template commit alone it could never fire for a component's children, which arrive as an ARRAY and
 * reach the DOM through the list path — the single most likely spelling of the bug it exists for.
 * `@verajs/renderer/keyed` does NOT cross it — it lands its rows through its own `$c` branches,
 * which is why there are three call sites rather than one.
 *
 * Two insertion paths are deliberately NOT covered, and saying so is better than implying they are.
 * Hydration commits through its own cursor. `@verajs/renderer/slots` moves assigned light children
 * into place itself, so an HTML `<path>` distributed into an SVG `<g>` is silent — that entry
 * imports nothing by design, which is exactly what lets it sit beside any renderer entry on a CDN
 * page, so covering it means a second address for this rule rather than a call.
 *
 * Each call site reads the host from the node that knows where the content LANDS, which is not
 * always the part's own parent: a batched fill is assembled in a `DocumentFragment`, which has no
 * namespace to read, so `_insert` prefers `_foreignHost` in exactly that case and `$c` reaches for
 * the list's parent. Resolving the namespace from the off-document fragment is the mistake that
 * sank an earlier attempt at fixing this properly in the renderer, and all three sites capture the
 * answer BEFORE `insertBefore`, because inserting a fragment empties it.
 *
 * Silent where HTML is CORRECT: `<foreignObject>`, `<desc>`, `<title>` and MathML's token elements
 * are integration points, and `<style>`/`<script>` never draw by design — an HTML `<style>` inside
 * an `<svg>` applies its rules perfectly well, so complaining that it "will not render" is both wrong
 * and, since `style` is a name the compiler refuses to guess at, exactly the guess it refuses.
 */
const foreignHost = (parent: Node): string | null => {
  /**
   * Namespace FIRST: it settles the ordinary HTML parent every insert takes, and `localName` is
   * only wanted inside the two foreign branches. Reading both up front cost 16.1 ns against 11.3 on
   * that path, measured over 2M iterations — for a value nothing on it uses.
   */
  const element = parent as Element;
  const namespace = element.namespaceURI;
  const svg = namespace === 'http://www.w3.org/2000/svg';
  if (!svg && namespace !== 'http://www.w3.org/1998/Math/MathML') return null;
  const name = element.localName;
  if (svg) return name === 'foreignObject' || name === 'desc' || name === 'title' ? null : name;
  if (name === 'mi' || name === 'mo' || name === 'mn' || name === 'ms' || name === 'mtext')
    return null;
  /**
   * `<annotation-xml>` is an HTML integration point ONLY for the two HTML encodings; with any
   * other, its content is still MathML and an HTML element there is as inert as anywhere else.
   * One attribute read buys the distinction the spec actually draws.
   */
  if (name === 'annotation-xml') {
    /**
     * Attribute OR property. `<annotation-xml>` is dash-named, so `@verajs/jsx` compiles
     * `encoding="text/html"` to `.encoding=${…}` — a property, with no attribute to read — and the
     * hand-written and JSX spellings of the same markup then disagreed about whether this is an
     * integration point. The runtime can see both; only it can, which is why the compiler leaves
     * `annotation-xml` alone entirely.
     */
    const encoding = (element.getAttribute('encoding') ??
      (element as { encoding?: unknown }).encoding) as string | undefined;
    const normalised = typeof encoding === 'string' ? encoding.toLowerCase() : undefined;
    /**
     * `image/svg+xml` leaves too. It is MathML's own registered encoding for an SVG annotation — the
     * one place SVG content inside a `<math>` subtree is the author's intended, spec-sanctioned
     * spelling — and the renderer builds it correctly there, since it inserts through the DOM API
     * rather than the HTML parser. Treating it as foreign produced a warning whose every clause was
     * false: that the namespaces "cannot nest directly" here, and that the fix is to change the
     * encoding to `text/html`, which is the wrong encoding for SVG. Leaving the host unexamined
     * gives up naming genuinely HTML content inside an SVG annotation, which is the rarer mistake by
     * far and the one no one has ever reported.
     */
    return normalised === 'text/html' ||
      normalised === 'application/xhtml+xml' ||
      normalised === 'image/svg+xml'
      ? null
      : name;
  }
  return name;
};

/**
 * Named ONCE per host-namespace, host-name, content-namespace and offending-tag. A diagnostic that repeats is as useless as one that stays
 * silent, and this one sits on an insert, so a toggled or animated subtree produced one
 * `console.warn` per frame before the guard. `warnedSlotless` above is the precedent and the same
 * `Set<string>` shape. `warnBooleanChild` is the other precedent and a DIFFERENT rule: it re-warns
 * whenever the value CHANGES, which is enough there because a boolean child that keeps being
 * committed is the same mistake being re-reported. Measured: 20 renders of `${false}` warn once, and
 * toggling `false` ↔ `'x'` ten times warns ten times. It would not serve here, where the offending
 * element is committed unchanged on every frame of an animated subtree.
 */
const warnedForeign = /* @__PURE__ */ new Set<string>();

const warnForeignMismatch = (host: string, hostNamespace: string | null, nodes: readonly Node[]): void => {
  for (const node of nodes) {
    /**
     * **Load-bearing, and it was not always.** `namespaceURI` is defined on `Element` alone, so while
     * the test below asked *"is this XHTML"* a text node fell out of it on its own and this line was
     * only a fast path — which is what the comment here used to say. Making the rule a namespace
     * MISMATCH inverted that in the same change: `undefined === hostNamespace` is false for every
     * foreign host, so without this guard every text node in a CORRECTLY tagged template is reported
     * as `<undefined> was built as HTML`. A guard whose justification was written against the
     * previous line beneath it is worth more suspicion than one with no comment at all.
     */
    if (node.nodeType !== 1) continue;
    const element = node as Element;
    /**
     * **Content whose namespace DIFFERS from its host's does not render — one rule, both ways.**
     * Testing for HTML specifically left the mirror case silent: a hand-written `` mathml`…` ``
     * handed across a boundary into an `<svg>` — the same story as `` Frame(html`<path/>`) ``, one
     * namespace over — drew nothing and said nothing. An element in its host's own namespace is
     * correct and is the path every ordinary insert takes, so it leaves first.
     */
    if (element.namespaceURI === hostNamespace) continue;
    const tag = element.localName;
    /** Neither draws, so "will not render" is the wrong complaint — and `<style>` genuinely applies. */
    if (tag === 'style' || tag === 'script') continue;
    /**
     * The remedy has to match the HOST's namespace. `<foreignObject>` does not exist in MathML, so
     * naming it for an `<mrow>` host sent people to build an SVG element inside `<math>`, which
     * draws nothing — and "no geometry" was SVG language applied to a MathML parent besides.
     *
     * The NAMESPACE decides, never the name: SVG owns `mask`, `marker`, `mpath` and `metadata`, so
     * a "starts with m" shortcut would hand four SVG hosts the MathML advice.
     */
    /**
     * The namespace it WAS built in. `HTML` is also the answer for an element carrying no namespace
     * at all — one adopted from an XML document — which is a label rather than a fact, but the
     * sentence it appears in ("will not render") and both remedies are right either way.
     */
    const built =
      element.namespaceURI === 'http://www.w3.org/1998/Math/MathML'
        ? 'MathML'
        : element.namespaceURI === 'http://www.w3.org/2000/svg'
          ? 'SVG'
          : 'HTML';

    /**
     * The island AND the constraint on where it may sit, chosen together by the host's namespace.
     * Appending the container caveat to both branches from outside put SVG's answer on a MathML
     * host — *"put `<mtext>` in a container such as `<g>` or `<svg>`"* — which is the round-1 defect
     * (a `<mrow>` told to use `<foreignObject>`) arriving through the caveat instead of the island.
     * The constraint is real in both namespaces and different in each: `<foreignObject>` is not a
     * permitted child of `<text>`, `<tspan>`, `<clipPath>`, a gradient or a filter — those accept
     * only their own content models and ignore anything else — while `<pattern>` takes `<g>`'s and
     * does admit one. `<mtext>` is likewise not a child of a MathML token element.
     *
     * And the ENCODING follows the content, not the host: `text/html` is the HTML annotation, so
     * naming it for SVG content sends the author to the one spelling that cannot carry it. That is
     * the same false advice `foreignHost` above refuses to print for an `image/svg+xml` host,
     * arriving here through a string shared between two branches.
     */
    const island =
      hostNamespace === 'http://www.w3.org/1998/Math/MathML'
        ? `<mtext>, or <annotation-xml encoding="${built === 'SVG' ? 'image/svg+xml' : 'text/html'}">, ` +
          'inside a MathML container such as <mrow> or <math> rather than inside a token element'
        : 'a <foreignObject>, which has to sit in an element whose content model accepts one — a ' +
          'container such as <g> or <svg>, not a text, clipping, gradient or filter element'
    /**
     * Keyed by the host's NAMESPACE as well as its name, because `<a>` is a real element in both —
     * the parser leaves `<math><a>` in MathML, since `a` is not on the foreign-content breakout
     * list. Keyed by name alone, an SVG `<a>` host spent the pair for a MathML one, which then went
     * silent AND lost its namespace-correct remedy: exactly the misadvice the remedy is chosen by
     * namespace to prevent, arriving through the dedupe instead. `<style>` and `<script>` are hosts
     * in both namespaces too — and the CONTENT's namespace is in the key for the same reason, since
     * `<a>` is a real element in all three: an HTML `<a>` in an `<svg>` and a MathML `<a>` in the
     * same `<svg>` are two distinct mistakes, and one was silencing the other.
     */
    const seen = `${hostNamespace}${host}>${element.namespaceURI}${tag}`;
    /** `continue`, not `return`: a spent key must skip THIS node, not abandon the whole insert. */
    if (warnedForeign.has(seen)) continue;
    warnedForeign.add(seen);
    /**
     * **Two different mistakes, and only one of them is about a tag.**
     *
     * HTML content in foreign parent is the common one, and it gets BOTH remedies, because which is
     * right depends on what the element was meant to be. `` svg`…` `` fixes an SVG element compiled
     * as HTML. It does NOT fix genuine HTML: a `<div>` stays HTML-namespaced whatever the template
     * is tagged (the parser's foreign-content breakout), so the advice would change nothing and the
     * warning would fire again — and for a CUSTOM ELEMENT it is actively harmful, silencing this
     * while leaving the element permanently un-upgraded, since upgrade is spec-gated on the HTML
     * namespace. `<foreignObject>` is the answer for anything really HTML.
     *
     * SVG inside MathML, or MathML inside SVG, is a DIFFERENT mistake and both of those remedies are
     * wrong for it: the template already carries the right tag — this message says so one clause
     * earlier — and the content is not HTML, so the island sentence excludes itself. Saying "add the
     * svg tag" to a template that IS `` svg`…` `` is the round-1 defect wearing another hat. The two
     * namespaces simply cannot nest directly; an island is the only place one can host the other.
     *
     * The loop then simply ends: every distinct offender in one insert is reported, because the
     * only early exit above is the spent-pair `continue`, which skips ITS node rather than
     * abandoning the scan. Reporting the first alone made the message order-dependent.
     */
    /**
     * The ADVICE varies; the call does not. `tests/diagnostics-convention.test.mjs` reads the literal
     * immediately after the `(` to prove every message a user sees carries the `[vera]` prefix, and
     * a ternary between two whole messages makes the call invisible to it rather than failing —
     * which is a defect that suite already caught once, and caught here again.
     */
    const advice =
      built === 'HTML'
        ? `If it is meant to be an SVG or MathML element, the template holding it needs the ` +
          `svg\`…\` or mathml\`…\` tag — the tag is chosen where a template is WRITTEN, not where ` +
          `it is used, so write it at the call site. If it is genuinely HTML (a <div>, a custom ` +
          `element), it belongs in ${island}: tagging it will not help, and a custom element only ` +
          `upgrades in the HTML namespace.`
        : `The template's tag is already right — these two namespaces cannot nest directly. Put ` +
          `the ${built === 'SVG' ? '<svg>' : '<math>'} root inside ${island}.`;
    console.warn(
      `[vera] renderer: <${tag}> was built as ${built} and placed inside <${host}>, where it will ` +
        `not render. ${advice}`
    );
  }
};

const getTemplate = (result: TemplateResult) => {
  let template = templateCache.get(result.strings);
  if (template === undefined) templateCache.set(result.strings, (template = new Template(result)));
  return template;
};

/** Anything bound to a live position: commits values[index..], returns the next value index. */
const IGNORED_PART: Part = { _commit: (_values, index) => index + 1 };

/** Never equal to any user value, so the first commit always runs. */
const UNSET = {};


/** A fresh markered part: two comments inserted before `ref` in `parent`. */
const createMarkeredPart = (parent: Node, ref: Node | null) => {
  const start = comment();
  const end = comment();
  parent.insertBefore(start, ref);
  parent.insertBefore(end, ref);
  return new ChildPart(start, end);
};

/**
 * Text for an attribute built from several expressions.
 *
 * `` `${value}` `` rather than `String(value)`, and the difference is exactly one case. Both are
 * ToString with hint `'string'` for everything else; `String` alone special-cases a **symbol** and
 * returns its description instead of throwing. Every single-expression binding assigns straight to
 * the DOM and gets WebIDL's `DOMString` conversion, which throws on one — so `title=${symbol}` threw
 * and `title="a ${symbol} b"` quietly rendered `a Symbol(s) b`. The same sigil on the same attribute,
 * disagreeing with itself depending on whether static text sat beside it.
 */
const toText = (value: unknown) => (value == null ? '' : `${value}`);

/** Binding kinds, resolved once from the attribute name's first character. */
const ATTR = 0; // plain attribute
const PROPERTY = 1; // .name
const BOOLEAN = 2; // ?name
/**
 * `!name` — a property written from the *live* DOM rather than from what this binding last wrote.
 *
 * Numbered below `EVENT` deliberately: `kind >= EVENT` is what decides a value is passed raw rather
 * than joined from the statics, and a live binding is a property, so `!title="a${x}b"` has to join
 * like every other one.
 */
const LIVE = 3;
const EVENT = 4; // @name
/** A binding that must never write — see the `__proto__` refusal in the constructor. */
const REFUSED = -1;
/** `.name` on a custom element nothing receives yet — records into `_$props$`, then becomes
 *  `PROPERTY`. A distinct kind keeps the steady-state property path free of any adoption check. */
const PROP_ADOPT = 6;

/**
 * The `PROP_ADOPT` commit, kept OUT of `_commit` so that function's size — and the JIT layout of
 * its hot `PROPERTY`/`ATTR` branches — is unchanged from before this feature. `_commit` carries one
 * dispatch line; all of this lives here, off every part's steady state.
 *
 * One question decides everything: **after the write, does anything receive this property?** An
 * accessor anywhere on the chain — the platform's own (`title`, `hidden`), a component's declared
 * one, or the pair core's `init()` defines — means the write just landed in real hands: no record,
 * and the part rejoins `PROPERTY` for good. The walk is one step when the write created an own data
 * property (nobody consumed it) and stops at the first descriptor either way, and it is what keeps
 * a platform property on a lazy tag out of the record — recording `.title` would end with the drain
 * shadowing `HTMLElement.prototype.title` and breaking it.
 *
 * An unreceived write is recorded under the sigiled expando **`_$props$`**, because two arrival
 * orders both need it: on a LAZY tag the value sits as a plain own property that the class's field
 * initializers will overwrite at upgrade (the clobber the `PROPERTY` branch only *detects*), and on
 * an EAGER one the value survives but is indistinguishable from the component's own fields by the
 * time `init()` runs. The record answers both — core's `init()` drains it, re-applying values
 * unconditionally, which repairs BOTH spellings of the clobber (`item;` and `item = default`): it
 * never asks whether a clobber happened, it asserts a bound value outranks a class default, which
 * is what props mean. Element-carried because `./spread.ts` writes the same properties from a
 * separate bundle with no shared registry — the `_$`-sigiled member is the cross-bundle channel,
 * and the recorder there is this one's deliberate twin.
 *
 * Returns the part's NEXT kind: `PROPERTY` once something receives the property or the element is
 * upgraded (its record is final — `init()` drains it in the same tick) or has no realm; `REFUSED`
 * for a getter with no setter, so the binding goes inert instead of the flipped plain write
 * throwing on the next commit; `0` to stay adopting — a dash-named element that never upgrades and
 * never receives keeps recording, so its record stays current rather than staling. The one
 * retention this leaves: a defined non-vera element with a plain data property keeps its FIRST
 * committed values in `_$props$` for its lifetime — bounded, one generation, and the part itself
 * already retains the current generation in `_committed`.
 */
const commitAdopt = (element: Element, name: string, value: unknown): number => {
  const el = element as unknown as Record<string, unknown>;
  /**
   * The walk comes BEFORE the write, because what the walk finds decides whether writing is even
   * legal: a SETTER receives the value (and a setter that throws is the component's own error), a
   * GETTER with no setter cannot — the old order assigned first, which in strict mode threw a raw
   * TypeError out of the render for the eager spelling of exactly the case the drain refuses by
   * name for the lazy one. Same contested state, one rule, both arrival orders — and the server's
   * `deliverProperty` applies it too. The dev warning defers to `_$adopt$` where it exists: an
   * initialized component's drain already speaks, and two voices for one binding is noise.
   */
  let carrier: object | null = el;
  while (carrier !== null) {
    const desc = Object.getOwnPropertyDescriptor(carrier, name);
    if (desc !== undefined) {
      if (desc.set !== undefined) {
        el[name] = value;
        return PROPERTY;
      }
      if (desc.get !== undefined) {
        /** An initialized component's receiver owns the refusal (and its channel); for anything
         *  else this is the only door, so it says so itself. Either way the binding goes INERT —
         *  flipping to `PROPERTY` would make the next commit's plain write throw. */
        if (el._$adopt$ !== undefined) (el._$adopt$ as (key: string, value: unknown) => void)(name, value);
        else if (__DEV__)
          console.warn(
            `[vera] renderer: <${element.localName}> declares \`${name}\` as a getter with no ` +
              `setter — the value bound by \`.${name}=\${…}\` cannot be delivered and the binding ` +
              `is ignored. Add a setter, or stop binding it.`
          );
        return REFUSED;
      }
      break; // a data property — an own field, or an inherited default: nothing receives it
    }
    carrier = Object.getPrototypeOf(carrier);
  }
  el[name] = value;
  /**
   * An initialized component receives LIVE: `init()` left `_$adopt$` on the element, and a key it
   * has not adopted yet goes through that door — a record here would never be read again, because
   * the drain already ran. This is how a hydrated child gets the props its parent commits after
   * the child settled, and how a spread bag's conditional key arrives reactive on a live element.
   */
  if (el._$adopt$ !== undefined) {
    (el._$adopt$ as (key: string, value: unknown) => void)(name, value);
    return PROPERTY;
  }
  const record = (el._$props$ ??= {}) as Record<string, unknown>;
  const firstRecording = !Object.hasOwn(record, name);
  record[name] = value;
  /**
   * Upgrade is read off the PROTOTYPE, never off `el.constructor`: a spread bag's keys are runtime
   * data, so a bag carrying a key named `constructor` writes an own property that shadows the real
   * one, and a check that reads it would then misjudge every later commit. No property write can
   * move an element's prototype — the one assignment that could, `__proto__`, both twins refuse.
   * The realm comes from the element, as always.
   */
  const win = element.ownerDocument.defaultView as unknown as {
    HTMLElement: { prototype: object };
    customElements: CustomElementRegistry;
  } | null;
  const upgraded = win === null || Object.getPrototypeOf(el) !== win.HTMLElement.prototype;
  /**
   * **The clobber detector, for the element the drain will never reach.** A component that calls
   * `init()` has the record re-applied, so for it the pre-upgrade window is repaired; an element
   * that never drains — a plain custom element with a class field — still loses the bound value to
   * the field initializer at upgrade, exactly as before this feature, and still deserves the
   * warning. Told apart by OWNERSHIP, not by value: after the definition arrives (and, for a
   * connected element, `connectedCallback` and the drain have run synchronously inside `define()`),
   * an own accessor means the drain took the property and there is nothing to report. Identity
   * against the COMMITTED value would lie twice — a drained value reads back through the store's
   * proxy, and a value superseded by a later pre-upgrade commit differs without anything being
   * wrong — so the comparison is against the RECORD, which later recordings keep current, and the
   * subscription is installed once per (element, property), on the first recording. The registry
   * is the element's own realm's. Development only; production carries no check, no message, no
   * `whenDefined` subscription.
   */
  if (__DEV__ && win !== null && !upgraded && firstRecording) {
    const tag = element.localName;
    win.customElements.whenDefined(tag).then(() => {
      /** Ownership is asked of the whole CHAIN: the drain's own accessor, a class's prototype
       *  pair the value was handed to, or a get-only surface the drain refused by name — every
       *  one means the property has an owner and this closure has nothing left to report. */
      let carrier: object | null = el;
      let owned = false;
      while (carrier !== null) {
        const desc = Object.getOwnPropertyDescriptor(carrier, name);
        if (desc !== undefined) {
          owned = desc.get !== undefined || desc.set !== undefined;
          break;
        }
        carrier = Object.getPrototypeOf(carrier);
      }
      if (!owned && el[name] !== record[name])
        console.warn(
          `[vera] renderer: the value bound by \`.${name}=\${…}\` on <${tag}> was replaced ` +
            `while the element upgraded. A class field is the usual cause: at ES2022 ` +
            `\`${name}?: …\` emits \`${name};\`, which runs during upgrade and overwrites ` +
            `whatever was set beforehand — write it \`declare ${name}?: …\` instead, which ` +
            `emits nothing. A component that calls init() adopts bound properties automatically ` +
            `and never sees this; this element did not. Ignore this if the component replaced ` +
            `the value on purpose.`
        );
    });
  }
  return upgraded ? PROPERTY : 0;
};
/**
 * Calls an element ref, and survives one that throws.
 *
 * A ref runs in the middle of committing a template's parts, so an unguarded throw left the commit
 * half applied and unwound the render that triggered it — the component's shadow root ended up
 * **empty and stayed that way**, and every later update threw at the same line. The error was
 * reported, so the only symptom was a component that had silently stopped existing.
 *
 * The same judgement `handleEvent` makes a few lines up: a mistake in code the template was handed
 * is named, not raised from inside the framework at a point where the value's origin is long gone.
 * The prefix goes on our own sentence and the error is passed alongside, so it stays filterable
 * without misattributing someone else's `Error`.
 */
const applyRef = (callback: (el: Element | null) => void, element: Element | null) => {
  try {
    callback(element);
  } catch (error) {
    /** The sentence is development's; production keeps the prefix and the error carries the rest. */
    if (__DEV__) console.error('[vera] an element ref threw; the render continued without it.', error);
    else console.error('[vera] ref threw', error);
  }
};

const REF = 5; // element-position expression

class AttrPart implements Part {
  _element: Element;
  _name: string;
  _statics: string[];
  _slots: number; // how many expression values this binding consumes
  _kind: number;
  _isFullValue: boolean; // exactly one expression with no static text around it
  _committed: unknown = UNSET;
  _handler: EventListener | null = null;
  /** `<select>.value`, which cannot be applied where it is written — see `pendingSelects`. */
  _select = false;
  /** The template statically wrote this attribute, so a first nullish commit must still remove. */
  _present: boolean;

  constructor(element: Element, name: string, statics: string[], present = false) {
    const first = name[0];
    let kind =
      first === '.'
        ? PROPERTY
        : first === '?'
          ? BOOLEAN
          : first === '@'
            ? EVENT
            : first === '&'
              ? REF
              : first === '!'
                ? LIVE
                : ATTR;
    let realName = kind ? name.slice(1) : name;
    /**
     * **`__proto__` is not a property write, so no property binding may make one.**
     *
     * `element.__proto__ = value` hits `Object.prototype`'s `__proto__` ACCESSOR and replaces the
     * element's prototype, stripping every DOM method it has. `.__proto__=${x}` crashed out of the
     * commit with an unreadable internal error; `!__proto__=${x}` bricked the element silently and
     * the wreckage surfaced in a LATER render, naming the renderer rather than the binding. There
     * is no legitimate use, so unlike `.innerHTML` there is no spelling to point at — the binding
     * is refused and never writes.
     *
     * **The deliberate twin of `refusedSink` in `./spread.ts`**, which refuses the same name for
     * the same reason. The two entries are independent bundles and neither imports the other, so
     * the rule is copied on purpose (the repo's standing note: sigil rules live in both AttrPart
     * and spread, and a fix has to visit every copy). `tests/dangerous-binding-matrix.test.mjs`
     * fails if one of them starts refusing something the other allows.
     */
    if ((kind === PROPERTY || kind === LIVE) && realName === '__proto__') {
      kind = REFUSED;
      if (__DEV__)
        console.warn(
          `[vera] <${element.localName}> binds \`${name}\`, which would replace the element's own ` +
            `prototype and destroy it — no property write does this, and no use of it is legitimate. ` +
            `The binding is ignored.`
        );
    }
    /**
     * React muscle-memory, buildless: `onClick=${fn}` ≡ `@click=${fn}`. Strictly `on` + a capital —
     * all-lowercase `onclick` stays a plain attribute (legal inline-handler HTML).
     *
     * `@verajs/renderer/spread` repeats these rules rather than importing them. Sharing them through
     * `@verajs/shared-utils` was tried and reverted: the shared form has to return both the kind and
     * the name, and the tuple it allocates cost this bundle 10 B. Principle #5 allows deliberate
     * duplication where two things can legitimately diverge; here #7 decides it — weight is the
     * product, and core and the renderer are the two packages where that is absolute.
     */
    if (kind === ATTR && first === 'o' && name.charCodeAt(1) === 110 && name.charCodeAt(2) > 64 && name.charCodeAt(2) < 91) {
      kind = EVENT;
      realName = name.slice(2).toLowerCase();
    }
    /**
     * **A property write to a custom element starts as `PROP_ADOPT`**, a distinct kind so the
     * steady-state `PROPERTY` commit path stays byte-for-byte unchanged — zero added instruction
     * for every `.value=` on a built-in. Every dash-named element starts here, defined or not,
     * because the record has to exist for BOTH arrival orders: an eager component's first commit
     * lands after upgrade but before `init()` (one commit records, then the part flips), and a
     * lazy one's land before upgrade (the part records until the definition arrives). `commitAdopt`
     * decides which per commit and flips the part back to `PROPERTY` the moment something real
     * receives the property, so the window is one commit for a defined element and the pre-upgrade
     * stretch for a lazy one.
     */
    if (kind === PROPERTY && element.localName.includes('-')) kind = PROP_ADOPT;
    this._kind = kind;
    this._name = realName;
    this._element = element;
    this._statics = statics;
    this._slots = statics.length - 1;
    this._isFullValue = this._slots === 1 && statics[0] === '' && statics[1] === '';
    /** Resolved once, here, so the commit path costs one boolean rather than two comparisons. */
    this._select = kind === PROPERTY && realName === 'value' && element.localName === 'select';
    this._present = present;
  }

  /**
   * Releases an element ref, because the element it named is going away.
   *
   * A ref was told about attachment and never about detachment, so it kept a detached node alive and
   * a component reading `myRef.value` after a subtree was replaced got the old element back. Lit
   * passes `undefined` for the same reason.
   *
   * `null` rather than `undefined`, because `.value` is a store property and `null` reads as
   * "deliberately nothing" where `undefined` reads as "never set".
   *
   * **Reached when a subtree is rendered away, and deliberately not when a component is removed
   * from the document.** The two are the same event to a reader and not to this renderer: a
   * disconnect here is not a destruction, since moving a node between parents fires one and the
   * component renders again on reconnect. Releasing there would blank every ref for the frame a
   * move takes, and `_committed = UNSET` below means the re-apply could only happen on the next
   * pass. Measured in `tests/renderer-ref-lifetime.test.mjs`, which asserts both halves so the
   * asymmetry is a decision rather than something nobody looked at.
   *
   * A **self-applying** value is
   * skipped: `_$apply$` receives the part and owns its own lifecycle, so telling it about detachment
   * here would be a second protocol contradicting the first.
   */
  _release() {
    const value = this._committed;
    if (typeof value === 'function') applyRef(value as (el: Element | null) => void, null);
    else if (value !== null && typeof value === 'object' && (value as { _$apply$?: unknown })._$apply$ === undefined)
      (value as { value: unknown }).value = null;
    this._committed = UNSET;
  }

  /**
   * Stable listener; swapping one function for another never touches the DOM.
   *
   * **It is not registered exactly once, and the difference is load-bearing.** A handler set back to
   * `undefined` or `false` nulls `_handler` *without removing the listener* — inert, because
   * `handleEvent` finds nothing callable — so the next non-null value sees `_handler === null` and
   * calls `addEventListener` again. Measured: `function -> undefined -> function` registers twice.
   *
   * That is harmless only because the listener passed is **`this`, the part object itself**. The
   * platform ignores a repeated `(type, listener, capture)` triple, verified with no framework
   * involved — the same listener object added three times fires once. Pass a fresh closure here
   * instead and dedup stops applying: every toggle through null adds another live listener, silently,
   * and only in components that turn a handler off and on again.
   *
   * `tests/event-binding-fuzz.test.mjs` holds that as an invariant — it counts *fires*, not
   * `addEventListener` calls, and making this listener a closure fails it.
   *
   * **Two shapes, because `addEventListener` takes two.** A function is called with the element as
   * `this`; an object with a `handleEvent` method is invoked through it — the platform's own
   * `EventListenerObject` protocol, which every engine accepts and lit supports. This used to call
   * `.call()` unconditionally, so passing the platform's own listener shape bound successfully and
   * then threw `this._handler.call is not a function` on **every** dispatch.
   *
   * Anything else is inert rather than throwing. A truthy non-function is a mistake, and
   * development names it at the binding (see the `EVENT` branch in `_commit`) — where the mistake
   * still is. Throwing here instead would raise from inside the framework on every user click, at a
   * point where the value's origin is long gone.
   */
  handleEvent(event: Event) {
    const handler = this._handler as EventListener | EventListenerObject | null;
    if (typeof handler === 'function') handler.call(this._element as never, event);
    else if (typeof (handler as EventListenerObject)?.handleEvent === 'function')
      (handler as EventListenerObject).handleEvent(event);
  }

  /**
   * `adopting` is set only by `@verajs/renderer/hydrate`, and only changes what happens to the
   * three form-value properties the server can express in markup — see the branch below.
   */
  _commit(values: unknown[], index: number, adopting?: boolean): number {
    const kind = this._kind;
    /** Refused in the constructor and never writes — it still has to consume its slots. */
    if (kind === REFUSED) return index + this._slots;
    let value: unknown;
    if (this._isFullValue || kind >= EVENT) {
      value = values[index]; // raw and uncoerced — events and refs receive the actual value
    } else {
      const statics = this._statics;
      let joined = statics[0];
      for (let i = 0; i < this._slots; i++) joined += toText(values[index + i]) + statics[i + 1];
      value = joined;
    }
    /**
     * **A live property asks the element, not its own memory.**
     *
     * Every other kind skips a write when the value matches what it last wrote. That is what keeps
     * a field someone has typed into — and it is wrong for a control whose DOM state changes as a
     * *side effect of interacting with a sibling*. Clicking one radio unchecks the others with no
     * event on them, so their bindings still say `true`, still match `_committed`, and never write
     * again: the model and the page diverge and no amount of re-rendering reconciles them. A
     * `<select>`'s options are the same shape.
     *
     * Deliberately narrow. This is not for text inputs — bind those with `.value` and let a
     * person's typing stand. `?hidden` and plain attributes are not offered either: nothing changes
     * them behind the renderer's back, so there is nothing to re-read.
     */
    if (kind === LIVE) {
      this._committed = value;
      /**
       * **Except while adopting — on a form control.** Hydration reaches a DOM a person may
       * already have used, and the click that checked a radio happened before any handler existed
       * to tell the store about it — so re-asserting the server's choice here would throw the
       * interaction away and nothing would ever put it back. Recorded, not written, exactly as
       * the other form properties are; the first state-driven render after that applies live
       * semantics normally.
       *
       * **A COMPONENT tag is the exception to the exception**: there is no user-editable carrier
       * behind `!prop` on a component — it is a property delivery spelled with `!` — and the
       * server DELIVERED it to the child's render, so yielding here dropped the one copy the
       * client would ever get and hydration regressed the child's content to its prop-less state.
       * Found by the hydration fixture on its first run. The write is unconditional and routes
       * through the element like any component prop: an accessor receives it, an initialized
       * component adopts it live.
       */
      if (__HYDRATING__ && adopting) {
        /** Routed through `commitAdopt`, not written raw: the child hydrated BEFORE this commit,
         *  so only the adoption door re-runs its render. The part stays `LIVE` — the return is
         *  deliberately dropped — so live semantics resume on the next state-driven render. */
        if (this._element.localName.includes('-')) commitAdopt(this._element, this._name, value);
      } else {
        const liveTarget = this._element as unknown as Record<string, unknown>;
        if (liveTarget[this._name] !== value) liveTarget[this._name] = value;
      }
      return index + this._slots;
    }
    /**
     * **A `<select>`'s value cannot be applied where it is written.**
     *
     * Assigning it selects an option, and at the moment this part commits the options may not exist:
     * parts commit in document order, so a nested `${items.map(…)}` has not run, and an `<option
     * value=${id}>` has not been given its value either. The assignment then matches nothing, and the
     * select falls back to its first option — silently showing the wrong one. Measured: a nested list
     * selected index 0 instead of 1, and dynamic option values selected nothing at all.
     * **lit-html has the same defect, byte for byte** — it was measured there too. React solves it by
     * special-casing `<select value>` and applying it after children mount, which is what this is.
     *
     * Queued rather than dirty-checked, and that is deliberate: the value can be unchanged while the
     * *options* are replaced, which drops the selection just as thoroughly. Re-asserting once per
     * render pass is what keeps it right, and a select carries one binding, so it is one push.
     */
    if (this._select) {
      this._committed = value;
      /** Adoption never re-asserts a form value — the person may have changed it. See below. */
      if (!(__HYDRATING__ && adopting)) (pendingSelects ??= []).push(this._element as HTMLSelectElement, value);
      return index + this._slots;
    }
    if (value !== this._committed) {
      if (kind === ATTR) {
        /**
         * A nullish value removes the attribute — except on the first commit of a template that
         * never statically wrote it, where a fresh clone has nothing to remove. That skip used to
         * be unconditional-removal instead, for the one case that genuinely needs it:
         * `<b title="a" title=${null}>` parses keeping the first duplicate, so the binding —
         * written last, and authoritative on the server too — must clear it. `_present` is that
         * case, read off the parsed template once ever; without it the removal was a real DOM call
         * per nullish binding per element on create — 1,000 no-ops in the 1,000-row benchmark.
         */
        if (value == null) {
          if (this._present || this._committed !== UNSET) this._element.removeAttribute(this._name);
        }
        else {
          /**
           * The same question `@verajs/renderer/spread` asks at its own sink, from the same home —
           * the two are deliberately separate implementations (see spread's header on why), and a
           * diagnostic that lived in only one of them would be the very defect this audit found.
           * `setAttribute` performs the DOMString conversion itself; nothing is stringified here.
           */
          if (__DEV__) {
            const complaint = attributeValueComplaint(this._element.localName, this._name, value);
            if (complaint !== null) console.warn(`[vera] ${complaint}`);
          }
          this._element.setAttribute(this._name, value as string);
        }
      } else if (kind === PROPERTY) {
        const target = this._element as unknown as Record<string, unknown>;
        const name = this._name;
        /**
         * **Adopting a form value: record it, do not write it.**
         *
         * `value`, `checked` and `selected` are exactly the properties `@verajs/ssr` mirrors into
         * markup, so the element already holds what this binding says — *unless a person changed
         * it*, which is the entire reason to server-render: the page is usable before the bundle
         * lands, and the window between the two is where someone types their name, ticks a box or
         * picks an option. Writing the binding then threw that away, silently, on every hydrating
         * page. The part is told it already committed this value, so it stays live and the next
         * genuine state change still applies.
         *
         * Only these three, and only while adopting. A property the server cannot express — any
         * other `.prop` — is not in the DOM yet and must be written.
         */
        if (__HYDRATING__ && adopting && (name === 'value' || name === 'checked' || name === 'selected')) {
          this._committed = value;
          return index + this._slots;
        }
        /**
         * No un-upgraded custom element can be behind this write: a dash-named property part is
         * born `PROP_ADOPT` and only flips here once something receives the property, so the
         * pre-upgrade window — the clobber, its repair for components, and the `whenDefined`
         * detector for elements that never drain — lives entirely in `commitAdopt` above. History
         * worth keeping: an earlier repair was tried HERE and removed as silently partial (it
         * re-applied on `undefined`, so `item = someDefault` never looked clobbered); the record
         * the drain re-applies unconditionally is what answered that objection.
         */
        target[name] = value;
      } else if (kind === BOOLEAN) {
        /** Unconditional for the same reason: `<b hidden ?hidden=${false}>` must end up not hidden. */
        this._element.toggleAttribute(this._name, !!value);
      } else if (kind === EVENT) {
        /**
         * A listener is the most deferred call a template makes — it is validated when a *user*
         * clicks, which in development may be never. So it is checked where it is written, the same
         * rule the setters took on: the stack at dispatch no longer contains the binding.
         *
         * `false` is deliberately allowed and silent. `@click=${enabled && onClick}` is the ordinary
         * way to bind conditionally and produces exactly that, and it already behaves correctly —
         * `handleEvent` finds nothing callable and does nothing. `true` is not produced by any
         * idiom, so it is named along with strings, numbers and objects that cannot listen.
         */
        if (__DEV__ && value != null && value !== false && typeof value !== 'function' &&
            typeof (value as EventListenerObject)?.handleEvent !== 'function')
          console.warn(
            `[vera] @${this._name} on <${this._element.localName}> was given ${typeof value === 'object' ? 'an object with no handleEvent method' : `a ${typeof value}`}, ` +
              `which cannot listen — the event will do nothing.\n` +
              `Pass a function, or an object with a handleEvent method. A missing handler is ` +
              `\`undefined\` or \`false\`, both of which are fine; this is neither.`
          );
        if (this._handler === null && value != null) this._element.addEventListener(this._name, this);
        this._handler = (value as EventListener) ?? null;
      } else if (kind === PROP_ADOPT) {
        const next = commitAdopt(this._element, this._name, value);
        if (next !== 0) this._kind = next;
      } else if (value != null) {
        /**
         * Element ref: `<input ${myRef} />`. A function is called with the element; an object gets
         * the element assigned to `.value` — which makes core's own `ref()` double as an element
         * ref, reactively. Runs once per distinct value, not once per render.
         */
        notifyOnRemoval = true;
        if (typeof value === 'function') applyRef(value as (el: Element | null) => void, this._element);
        else if (typeof value === 'object') {
          /**
           * A self-applying value: anything that knows what to do with an element applies itself.
           * `@verajs/renderer/spread` is the first, and the whole protocol is this one property
           * read — the implementation lives in that entry, so an app that never spreads pays for
           * the check and nothing else. `_$…$` is exempt from property mangling, like `_$litType$`.
           *
           * Deliberately confined to the element position, which is rare. A protocol in the text,
           * attribute or property commits would sit in the hot path every benchmark measures.
           */
          const self = value as { _$apply$?: (el: Element, part: object) => void; value: unknown };
          /** The part is passed as the ownership key: one element can carry several spreads. */
          if (self._$apply$) self._$apply$(this._element, this);
          else self.value = this._element;
        }
        // any other value type at element position is consumed and ignored
      }
      this._committed = value;
    }
    return index + this._slots;
  }
}

/**
 * `<select>.value` assignments held until the whole pass has committed — see the note in `_commit`.
 * Flat pairs rather than tuples: one array, no per-entry allocation.
 */
let pendingSelects: unknown[] | null = null;

const flushSelects = () => {
  const queued = pendingSelects;
  if (queued === null) return;
  /** Cleared first: an assignment can run a `change` handler that renders again. */
  pendingSelects = null;
  for (let i = 0; i < queued.length; i += 2)
    (queued[i] as HTMLSelectElement).value = queued[i + 1] as string;
};

const SCRATCH = doc.createDocumentFragment();

/**
 * Marks a node as the render root's OWN output — see `ChildPart._insert`. Sigil-named so property
 * mangling cannot rename it: this is read by `@verajs/renderer/slots`, across a bundle boundary,
 * and a module-scoped Symbol would be minted twice on a CDN page (the `@verajs/styles` lesson).
 *
 * A fragment is stamped through to its children, because inserting one moves the children and the
 * fragment itself never enters the document — the observer reports the children.
 *
 * **Defined rather than assigned, so it is NON-ENUMERABLE.** A plain `node._$own$ = true` is an own
 * enumerable property: measured, it then shows up in `Object.keys(element)` — which is `[]` for
 * every other DOM element — and in `for…in`. Invisibility to everything outside the framework is
 * the whole reason this is a property and not a marker or an attribute, and an enumerable one is
 * not invisible. The descriptor is shared, so this allocates nothing per node, and the path is
 * gated on slots being wired, so no app that does not use them ever reaches it.
 */
const OWN_DESCRIPTOR: PropertyDescriptor = { value: true, enumerable: false, configurable: true, writable: true };
/**
 * The stamp is VALUED, and the value is the discriminator (`docs` in the slots module read it):
 *
 *   `true`        — the render root's own output: never slot content.
 *   a ChildPart   — light content PLACED by that part from an outer template. The part identity
 *                   is the ordering group: a grown row belongs after ITS part's other rows, and
 *                   `<host>${a}${b}</host>` must not interleave a's refill into b's content —
 *                   which is exactly what happens if the group is the render root, shared by both.
 *   absent        — an imperative user mutation; the light region orders it by document position.
 *
 * One shared, mutated descriptor: `defineProperty` reads it synchronously, so this allocates
 * nothing per node while keeping the property non-enumerable (see the invisibility note above).
 */
const stampOwn = (node: Node, value: true | object = true) => {
  OWN_DESCRIPTOR.value = value;
  if (node.nodeType === 11) {
    for (let child = node.firstChild; child !== null; child = child.nextSibling)
      Object.defineProperty(child, '_$own$', OWN_DESCRIPTOR);
    return;
  }
  Object.defineProperty(node, '_$own$', OWN_DESCRIPTOR);
};

/** A row is either an element-mode instance or a markered part; both can hold appliers. */
const detachItem = (item: Item) => {
  item._instance?._teardown();
  item._part?._detach();
};

/**
 * **These three stay here rather than in `types.ts`, and the reason is structural.**
 *
 * `ListStrategy` names the `ChildPart` class and `Item` names `Instance`, which puts both
 * downstream of this file in the import graph — a `types.ts` that imported them would stop being
 * the graph's root, which is the single property §1 asks of it. `KeyedResult` composes
 * `ListStrategy` and inherits the same position. Restating those classes structurally in
 * `types.ts` to satisfy the letter of the rule would create the twin §1 forbids, so the rule
 * records the limit instead.
 */

/**
 * A value that names the strategy able to reconcile a list of its kind. `keyed()` in
 * `@verajs/renderer/keyed` is the only producer today; the shape is deliberately open so a
 * virtualizer or an async list can ship as its own module without this file learning about it.
 *
 * `$r` and the three members it calls are exempt from property mangling — they are the only names
 * that cross a bundle boundary, and they are two characters so crossing costs nothing.
 */
export type ListStrategy = (
  part: ChildPart,
  values: unknown[],
  items: Item[],
  parent: Node,
  end: Node | null
) => Item[];

/**
 * A `TemplateResult` that `keyed()` has marked, so the child part reconciles it as a list instead
 * of replacing the subtree. `$r` is absent on every ordinary template, which is what keeps the
 * unkeyed path free of any list machinery.
 */
export interface KeyedResult extends TemplateResult {
  $r?: ListStrategy;
}

/**
 * A list item is either ELEMENT-MODE — a single-root template instance whose one element IS the
 * item's boundary (`_element`/`_instance`/`_shape` set, `_part` null) — or a general markered
 * ChildPart. Rows are single-root in virtually every real list, and element mode drops both marker
 * comments and both marker inserts per item, which is exactly the per-row overhead a vdom does not
 * pay on create.
 */
type Item = {
  $k: unknown;
  _element: Element | null;
  _instance: Instance | null;
  _shape: TemplateStringsArray | null;
  _part: ChildPart | null;
};

class Instance {
  _parts: Part[] = [];
  _fragment: DocumentFragment;
  /**
   * **`declare`, so nothing is emitted and no instance carries these unless it uses them.**
   * Under ES2022 class-field semantics a plain `_x?: T` is DEFINED on every instance, undefined or
   * not — measured, two such declarations cost every row of a 200-row list a property apiece and
   * showed up as a few percent off update throughput. Templates without slots now allocate exactly
   * what they did before this feature existed, and the ones with slots take a shape transition
   * once.
   *
   * `_slotStates` — taken-over slot states, parked at teardown.
   * `_pendingSlots` — resolved `<slot>` clones awaiting mount; cleared by the first `_update`.
   */
  declare _slotStates?: SlotSeamState[];
  declare _pendingSlots?: Element[];
  constructor(template: Template) {
    /**
     * `importNode`, not `cloneNode` — the difference is custom-element upgrade, not the document.
     * Template content lives in the inert template document, so `cloneNode` copies stay
     * un-upgraded until insertion; a `.prop` committed in that window lands as an OWN property
     * that permanently shadows a defined class's setter (the setter never fires — every
     * accessor-based element, Lit's included, receives a dead value) and a bound value on a
     * class-field element is clobbered by the field initializer at insert, silently, because the
     * `whenDefined` detector below only watches definitions that arrive LATE. Hydration commits
     * onto server-parsed, already-upgraded elements, so the two render paths disagreed about the
     * same template. `importNode`'s cloning steps upgrade defined elements at clone time — in
     * every engine and in jsdom — which makes the commit order match hydration and the platform.
     * Undefined elements are untouched: nothing can upgrade them, and the pre-upgrade posture
     * (own property, clobber on define, development warning) stands as pinned in
     * `tests/pre-upgrade-property.test.mjs`. Measured cost of losing `cloneNode`: ~2–7% of the
     * raw clone operation across the three engines — nanoseconds per instance.
     */
    this._fragment = doc.importNode(template._element.content, true);
    const templateParts = template._parts;
    /** Shared walker, ELEMENT | TEXT — child anchors are the primed text nodes themselves. */
    instanceWalker.currentNode = this._fragment;
    let nodeIndex = -1;
    let node: Node | null = null;
    for (let i = 0; i < templateParts.length; i++) {
      const templatePart = templateParts[i];
      if (templatePart._type === IGNORED) {
        this._parts.push(IGNORED_PART);
        continue;
      }
      while (nodeIndex < templatePart._index) {
        node = instanceWalker.nextNode();
        nodeIndex++;
      }
      this._parts.push(
        templatePart._type === CHILD
          ? new TextPart(node as Text)
          : new AttrPart(node as Element, templatePart._name!, templatePart._statics!, templatePart._present)
      );
    }
    /**
     * Slot records mount OUTSIDE the parts array — one extra walk from the top, paid only by
     * templates that HAVE slots, only inside a renderInto commit (null root — hydration's
     * adoption path — stays inert), and only when the 'slot' insert answers. Taking over sets
     * `notifyOnRemoval`: `_$park$` must rescue the USER'S nodes before a bulk `_clear` discards
     * the DOM holding them on a branch-away. `_update` never sees any of this.
     */
    if (template._seam !== undefined && _slotRoot !== null) {
      const slotRecords = template._slots!;
      /**
       * RESOLVE every slot element to its clone in ONE walk, and mount them AFTER the first
       * `_update` — see `_mountSlots`. Collect-then-act, because the seam MUTATES the fragment
       * (it lifts each `<slot>` out and drops in anchors) and a walk that interleaved resolution
       * with those mutations would read shifted indices and miss later slots.
       */
      instanceWalker.currentNode = this._fragment;
      nodeIndex = -1;
      const slotNodes: Element[] = [];
      for (let i = 0; i < slotRecords.length; i++) {
        while (nodeIndex < slotRecords[i]) {
          node = instanceWalker.nextNode();
          nodeIndex++;
        }
        slotNodes.push(node as Element);
      }
      this._pendingSlots = slotNodes;
    }
    /** Standalone rather than an `else` branch: `_slotless` is only ever set when there was no
     *  seam, so the condition stands alone — and a lone `if (__DEV__ …)` folds away cleanly. */
    if (__DEV__ && template._slotless === true && _slotRoot !== null && _slotRoot.nodeType === 1) {
      /**
       * **A `<slot>` in a LIGHT render that nothing will distribute.** Both ways of arriving here
       * are silent otherwise, and both leave the same confusing picture. Measured, for a host given
       * `<b slot="a">MINE</b>`:
       *
       *     <b slot="a">MINE</b><!----><div class="box"><slot name="a">FB</slot></div>
       *
       * — the content is not destroyed, it is stranded ahead of the render while the slot shows its
       * fallback. The message says "any content the host is given" rather than asserting the host
       * HAS some: a component that consumes its own children before rendering and also declares
       * slots — `@verajs/ui`'s select is one — warns with nothing stray on the page, and a reader
       * sent looking for markup that is not there concludes the diagnostic is confused.
       *
       * 1. `@verajs/renderer/slots` was never wired at all.
       * 2. It was wired AFTER this template first rendered. Templates are interned per call site
       *    for the life of the page and resolve the seam once, at construction — so a component
       *    that rendered before the wiring keeps a slotless template forever, and every later use
       *    of it fails the same way. Measured: the same `draw()` distributes at a fresh call site
       *    and not at this one.
       *
       * A shadow root never reaches here: the platform slots there, which is why this is gated on
       * an element root.
       */
      warnSlotless(_slotRoot as Element);
    }
  }

  /**
   * One walk, both jobs: release the element refs in this instance and tell any child applier
   * under it that it is going away.
   *
   * They were two walks over the same array — `_release` for refs, `_detach` for appliers — which
   * is the same tree traversed twice for two answers that arrive at the same moment. Merged, the
   * per-part cost is one `_kind` compare and one `_upgraded` read.
   *
   * Reached only when this instance's template holds a ref, or some applier somewhere declared
   * teardown. An app with neither never runs it: this is the per-node work the bulk removal exists
   * to skip, and the gate is what keeps it out of the path.
   *
   * Through `_upgraded`, not just `_parts`. A child position is instantiated as a `TextPart` and
   * **upgrades** to a `ChildPart` the first time it takes an object — so the part holding a
   * applier is almost never the one in this array, it is the one that array's entry points at.
   * Walking `_parts` alone found nothing at all.
   */
  _teardown() {
    const parts = this._parts;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if ((part as AttrPart)._kind === REF) (part as AttrPart)._release();
      (part as TextPart)._upgraded?._detach();
    }
    /** Taken-over slots park the USER'S nodes before this instance's DOM is discarded. */
    this._slotStates?.forEach((state) => state._$park$?.());
  }

  _update(values: unknown[]) {
    let valueIndex = 0;
    const parts = this._parts;
    for (let i = 0; i < parts.length; i++) valueIndex = parts[i]._commit(values, valueIndex);
    if (this._pendingSlots !== undefined) this._mountSlots();
  }

  /**
   * **Slots mount after the first `_update`, not during construction, because a `<slot>`'s own
   * bindings are part of its meaning.** `<slot name=${section}>` has no name at all until its
   * `AttrPart` has committed, and mounting first read the static markup and got `''` — the slot
   * registered as a second DEFAULT slot, took the default content, and left the real default slot
   * showing fallback. Committing first also means `@slotchange` and `&ref` are already attached to
   * the element by the time anything is dispatched on it.
   *
   * Once per instance: the fields are cleared here and every later `_update` costs one compare.
   */
  _mountSlots() {
    const slotNodes = this._pendingSlots!;
    this._pendingSlots = undefined;
    /**
     * `_slotRoot` still holds the container: it is set for the whole of one `renderInto` and every
     * instance under it — nested templates included — is constructed and first-updated inside that
     * same synchronous span, so this is the root the constructor saw.
     */
    const root = _slotRoot;
    const seam = slotSeam();
    if (seam === undefined || root === null) return;
    for (let i = 0; i < slotNodes.length; i++) {
      const slot = slotNodes[i];
      const state = seam(slot, root, slot.getAttribute('name') ?? '');
      if (state != null) {
        (this._slotStates ??= []).push(state);
        notifyOnRemoval = true;
      }
    }
  }
}

/** A single property read — this runs once per list item per render, so it must be minimal. */
const isTemplateResult = (value: object): value is TemplateResult =>
  (value as TemplateResult).strings !== undefined;

/**
 * The common case of a child expression is plain text, and the template primes every child slot
 * with a text node — so the steady state is compare-and-assign on `.data`. This part carries only
 * that, upgrading itself to a full ChildPart the first time it sees null, a template, or an array.
 */
/**
 * **A boolean in a child position renders the WORD, and almost nobody means that.**
 *
 * `${items.length > 0 && html`…`}` is the ordinary conditional idiom, and when the test is false
 * the whole expression is `false` — which becomes the text `false` on the page. Nothing throws;
 * the value is legitimate; only the intent is wrong. lit-html does the same and this renderer
 * matches it deliberately (anything not nullish renders), so the BEHAVIOUR stays and the mistake
 * is named where it happens instead of being found by looking at the page.
 *
 * `@verajs/jsx` compiles this case away — in JSX a boolean child becomes nothing, React's rule,
 * because that is where React expectations live. **That is the one value semantic on which JSX and
 * a hand-written template differ**, which makes this the warning that meets JSX-shaped code pasted
 * into a template.
 *
 * Called from BOTH child sinks, because a text position is a `TextPart` until something upgrades
 * it and a boolean never triggers that upgrade — putting the check in `ChildPart` alone left it
 * silent for exactly the common case. One function, two call sites, per the standing rule that a
 * deliberate duplication is a fix's second address.
 *
 * Both sinks gate this on the value CHANGING — not merely on reaching a commit — so an unchanged
 * `false` is reported once and not once per render. `ChildPart` needed that stated explicitly: its
 * dirty check sits below, and calling this above it spammed every pass.
 */
const warnBooleanChild = (value: unknown): void => {
  if (typeof value !== 'boolean') return;
  console.warn(
    `[vera] renderer: a child position was given \`${value}\`, which renders as the word ` +
      `"${value}" — the usual cause is \`\${cond && …}\` with a false \`cond\`.\n` +
      `Write \`\${cond ? … : null}\`, or \`\${(cond && …) || null}\`; \`null\` and \`undefined\` are ` +
      `the values that render nothing. If you meant to display the boolean, say so with ` +
      `\`\${String(value)}\` and this goes quiet.`
  );
};

class TextPart implements Part {
  _text: Text;
  _value: unknown = '';
  _upgraded: ChildPart | null = null;

  constructor(text: Text) {
    this._text = text;
  }

  _commit(values: unknown[], index: number): number {
    const value = values[index];
    if (this._upgraded !== null) {
      this._upgraded._set(value);
      return index + 1;
    }
    if (value == null || typeof value === 'object') {
      /**
       * Upgrade in place: marker comments come into existence only now, anchored around the text
       * node, and the full part inherits the committed text state and delegates forever.
       *
       * BOTH markers are ours. Borrowing `this._text.nextSibling` as the end instead would hand
       * this part a boundary owned by the NEXT part — and the next part removes that very node
       * when it upgrades and clears its own text. The stale reference then makes `_clear()` walk
       * past the end of the child list. Owning both anchors also makes `_end === null` mean
       * exactly one thing: the root part, which really does own its container.
       */
      const start = comment();
      const end = comment();
      /**
       * **Markers go where the part LIVES, which is not always where its text node is.** In a
       * light host wired for slots, this text node was captured and distributed into the
       * component's tree — planting markers beside it there put them inside the slot's range,
       * the slot's next fill swept them into the holding fragment, and the part spent the rest
       * of the page rendering into detached space (measured: `<host>${text}</host>` toggling
       * through null showed FALLBACK forever). `_$home$` answers with the host's light-region
       * sentinel for a captured node and null for everything else, so every app without light
       * slots takes the second branch untouched.
       */
      const home = slotSeam()?._$home$?.(this._text) ?? null;
      const parent = home !== null ? home.parentNode! : this._text.parentNode!;
      if (home !== null) {
        parent.insertBefore(start, home);
        parent.insertBefore(end, home);
      } else {
        parent.insertBefore(start, this._text);
        parent.insertBefore(end, this._text.nextSibling);
      }
      const part = new ChildPart(start, end);
      part._mode = TEXT;
      part._text = this._text;
      part._value = this._value;
      this._upgraded = part;
      part._set(value);
      return index + 1;
    }
    if (value !== this._value) {
      if (__DEV__) warnBooleanChild(value);
      this._value = value;
      this._text.data = value as string;
    }
    return index + 1;
  }
}

/**
 * A value at a child position that applies itself — see `ChildPart._set`.
 *
 * `previous` is whatever this applier returned at this part on the last render, which is where a
 * applier keeps its continuity. Returning nothing is fine for one that has none.
 */
type Applier = ((part: { _$commit$(value: unknown): void }, previous: unknown) => unknown) & {
  /**
   * Optional teardown, hung on the **applier** rather than on the value.
   *
   * The applier is already required to be hoisted — a fresh function per render breaks continuity —
   * so it is the one stable object in the protocol and the natural place for a second half. It
   * receives whatever the applier last returned, which is where its state lives.
   */
  _$detach$?: (previous: unknown) => void;
};

/**
 * A value at a child position the renderer has no built-in answer for. Return `true` to claim it.
 *
 * A handler will also be handed the **operations** it needs to do its job — the shape
 * `'proxy-handler'` uses, where core passes `addCallback` and `runCallbacks` rather than exposing
 * them as members. That object is deliberately *not* here yet: an earlier draft guessed nine
 * methods, nothing used them, they cost 90 B of anticipation, and porting the list algorithm then
 * showed it needs closer to fourteen — including item accessors the guess had no idea about. It
 * gets built in the step that has a caller to shape it.
 *
 * This is how a value *kind* becomes a package rather than a branch: lists, an async value, a
 * portal, a virtualizer. The built-ins below register through it too, so a third party's kind is
 * not second-class to one that shipped in the box.
 */
type ValueHandler = (part: object, value: unknown) => boolean | void;

/**
 * The registry this renderer reads `'value'` handlers from, handed over by {@link renderer}.
 *
 * Not imported. The renderer carries no registry of its own for the same reason the router does
 * not: a production bundle inlines `@verajs/inserts`, so importing it would give this package one
 * registry and core another, and an app would register into whichever it happened to import — the
 * failure `connectInserts` used to repair.
 */
let registry: { get(name: 'value' | 'slot'): unknown[] | undefined } | null = null;

/**
 * The ONE lookup for the `'slot'` insert. Three callers want the same thing in the same shape —
 * template construction (are there slots to record?), the first render into a container (capture
 * the host's children), and hydration's rescue (un-distribute before a mismatch discards) — and
 * the seam carries its cross-bundle members as sigil-named keys, which every caller had to spell
 * out again. One accessor, spelled once.
 */
/**
 * **Whether ANY app on this page wired light slots**, latched the first time the seam answers.
 *
 * The ownership stamp in `_insert`/`$c` exists only for `@verajs/renderer/slots` to read, and its
 * guard has to be free for everyone else — `_slotRoot` is set for every `renderInto`, so without
 * this an app with no slots at all would stamp every top-level node it renders, which for a list
 * at the root is a property write per ROW. One boolean instead, false for the life of a page that
 * never wires them.
 */
let slotsWired = false;
const slotSeam = (): SlotSeam | undefined => {
  const seam = (registry?.get('slot') as SlotSeam[] | undefined)?.[0];
  if (seam !== undefined) slotsWired = true;
  return seam;
};
const noHandlers: ValueHandler[] = [];
const valueHandlers = () => (registry ? ((registry.get('value') as ValueHandler[] | undefined) ?? noHandlers) : noHandlers);

/**
 * Kinds this package still ships. They read from a local list rather than the registry because the
 * renderer cannot register into one it was merely handed — that needs `wire`, which it does not
 * import. The list empties when they move to packages; until then a wired handler is checked first,
 * so a module can pre-empt a built-in exactly as the priority order promises.
 */
const builtIns: ValueHandler[] = [];

/**
 * Whether anything in this process has asked to be told when a subtree is removed — an element ref
 * to release, or a child applier that declared `_$detach$`.
 *
 * **One flag for both, and it is process-wide.** Teardown cannot be discovered from the template the
 * way a ref can — a ref is a `&` part the scan sees, while an applier arrives as a *value* and no
 * template shape predicts it — so the coarser gate is the only one that serves both.
 *
 * The finer, per-template gate for refs was measured and dropped: it saved 34 B less than nothing,
 * because the walk it avoided is not the expensive part. With one unrelated ref on the page, a
 * 1 000-row clear walks 1 000 instances and measures 3.98 ms against 4.03 ms with no ref at all —
 * the DOM removal dominates completely. What matters is that an app asking for neither walks
 * **zero**, and that still holds.
 */
let notifyOnRemoval = false;

/**
 * The hydrate entry's way to raise the flag. Every CLIENT path that creates removal work sets
 * `notifyOnRemoval` where the work is created (a ref committing, a slot mounting, an applier
 * declaring `_$detach$`) — but hydration ADOPTS its seams through its own walk in `hydrate.ts`,
 * a different module compiled into the same bundle, and a page whose only seams were adopted
 * left the flag down. `_clear` then skipped `_detach` entirely: no `_teardown`, no `_$park$`,
 * and the user's server-adopted slotted content was destroyed on the first branch-away — the
 * exact content-loss class the seam's park exists to prevent, reintroduced one entry over.
 */
export const declareRemovalWork = (): void => {
  notifyOnRemoval = true;
};

/**
 * Dev-only: how many times a part has seen a *different* child applier. See the branch that reads it.
 *
 * `@__PURE__` is load-bearing. Every read sits behind `__DEV__`, but a bare `new WeakMap()` at module
 * scope is a constructor call terser must assume has side effects, so production kept the allocation
 * with its binding dropped — a literal `new WeakMap;` statement building an object nothing could ever
 * reach. The annotation is what lets the dead branch take it along.
 */
const _applierSwaps = /* @__PURE__ */ new WeakMap<object, number>();

/** What a ChildPart currently contains. */
const EMPTY = 0;
const TEXT = 1;
const TEMPLATE = 2;
const LIST = 3;
const NODE = 4;

/**
 * Development-only profiling hook, armed by `@verajs/renderer/profiler`. Null until something
 * arms it, so an unprofiled development render pays one null check per template commit.
 *
 * Every reference sits behind `__DEV__`, which `defineDev()` folds to `false` before terser runs —
 * so the declaration, the constants and every call site are removed from the production bundle.
 * Verified by byte comparison, not assumed.
 */
const PROFILE_UPDATE = 0; // same template identity — values committed in place
const PROFILE_CREATE = 1; // first template into an empty part
const PROFILE_REBUILD = 2; // template identity CHANGED — subtree torn down and rebuilt
const PROFILE_FRAME_START = 3;
const PROFILE_FRAME_END = 4;

type ProfileHook = (kind: number, subject: unknown, shape: TemplateStringsArray | null) => void;
let _profileHook: ProfileHook | null = null;
/** @internal */
const _setProfileHook = (fn: ProfileHook | null) => {
  _profileHook = fn;
};

class ChildPart implements Part {
  _start: Comment;
  /** Exclusive end of this part's range; null means "to the end of the parent". */
  _end: Node | null;
  _mode = EMPTY;
  _value: unknown;
  _text: Text | null = null;
  _instance: Instance | null = null;
  /** The committed template's strings identity — the same-template fast path in `_set`. */
  _shape: TemplateStringsArray | null = null;
  _items: Item[] | null = null;
  _keyedList = false;
  /** Held instances by template identity; survives clears so state outlives interim content. */
  _held: Map<TemplateStringsArray, Instance> | null = null;
  /**
   * `__DEV__` only: the real destination for a part built inside a batching fragment, so the
   * diagnostic resolves against where the row LANDS rather than the fragment it was assembled in.
   * `declare`, so nothing is emitted and no part carries it.
   */
  declare _foreignHost?: Node | null;
  /** Whatever the last `_$child$` at this part returned — its continuity across renders. */
  _applierState: unknown = undefined;
  /** Which applier that state belongs to, so two of them at one part cannot read each other's. */
  _applier: unknown = undefined;

  constructor(start: Comment, end: Node | null) {
    this._start = start;
    this._end = end;
  }

  _commit(values: unknown[], index: number): number {
    this._set(values[index]);
    return index + 1;
  }

  /**
   * **A component's own output is STAMPED, so the slot system cannot mistake it for content.**
   *
   * `@verajs/renderer/slots` captures a top-level element carrying a `slot` attribute as the
   * host's content — which a component's own rendered root may legitimately be, when it renders
   * something destined for ITS parent's slot. Measured: with slots wired,
   * `renderInto(html\`<div slot="x">…</div>\`, element)` distributed the component's output into
   * its own holding fragment and the component rendered NOTHING, on the first render, with no
   * children involved and nothing thrown.
   *
   * The renderer is the one party that knows: it is inserting at the top level of the container
   * it was asked to render into. `_slotRoot` is that container for the whole of one `renderInto`,
   * so `parent === _slotRoot` is exactly "this is the component's own output" and distinguishes it
   * from `<x-card>${value}</x-card>`, where the part's parent is the host but the render root is
   * an ancestor — the user's light content, which must still be captured.
   *
   * Two comparisons on a path that is already touching the DOM, and the stamp is a PROPERTY:
   * invisible to CSS, to serialization and to `children`, unlike any marker or attribute, and it
   * rides on text nodes, which no attribute can. An app without slots wired writes it and nothing
   * ever reads it.
   */
  /**
   * **One property read decides all stamping, and root-part-ness decides the value.**
   *
   * `_$hosted$` is set on the host element itself by `@verajs/renderer/slots` at capture, so
   * "does anything care about ownership here" is a single own-property read — no seam call, no
   * registry lookup, and pages that are not captured hosts (every container in most apps) cost
   * exactly that read and write nothing. The mark cannot go stale in the direction that matters:
   * a part's first commit runs in a detached fragment before its host is captured, reads
   * `undefined`, and stamps nothing — and that content is exactly what the initial capture walk
   * lifts anyway. Every later commit sees the mark.
   *
   * The VALUE is structural, not temporal. `_end === null` is true of root parts alone (see
   * `_clear`), and a root part's inserts are by definition the render's own output — a fact that
   * stays true for an applier committing from a microtask hours after `renderInto` returned,
   * where the earlier `parent === _slotRoot` test read null and left ASYNC output unstamped for
   * the flipped capture rule to eat. Everything else inserting into a host is placing content
   * INTO it from outside, stamped with the part — the ordering group.
   */
  _insert(node: Node) {
    const parent = this._start.parentNode!;
    if (slotsWired && (parent as { _$hosted$?: boolean })._$hosted$ === true)
      stampOwn(node, this._end === null ? true : this);
    /**
     * Captured BEFORE the insert, because `insertBefore` empties a fragment — and only when the
     * parent is foreign, so an ordinary insert allocates nothing even in development.
     */
    if (__DEV__) {
      /**
       * ONE node answers both questions. Reading the namespace from `parent` while the host came
       * from `_foreignHost` handed a batched fill the SVG advice for a MathML host, because a
       * `DocumentFragment` has no namespace at all — the very thing `_foreignHost` exists to skip.
       *
       * **`parent` WINS whenever it is a real element, and `_foreignHost` is only the fallback for
       * a fragment.** Preferring the stored value unconditionally cached a wrong answer for the
       * life of the page: a list part at the TOP LEVEL of its template — which is what `<>{items}</>`
       * compiles to — has its markers in that template's own fragment when `$c` records the host,
       * so it stored a detached `DocumentFragment`, `foreignHost` read no namespace off it, and
       * every later commit through that row was silent even once the markers sat in a live `<g>`.
       * That is precisely the cached-fragment failure the changeset records as measured and
       * rejected for inferring namespace from the DOM parent, reproduced one layer in. By the time
       * this runs `parent` is authoritative wherever it is an element, so it is consulted first.
       */
      const hostNode = parent.nodeType === 11 ? (this._foreignHost ?? parent) : parent;
      const host = foreignHost(hostNode);
      const inserted = host === null ? null : node.nodeType === 11 ? [...node.childNodes] : [node];
      parent.insertBefore(node, this._end);
      if (inserted !== null) warnForeignMismatch(host!, (hostNode as Element).namespaceURI, inserted);
    } else {
      parent.insertBefore(node, this._end);
    }
  }

  /**
   * Tells every child applier under this part that it is going away.
   *
   * Reached only when some applier somewhere declared teardown — see `notifyOnRemoval` — because
   * this is the per-node walk the bulk removal exists to skip. **Every** removal path calls it, not
   * just `_clear`: a keyed row is dropped by moving its nodes to a scratch fragment and an index-mode
   * list shrinks by removing nodes directly, so a version that only hooked `_clear` notified a
   * applier when its container was replaced and stayed silent when its row was deleted — told
   * sometimes, which is a worse contract than never.
   */
  _detach() {
    if (this._applier !== undefined) (this._applier as Applier)._$detach$?.(this._applierState);
    this._instance?._teardown();
    const items = this._items;
    if (items != null) for (let i = 0; i < items.length; i++) detachItem(items[i]);
  }

  _clear() {
    /**
     * One gate, two jobs. A template that holds an element ref must release it; a subtree holding a
     * applier that declared teardown must be told. Both are found by the same walk, and an app
     * with neither reads two booleans and walks nothing.
     */
    if (notifyOnRemoval) this._detach();
    const parent = this._start.parentNode!;
    const end = this._end;
    const items = this._items;
    /**
     * **Content that is no longer between the markers.** `@verajs/renderer/slots` distributes a
     * light host's children by MOVING them into the component's tree, so a part rendering those
     * children keeps its markers in the host while its content lives inside the component.
     *
     * Both branches below are wrong for that, and wrong in opposite directions. The walk finds
     * the markers adjacent and removes nothing — the content stays on screen after being cleared
     * (a template swap in a light host showed the OLD template forever). The whole-parent fast
     * path is the dangerous one: it would `textContent = ''` the HOST, component render and all.
     *
     * Every mode knows its content by IDENTITY, which is parent-agnostic and split-proof: items
     * through `$m`, TEXT through `_text`, NODE through `_value`, TEMPLATE through the top-level
     * node array recorded at commit. The one shape that cannot be found this way is a
     * DocumentFragment committed at NODE position (its children scatter and it keeps no record);
     * that falls through to the walk, as before.
     */
    if (this._start.nextSibling === end && this._mode !== EMPTY) {
      if (items !== null) {
        for (const item of items) if (item !== null) this.$m(item, null, SCRATCH);
        SCRATCH.textContent = '';
      } else if (this._mode === TEXT) {
        (this._text as ChildNode | null)?.remove();
      } else if (this._mode === TEMPLATE) {
        if (Array.isArray(this._value)) for (const node of this._value as ChildNode[]) node.remove();
      } else if (this._mode === NODE && typeof (this._value as ChildNode).remove === 'function') {
        (this._value as ChildNode).remove();
      }
    } else /**
     * When this part owns its parent's entire contents, one `textContent = ''` replaces removing
     * every node individually. For a 1 000-row table body that is the difference between ~22 ms
     * (lit-html's per-node teardown) and ~5 ms.
     *
     * A part owns the whole parent when nothing precedes its start AND nothing follows its end —
     * `_end === null` (a root part, which runs to the end by definition) or `_end` is the last
     * child. The second case is the common one and used to miss this path entirely: every list
     * written as `<tbody>${rows}</tbody>` sits inside a template, and since 0.1.2 a nested part
     * always owns an end marker, so `_end === null` alone never held for it.
     *
     * Re-appending both anchors in order restores the part's boundary exactly as it was.
     */
    if (this._start.previousSibling === null && (end === null || end.nextSibling === null)) {
      parent.textContent = '';
      parent.appendChild(this._start);
      if (end !== null) parent.appendChild(end);
    } else {
      let node = this._start.nextSibling;
      /**
       * `node !== null` is a backstop, not an expected exit. Reaching the end of the child list
       * without meeting `_end` means something detached this part's boundary; stopping leaves
       * nodes behind, which beats throwing out of the middle of a render pass.
       */
      while (node !== null && node !== this._end) {
        const next = node.nextSibling;
        parent.removeChild(node);
        node = next;
      }
    }
    this._mode = EMPTY;
    this._text = null;
    this._instance = null;
    this._items = null;
    this._shape = null;
    this._applierState = undefined;
    this._applier = undefined;
  }

  /**
   * How a child-position applier renders. Named to survive property mangling — `/^_[a-z]/` is the
   * pattern, and `_$…$` does not match it — because this is the half of the protocol that third
   * parties call.
   */
  _$commit$(value: unknown) {
    /**
     * The applier's own state survives its own rendering. Committing different content usually
     * runs `_clear`, which drops the state so a part that was emptied by *anything else* cannot
     * hand an applier continuity it no longer has — but an applier rendering its own next value
     * has not gone away, and losing continuity there made `until()` fall back to its placeholder on
     * the render after it resolved.
     */
    const applierState = this._applierState;
    const applier = this._applier;
    this._set(value);
    this._applierState = applierState;
    this._applier = applier;
  }

  _set(value: unknown) {
    if (value == null) {
      if (this._mode !== EMPTY) this._clear();
      return;
    }
    if (typeof value !== 'object') {
      /**
       * Gated on the value CHANGING, which is the same condition the commit below uses. Called
       * before that check it fired on every render of an unchanged `false` — a channel that
       * repeats is as useless as one that stays silent, and the comment on `warnBooleanChild`
       * claimed this was already true. `_value` holds whatever was last committed here, so a part
       * arriving from a template state differs and reports once.
       */
      if (__DEV__ && this._value !== value) warnBooleanChild(value);
      if (this._mode === TEXT) {
        if (this._value !== value) {
          this._value = value;
          this._text!.data = value as string; // the DOM coerces numbers etc.
        }
      } else {
        if (this._mode !== EMPTY) this._clear();
        this._text = doc.createTextNode(value as string);
        this._insert(this._text);
        this._value = value;
        this._mode = TEXT;
      }
      return;
    }
    const heldResult = (value as { $h?: TemplateResult }).$h;
    if (heldResult !== undefined) {
      this._commitHeld(heldResult);
      return;
    }
    if (isTemplateResult(value)) {
      /**
       * Same-shape fast path on `strings` identity alone — no template-cache lookup. This is the
       * hottest line in a keyed list update: for every row whose shape did not change (all of
       * them, in practice), commit costs one identity compare before touching the values.
       */
      if (this._shape === value.strings) {
        if (__DEV__ && _profileHook) _profileHook(PROFILE_UPDATE, this, value.strings);
        this._instance!._update(value.values);
        return;
      }
      /**
       * Reaching here with a template already committed means the identity changed, so the
       * subtree below is about to be destroyed and rebuilt rather than updated. That is what
       * `?hidden=${…}` over a swapped subtree exists to avoid, and it is otherwise invisible.
       */
      if (__DEV__ && _profileHook) {
        _profileHook(this._mode === TEMPLATE ? PROFILE_REBUILD : PROFILE_CREATE, this, value.strings);
      }
      const template = getTemplate(value);
      if (this._mode !== EMPTY) this._clear();
      const instance = new Instance(template);
      instance._update(value.values);
      /**
       * The instance's top-level nodes, recorded while they are still in the fragment. `_value`
       * is unused in TEMPLATE mode, and this is what lets `_clear` and `hold`'s parking find the
       * content after `@verajs/renderer/slots` has moved it out of the marker range — per node,
       * parent-agnostic, so even content split across two slots comes back. Costs one small array
       * on a path that just built an Instance and cloned a template; same-shape updates never
       * reach here.
       */
      this._value = [...instance._fragment.childNodes];
      this._insert(instance._fragment);
      this._instance = instance;
      this._shape = value.strings;
      this._mode = TEMPLATE;
      return;
    }
    const handlers = valueHandlers();
    for (let i = 0; i < handlers.length; i++) if (handlers[i](this, value)) return;
    for (let i = 0; i < builtIns.length; i++) if (builtIns[i](this, value)) return;

    /**
     * **A child-position value that applies itself.** The same idea as `_$apply$` at element
     * position — which is how `@verajs/renderer/spread` ships as a separate package the renderer
     * knows nothing about — at the one other position worth extending.
     *
     * `_$child$(part, previous)` is handed the part and whatever it returned last time at this
     * part, and calls `part._$commit$(value)` to render content. Keeping continuity in the return
     * value rather than in an applier *instance* is what keeps this a protocol rather than a
     * framework: there is no base class, no factory and no lifecycle to learn, and an applier is
     * an object literal.
     *
     * Placed **after** the template check on purpose. A template is overwhelmingly the common
     * object at a child position, and it returns above without ever reading this property — so the
     * check costs the hot path nothing and only arrays, nodes and appliers pay for it. Measured:
     * +22 B gzipped, and no runtime difference distinguishable from noise.
     *
     * There is deliberately no teardown hook. `_clear` bulk-removes DOM and, when the part owns its
     * parent, does `parent.textContent = ''` — the thing that makes clearing a 1 000-row table ~5 ms
     * against lit-html's ~22 ms. Calling teardown on a nested applier would mean walking the part
     * tree on every removal, which is precisely the per-node work that fast path exists to skip. So
     * an applier here can render, and cannot yet be told it has gone away.
     */
    const applyChild = (value as { _$child$?: Applier })._$child$;
    if (applyChild !== undefined) {
      /** `previous` belongs to *this* applier; a different one at the same part starts fresh. */
      const previous = this._applier === applyChild ? this._applierState : undefined;
      /**
       * The un-hoisted applier, named. Writing `_$child$` as an object-literal method makes a new
       * function per render, so the part never recognises it and `previous` is `undefined` forever —
       * the applier silently restarts on every pass. It is the first rule in the README and it
       * fails without a symptom, so development counts the swaps: a genuine applier change at one
       * part happens once or twice, not on every render.
       *
       * The counter is a module-scope `WeakMap` rather than a field, so production carries neither
       * it nor a per-part slot to hold it — but only because it is marked `@__PURE__` at its
       * declaration. Without that it said the same thing and was untrue.
       */
      if (__DEV__ && this._applier !== undefined && this._applier !== applyChild) {
        const swaps = (_applierSwaps.get(this) ?? 0) + 1;
        _applierSwaps.set(this, swaps);
        if (swaps === 3) {
          console.warn(
            `[vera] a child applier changed identity ${swaps} times at one part, so \`previous\` ` +
              `is always undefined and it restarts every render.\n` +
              `Hoist the applier — written as an object-literal method it is a new function per ` +
              `call:\n\n` +
              `  function applyThing(part, previous) { … }            // once, at module scope\n` +
              `  const thing = (x) => ({ _$child$: applyThing, x });  // state on the object\n`
          );
        }
      }
      this._applier = applyChild;
      if (applyChild._$detach$ !== undefined) notifyOnRemoval = true;
      this._applierState = applyChild.call(value, this, previous);
      return;
    }
    if ((value as Node).nodeType !== undefined) {
      /**
       * A DOM node renders as itself — a canvas a charting library owns, a `<template>`'s content,
       * an element built by hand. Placed after the template check and before the list check
       * because `nodeType` is one property read and nothing else that reaches here has one.
       */
      if (this._mode !== NODE || this._value !== value) {
        if (this._mode !== EMPTY) this._clear();
        this._insert(value as Node);
        this._value = value;
        this._mode = NODE;
      }
      return;
    }
    // any other object: render as text
    this._set(String(value));
  }

  /** Commits a template while stashing whatever it replaces — see the `hold()` export. */
  _commitHeld(result: TemplateResult) {
    if (this._mode === TEMPLATE && this._shape === result.strings) {
      this._instance!._update(result.values);
      return;
    }
    const held = (this._held ??= new Map());
    if (this._mode === TEMPLATE) {
      /** Park the live nodes back in their instance's own (empty) fragment. When the range is
       *  empty but content existed, slots relocated it — the recorded top-level nodes park it
       *  from wherever it lives, split slots and holding included. */
      const fragment = this._instance!._fragment;
      if (this._start.nextSibling === this._end && Array.isArray(this._value)) {
        for (const node of this._value as Node[]) fragment.appendChild(node);
      } else {
        let node = this._start.nextSibling;
        while (node !== this._end) {
          const next = node!.nextSibling;
          fragment.appendChild(node!);
          node = next;
        }
      }
      held.set(this._shape!, this._instance!);
    } else if (this._mode !== EMPTY) {
      this._clear();
    }
    const instance = held.get(result.strings) ?? new Instance(getTemplate(result));
    instance._update(result.values);
    this._value = [...instance._fragment.childNodes];
    this._insert(instance._fragment);
    this._instance = instance;
    this._shape = result.strings;
    this._mode = TEMPLATE;
  }

  /**
   * Creates one list item. A single-root template instance becomes an element-mode item with no
   * markers at all; anything else gets its own start/end marker pair so moves can never dangle.
   */
  $c(value: unknown, parent: Node, ref: Node | null): Item {
    /** Rows reach the DOM here rather than through `_insert`; same one-read gate, same
     *  structural value — a root list's rows are the render's own output, any other part's rows
     *  are content it places into the host, stamped with the part as the ordering group. */
    const stamp =
      slotsWired && (parent as { _$hosted$?: boolean })._$hosted$ === true
        ? this._end === null
          ? true
          : this
        : null;
    if (value !== null && typeof value === 'object' && (value as TemplateResult).strings !== undefined) {
      const result = value as TemplateResult;
      const template = getTemplate(result);
      const instance = new Instance(template);
      instance._update(result.values);
      const rootNode = instance._fragment.firstChild;
      if (rootNode !== null && rootNode.nodeType === 1 && rootNode.nextSibling === null) {
        if (stamp !== null) stampOwn(rootNode, stamp);
        parent.insertBefore(rootNode, ref);
        /**
         * A row lands HERE, not through `_insert` — `@verajs/renderer/keyed` inserts each row
         * itself, into the live parent when it is appending one and into a batching
         * `DocumentFragment` when it is filling two or more (the next comment is about exactly
         * that). Wired to `_insert` alone the diagnostic could never see a GROWING icon list, which
         * is the feature's own headline shape.
         */
        if (__DEV__) {
          /**
           * The PART's parent when `parent` is a fragment. `@verajs/renderer/keyed` batches a
           * trailing fill of two or more rows into a `DocumentFragment` and lands it with one
           * `insertBefore`, so the rows are created against something with no namespace at all —
           * a growing icon list, which is the shape this diagnostic most exists for. A row's own
           * namespace is fixed at parse time, so asking the real destination here is sound, and
           * `keyed.ts` stays importing nothing, which is what keeps its template cache single.
           */
          const hostNode = parent.nodeType === 11 ? this._start.parentNode! : parent;
          const host = foreignHost(hostNode);
          if (host !== null) warnForeignMismatch(host, (hostNode as Element).namespaceURI, [rootNode]);
        }
        return {
          $k: result.key,
          _element: rootNode as Element,
          _instance: instance,
          _shape: result.strings,
          _part: null,
        };
      }
      /** Multi-root template: markered part, content already instantiated. */
      const part = createMarkeredPart(parent, ref);
      part._instance = instance;
      part._shape = result.strings;
      part._mode = TEMPLATE;
      part._value = [...instance._fragment.childNodes];
      if (stamp !== null) stampOwn(instance._fragment, stamp);
      /**
       * Branched rather than a ternary, so the whole diagnostic folds away: a `__DEV__` CONDITION
       * survived minification as a live reference and put the warning's strings in the production
       * bundle (+436 B, caught by the size gate). Only a statement-level `if (__DEV__)` is removed
       * outright.
       */
      if (__DEV__) {
        const rowParent = part._start.parentNode!;
        const rowHostNode = rowParent.nodeType === 11 ? this._start.parentNode! : rowParent;
        const rowHost = foreignHost(rowHostNode);
        const rowNodes = rowHost === null ? null : [...instance._fragment.childNodes];
        rowParent.insertBefore(instance._fragment, part._end);
        if (rowNodes !== null)
          warnForeignMismatch(rowHost!, (rowHostNode as Element).namespaceURI, rowNodes);
      } else {
        part._start.parentNode!.insertBefore(instance._fragment, part._end);
      }
      return { $k: result.key, _element: null, _instance: null, _shape: null, _part: part };
    }
    const part = createMarkeredPart(parent, ref);
    /** The row's own destination, so a batched fill resolves like the template branches above. */
    if (__DEV__ && parent.nodeType === 11) part._foreignHost = this._start.parentNode;
    part._set(value);
    return { $k: (value as TemplateResult)?.key, _element: null, _instance: null, _shape: null, _part: part };
  }

  /** Commits a new value into an existing item, demoting element mode if the shape changed. */
  $u(item: Item, value: unknown) {
    if (item._element !== null) {
      if (value !== null && typeof value === 'object' && (value as TemplateResult).strings === item._shape) {
        item._instance!._update((value as TemplateResult).values);
        return;
      }
      /** Shape changed: swap the bare element for a markered part in its place. */
      const part = createMarkeredPart(item._element.parentNode!, item._element);
      item._element.remove();
      item._element = null;
      item._instance = null;
      item._shape = null;
      (item._part = part)._set(value);
      return;
    }
    item._part!._set(value);
  }

  /** The item's first node — its move/removal handle and the insertion reference before it. */
  $f(item: Item): Node {
    return item._element ?? item._part!._start;
  }

  /**
   * Moving and removing an item read `_element` and `_part`, which are mangled — so they stay here
   * rather than travelling with the algorithm that calls them. `$m` and `$d` are the price: two
   * cold methods, exempt from mangling, two characters each.
   */
  $m(item: Item, ref: Node | null, parent: Node = this._start.parentNode!) {
    /**
     * **Already where it is going.** A reorder asks for many positions that are already correct,
     * and re-inserting a node that is in place is not free: it detaches and re-attaches, which
     * blurs focus, restarts a CSS transition and wakes every MutationObserver watching. The
     * relocated path below leans on this — it re-places every item rather than computing which
     * ones moved — but the ordinary two-ended diff gets the same saving.
     *
     * The item's LAST node is the one whose `nextSibling` decides this, and reading `_element` /
     * `_part._end` is why the check lives here rather than travelling with the algorithm.
     */
    const last = item._element ?? item._part!._end!;
    if (last.nextSibling === ref && last.parentNode === parent) return;
    if (item._element !== null) {
      parent.insertBefore(item._element, ref);
      return;
    }
    let node: Node | null = item._part!._start;
    const stop = item._part!._end!.nextSibling;
    while (node !== stop) {
      const next: Node | null = node!.nextSibling;
      parent.insertBefore(node!, ref);
      node = next;
    }
  }

  /** Removal is a move into a scratch fragment that is immediately emptied. */
  $d(item: Item) {
    if (notifyOnRemoval) detachItem(item);
    this.$m(item, null, SCRATCH);
    SCRATCH.textContent = '';
  }

  _commitList(newValues: unknown[]) {
    if (this._mode !== LIST) {
      if (this._mode !== EMPTY) this._clear();
      this._items = [];
      this._keyedList = false;
      this._mode = LIST;
    }
    const count = newValues.length;
    if (count === 0) {
      if (this._items!.length) {
        this._clear();
        this._items = [];
        this._mode = LIST;
      }
      return;
    }
    const isKeyed = newValues[0] != null && (newValues[0] as KeyedResult).$r !== undefined;
    if (isKeyed !== this._keyedList && this._items!.length) {
      this._clear();
      this._items = [];
      this._mode = LIST;
    }
    this._keyedList = isKeyed;
    const items = this._items!;
    const parent = this._start.parentNode!;

    if (items.length === 0) {
      /** Initial fill builds off-document and lands in one insert. */
      const fragment = doc.createDocumentFragment();
      for (let i = 0; i < count; i++) items.push(this.$c(newValues[i], fragment, null));
      this._insert(fragment);
      return;
    }

    if (!isKeyed) {
      // index mode: update in place, grow at the end, shrink from the end
      const shared = items.length < count ? items.length : count;
      for (let i = 0; i < shared; i++) this.$u(items[i], newValues[i]);
      if (count > items.length) {
        const fragment = doc.createDocumentFragment();
        for (let i = items.length; i < count; i++) items.push(this.$c(newValues[i], fragment, null));
        this._insert(fragment);
      } else if (count < items.length) {
        if (notifyOnRemoval) for (let i = count; i < items.length; i++) detachItem(items[i]);
        /**
         * **Removed through the items, not by walking the range.** The walk this replaced ran from
         * the first doomed item to the last one's end and called `parent.removeChild` on each node,
         * which assumes every one of them is still a child of `parent`. `@verajs/renderer/slots`
         * moves a light host's children into the component's tree, and the walk then threw
         * `NotFoundError` out of the middle of a render — a plain `<x-card>${rows}</x-card>` losing
         * one row was enough, with no keyed list anywhere in it.
         *
         * `$m` into the scratch fragment is indifferent to where a node currently lives, and the
         * batch is dropped by one clear at the end, so the contiguous-run saving the walk was for
         * is kept.
         */
        for (let i = count; i < items.length; i++) this.$m(items[i], null, SCRATCH);
        SCRATCH.textContent = '';
        items.length = count;
      }
      return;
    }

    /**
     * Keyed reconciliation is not here. It lives in `@verajs/renderer/keyed`, and it arrives on
     * the values themselves — `keyed()` stamps each result with the strategy that understands it,
     * so importing the marker is what loads the algorithm. Nothing registers, nothing is wired, and
     * two strategies cannot disagree about a list because the list names its own.
     *
     * The protocol is three cold members (`$c`, `$u`, `$f`) plus a returned array. Everything a
     * strategy would otherwise have to reach for — the mode switch, the empty case, the initial
     * fill — is already done above and passed in.
     */
    this._items = (newValues[0] as KeyedResult).$r!(this, newValues, items, parent, this._end);
  }
}

const rootParts = new WeakMap<Node, ChildPart>();

/**
 * Writes a template result into a container. The renderer's imperative draw: no reactivity, no
 * lifecycle, no knowledge of components. Slots into Vera via `wire([renderer])`; core's built-in
 * `html` tag already produces the accepted shape, so no `setHtml` call is required — though
 * lit-html's `html` also works, its results being structurally identical.
 *
 * **It owns its own range and nothing else.** The first call appends a marker and anchors a root
 * part there; later calls with the same container reuse that part and walk only the value slots, so
 * nodes are updated in place rather than rebuilt. Content that was already in the container stays.
 *
 * **Named for the relationship, not the act.** It was `render` until 0.2.0, which collided with
 * core's `render` — a different function, with a different arity, that declares a *reactive*
 * template and commits a component's setup. Both were public and both were documented, so a reader
 * who knew one misread the other. `renderElement` and `renderDom` were considered and rejected: this
 * renders *into* a container, and the container is a `Node` — a shadow root and a fragment are both
 * valid, so "element" would be a lie in the type. Argument order is lit-html's on purpose.
 *
 * HYDRATION lives in `@verajs/renderer/hydrate` — a drop-in superset entry whose `renderInto` adopts
 * existing server-rendered children on first render. SSR apps import from there instead of here;
 * this entry carries zero hydration code.
 */
export const renderInto = (result: unknown, container: Node) => {
  /**
   * The container is the argument people forget, and forgetting it failed with
   * `Cannot read properties of undefined (reading 'appendChild')` — a message about the internals of
   * a function the caller never named. Everything after this line assumes a node.
   */
  if (__DEV__ && (!container || typeof (container as Node).appendChild !== 'function'))
    throw new TypeError(
      `renderInto: expected a container node as the second argument and received ${String(container)}. ` +
        `It renders *into* something — \`renderInto(html\`…\`, document.body)\`.`
    );
  if (__DEV__ && _profileHook) _profileHook(PROFILE_FRAME_START, container, null);
  let part = rootParts.get(container);
  if (part === undefined) {
    /**
     * FIRST render into this container. If it is a light element host and a 'slot' insert is
     * wired, capture its children NOW — so slot content provided before its (possibly
     * conditional) `<slot>` mounts is held rather than left visible in the host, matching native
     * "unassigned light children do not render". Once per container lifetime; shadow roots
     * (nodeType 11) and fragments are excluded.
     */
    /**
     * **The marker goes in FIRST, and capture is handed it as the light region's boundary.**
     *
     * This part's start marker already delimits where the render's output begins, so the boundary
     * slots needs is a node the renderer was creating anyway — the sentinel it used to append for
     * itself landed immediately before this one, two adjacent comments doing the same job. Passing
     * it removes one comment from every light host and keeps the two in step by construction: they
     * cannot drift apart if they are the same node.
     *
     * Appending before capture is safe and necessary. Safe because a comment is never a slottable,
     * so the children walk steps over it; necessary because capture LIFTS the host's children, and
     * a marker appended afterwards would land in the same place either way — this way slots has it.
     */
    const marker = comment();
    container.appendChild(marker);
    if (container.nodeType === 1) slotSeam()?._$capture$?.(container as Element, marker);
    rootParts.set(container, (part = new ChildPart(marker, null)));
  }
  /**
   * **The flush is in a `finally`, and that is not tidiness.** A render that throws after a
   * `<select>.value` has been queued but before the flush left the queue holding the element — which
   * retains it in module state, and, worse, hands the stranded value to the *next* `renderInto` call.
   * An unrelated component's render then silently changed a select it has nothing to do with.
   * Measured: a failed update left the value to be applied by the following render.
   *
   * Flushing on the way out applies it with its own pass, where it belongs, and leaves nothing
   * behind either way. The error still propagates.
   */
  _slotRoot = container;
  try {
    part._set(result);
  } finally {
    _slotRoot = null;
    flushSelects();
  }
  if (__DEV__ && _profileHook) _profileHook(PROFILE_FRAME_END, container, null);
};

// ── INTERNAL SURFACE — imported by ./hydrate.ts, never re-exported by src/index.ts ─────────────
// The public d.ts comes from src/index.ts, and the base bundles tree-shake all of this away, so
// nothing here reaches consumers of the base entry. The hydrate entry compiles against this exact
// source into its own self-contained bundle, so mangled property names always agree within it.

/** @internal */
export {
  flushSelects,
  getTemplate,
  Template,
  Instance,
  TextPart,
  ChildPart,
  AttrPart,
  IGNORED_PART,
  IGNORED,
  TEMPLATE,
  LIST,
  NODE,
  comment,
  doc,
  toText,
  isTemplateResult,
  instanceWalker,
  rootParts,
  slotSeam,
  _setProfileHook,
  PROFILE_UPDATE,
  PROFILE_CREATE,
  PROFILE_REBUILD,
  PROFILE_FRAME_START,
  PROFILE_FRAME_END,
};
/** @internal */
export type { Item, TemplatePart };


/**
 * Lists, as a registered kind rather than a branch — the built-in going through the same door a
 * package will. Moving it to `@verajs/renderer/lists` is step 5; nothing else has to change when
 * it does, which is what this shape is for.
 */
builtIns.push((part, value) => {
  if (Array.isArray(value)) {
    (part as ChildPart)._commitList(value);
    return true;
  }
  if (value !== null && typeof (value as Iterable<unknown>)[Symbol.iterator] === 'function') {
    (part as ChildPart)._commitList([...(value as Iterable<unknown>)]);
    return true;
  }
  return false;
});

/**
 * Everything this renderer needs, in one entry: `wire([renderer])`.
 *
 * It registers on the `'render'` chain *and* takes the registry, because a package that both
 * provides a capability and reads one should not cost an app two lines. This replaced
 * `setRenderer`, which existed only because there was no general way to say "this app has a
 * renderer" — and which resolved the shadow root at registration, so a renderer wired any other
 * way silently rendered into the light DOM. That resolution lives in core's dispatch now.
 */
/**
 * A `__DEV__`-only hint for `wire`, so the module and the raw function beside it can share a package
 * without wiring the wrong one being silent.
 *
 * A bare function has no `on`, so `wire` reads it as a connector and hands it the registry. Nothing
 * registers, nothing throws, and the page renders nothing. The marker lets `wire` name the export
 * that was meant. This mattered most when the function was called `render` and the mistake was two
 * characters wide; `renderInto` is harder to confuse, and the guard costs nothing in production.
 *
 * `$module` is deliberately generic — any package exporting a raw function next to a module of a
 * similar name can set it. Production carries neither the property nor the check that reads it.
 */
if (__DEV__) (renderInto as unknown as { $module?: string }).$module = 'renderer';

export const renderer = {
  name: '@verajs/renderer',
  on: 'render' as const,
  fn: renderInto as never,
  priority: 50,
  /**
   * Typed against the registry `wire` actually hands over, not a narrower shape that happens to
   * describe the one lookup this makes. A structural `{ get(name: 'value'): … }` is **not**
   * assignable from `Inserts`, so `wire([renderer])` failed to compile in a consumer's project while
   * this repo's own typecheck — which reads sources, not the shipped `.d.ts` — saw nothing.
   */
  connect: (given: { get(name: never): unknown }) => {
    registry = given as { get(name: 'value' | 'slot'): unknown[] | undefined };
  },
};
