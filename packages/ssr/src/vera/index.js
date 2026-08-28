/**
 * Vera-native SSR — strategy 4. No wcc, no lit, no acorn, no parse5: Node resolves the module
 * graph (`import()`), execution registers component classes (via `customElements.define`, which
 * the shim owns and core's own wrapper passes through), templates flatten through the
 * sigil-aware serializer, and nested components are discovered by scanning emitted markup for
 * tags the registry knows — never by parsing HTML.
 *
 * Import THIS module first — before anything that imports `@verajs/renderer`, which is the module
 * that actually needs the shims: it builds two shared `TreeWalker`s at import time and throws
 * against a bare Node global object. A component reaches it through `keyed` or `hold`.
 *
 * Measured: core, `@verajs/styles` and `@verajs/router` are all order-independent; only the
 * renderer is not. Core is still dynamically imported below, because `setRenderer` and `wire`
 * have to come from the same instance the components will use.
 *
 * Client takeover is `@verajs/renderer/hydrate`, which adopts this markup in place — markerless,
 * so nothing here carries framework comments. (This comment used to say the renderer had no
 * `hydrate()` yet and point at a "strategy 2"; both stopped being true when that entry shipped.)
 */
import {
  installShims,
  registry,
  hoistedStyles,
  escapeHtml,
  escapeStyleText,
  setRenderingTag,
  beginHoisting,
  flushFrames,
  flushFramesAsync,
  pendingInstances,
  INSTANCE_ATTRIBUTE,
  /**
   * Which elements hold text rather than markup, from the one place that knows.
   *
   * This file kept its own copy under a different name. They agreed, and nothing made them: adding
   * an element to one would have left the scan rendering a component inside something the shim
   * treats as text, or the reverse — a disagreement about the same single fact, which is what
   * CODE-PRINCIPLES #5 is about.
   */
  RAW_TEXT_ELEMENTS as RAW_TEXT,
} from './shim.js';
import { serializeTemplate, serializeValue } from './serializer.js';
import { randomUUID } from 'node:crypto';

installShims();
const { wire, inserts, setStaticStores } = await import('@verajs/core');
/**
 * `static styles` moved out of core in 0.2.0 (`@verajs/styles`). Server rendering must still
 * serialize them — the markup a browser produces includes the component's styles — and nothing on
 * the server cares about the bytes, so SSR wires the adopter unconditionally rather than making
 * every caller remember to.
 *
 * `wire` comes from core, not from `@verajs/inserts`, so the registration lands in the map core
 * actually reads. Exactly why the render insert above is registered through core's `wire` too.
 */
const { adoptStyles } = await import('@verajs/styles');
wire({ on: 'init', fn: adoptStyles, priority: 50 });

/**
 * Failures during a render are collected, not swallowed.
 *
 * Core deliberately does not rethrow a hook error — one bad effect must not take out the hooks
 * beside it — and with no `'error'` insert registered it logs and carries on. In a browser that is
 * right: the component is degraded and the next render can recover it. On a server there is no
 * next render. A component whose `render()` threw was serialized **empty**, into a 200, with a
 * console line on a machine nobody is watching — the same "empty component and said nothing about
 * it" that the async-`connectedCallback` guard below refuses to allow.
 *
 * Registered at priority 10 rather than the default 50, so an app that installs its own error
 * reporter keeps it: at a taken priority `wire` replaces.
 */
const renderErrors = [];
wire({ on: 'error', fn: (error, element) => renderErrors.push({ error, tag: element?.localName }), priority: 10 });

/**
 * What this renderer last wrote into a container, and what sat in front of it.
 *
 * **`render()` owns its own range and nothing else** — that is the client's contract, and it holds
 * over time, not just on the first pass. Measured in a browser DOM: content already in the container
 * stays *before* the rendered range, a node appended afterwards stays *after* it, and both survive
 * every re-render. The server assigned `innerHTML` outright, so a component that called `render()`
 * and also appended to its own root kept the appended node in the browser and lost it here.
 *
 * The string equivalent of a range is the text on either side of it, which is what this holds.
 */
const written = new WeakMap();

/** The server renderer: template object in, markup into the (shadow) container shim. */
const serverRenderer = (template, container) => {
  /**
   * Anything that is not a template flattens exactly as a slot's value does, which is what the
   * client does with the same return.
   *
   * A string used to be written straight into `innerHTML` — so a component returning
   * `'<b>raw</b>'` produced real elements on the server and the **escaped text** `&lt;b&gt;raw…` in
   * the browser. Different content on the two paths, and an injection the client does not have the
   * moment any of that string comes from data. A number returned nothing at all here and `42`
   * there.
   */
  const ours = template?.strings ? serializeTemplate(template) : serializeValue(template);

  /**
   * Where our range sits. On a re-render the container should still open with the text we saw in
   * front of us and continue with what we wrote, and whatever follows is somebody else's — a node a
   * component appended to its own root, or the `children` a light-DOM component was handed.
   *
   * If the container no longer matches that shape someone replaced its contents wholesale, and the
   * honest reading is that our old range is gone: start again at the end, which is where a first
   * `render()` puts it in a browser.
   */
  const current = container.innerHTML;
  const last = written.get(container);
  const resumable = last !== undefined && current.startsWith(last.before + last.ours);
  const before = resumable ? last.before : current;
  const after = resumable ? current.slice(before.length + last.ours.length) : '';

  container.innerHTML = before + ours + after;
  written.set(container, { before, ours });
};
/**
 * `setRenderer` registers a **wrapper** — it resolves the element's root before calling through —
 * so the chain never contains `serverRenderer` itself. Diffing the chain around the call is how to
 * get a handle on the entry that was actually added, without reaching into the registry's
 * internals.
 */
const chainBefore = new Set(inserts.get('render') ?? []);
wire({ on: 'render', fn: serverRenderer, priority: 50 });
const ourEntry = (inserts.get('render') ?? []).find((entry) => !chainBefore.has(entry));

/**
 * `setRenderer` registers on `'render'` at priority 50, and registering at a taken priority
 * **replaces**. So an app entry doing the ordinary thing — `wire({ on: 'render', fn: renderer, priority: 50 })` — displaces this
 * one the moment that module is imported server-side, and every component then renders through a
 * renderer that writes to a real DOM which is not there. The result was
 * `<my-el><template shadowrootmode="open"></template></my-el>`: empty, for every component, with no
 * error and nothing in the output to suggest why.
 *
 * Checked per render rather than once, because the displacement happens whenever the app's module
 * graph is evaluated, which is after this file has run.
 */
const assertRendererIntact = () => {
  if (!ourEntry || inserts.get('render')?.includes(ourEntry)) return;
  throw new Error(
    'ssr: the server renderer has been replaced — something wired a renderer after ' +
      '@verajs/ssr was imported, and every component would render empty. Guard the client wiring ' +
      '(`if (!globalThis.__veraSsrShimmed)`) or keep it out of the module the server imports.'
  );
};



/**
 * The index just past the `>` that closes the tag starting at `start`, respecting quoted attribute
 * values.
 *
 * `>` is legal unescaped inside an attribute value, and a regex that stops at the first one cuts
 * the tag in half: `<mark-comp title="x > y">` was read as a tag ending after `x `, giving the
 * component an attribute value of `"x` and leaving ` y">` behind as text next to it.
 */
const tagEnd = (markup, start) => {
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
 * Only the double-quoted form used to be recognised. `<x-y a='one' b=two>` gave the child three
 * empty attributes *and invented two more*, because the value text fell through to the next
 * iteration and matched as a name.
 */
const ATTRIBUTE = /([\w:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/** Numeric and the five named references — everything `escapeHtml` can emit, plus what authors write. */
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

/**
 * Attribute values arrive **escaped**, because they were read back out of markup this module just
 * wrote. Handing that to `setAttribute` gave a nested component `Tom &#38; Jerry` where the parent
 * had passed `Tom & Jerry`, and re-escaping on the way out produced `Tom &#38;#38; Jerry` — entity
 * codes visible on the page, and a mismatch against whatever the client computes on hydration.
 */
const decodeEntities = (value) =>
  value.replace(/&#(\d+);|&([a-zA-Z]+);/g, (match, code, name) =>
    code ? String.fromCharCode(Number(code)) : (NAMED_ENTITIES[name] ?? match)
  );

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

/** Tags rendered during the current `renderToString`, so only their styles reach the page shell. */
const renderedTags = new Set();

/**
 * `href -> tag`, so a component rendered twice is looked up once.
 *
 * `import()` is cached by Node, but awaiting a cached module still builds a promise and yields:
 * 2.36 µs of a 9.5 µs render, measured, which a server pays on every request for a page it has
 * already served. ESM modules are immutable once evaluated, so remembering the answer changes
 * nothing except how long it takes to get it.
 */
const entryTags = new Map();

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
 * @param {string} markup @param {number} depth
 * @param {(name: string, attrs: string, depth: number) => string} [emit] renders one component tag
 */
const renderComponentTags = (markup, depth, emit) => {
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
      const close = markup.indexOf('-->', open + 4);
      const stop = close === -1 ? markup.length : close + 3;
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
      const lower = markup.toLowerCase();
      let depth = 1;
      let at2 = end;
      while (depth > 0) {
        const nextOpen = lower.indexOf('<template', at2);
        const nextClose = lower.indexOf('</template', at2);
        if (nextClose === -1) {
          at2 = markup.length;
          break;
        }
        if (nextOpen !== -1 && nextOpen < nextClose) {
          depth++;
          at2 = nextOpen + 9;
        } else {
          depth--;
          at2 = markup.indexOf('>', nextClose) + 1 || markup.length;
        }
      }
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
      if (emit) out += emit(name, attrs, depth + 1);
      else {
        const rendered = renderComponent(name, attrs, depth + 1);
        out += rendered.open + rendered.inner;
      }
    } else {
      out += tagText;
    }
    at = end;
  }
  return out;
};

/**
 * **The asynchronous chain.**
 *
 * Everything that decides *what* to emit is shared with the synchronous render — the scanner above,
 * the serializer, the entry resolution. What differs is only *when* it may wait: this one awaits a
 * component's `connectedCallback`, and lets promises settle between frame rounds, which is what a
 * routed component's first navigation needs and what the synchronous render refuses.
 *
 * **The scan itself stays synchronous.** A component tag becomes a placeholder and its render a
 * promise; once everything has settled the placeholders are substituted. Awaiting inside the scan
 * would have meant a second copy of the parser — and measured, an async recursion costs 2.45x even
 * when nothing suspends, which the synchronous path is not going to pay for a feature it never uses.
 *
 * The placeholder carries a per-process random name for the same reason `INSTANCE_ATTRIBUTE` does:
 * it must be impossible for a component's own markup to contain one.
 */
const PLACEHOLDER = `vera-async-${randomUUID()}`;
const PLACEHOLDER_PATTERN = new RegExp(`${PLACEHOLDER}(\\d+)_`, 'gu');

/** @param {string} markup @param {number} depth @param {Array<Promise<string>>} pending */
const scanAsync = (markup, depth, pending) =>
  renderComponentTags(markup, depth, (name, attrs, at) => {
    pending.push(renderComponentAsync(name, attrs, at));
    return `${PLACEHOLDER}${pending.length - 1}_`;
  });

/** Substitutes what the scan deferred, once every component beneath it has settled. */
const settle = async (scanned, pending) => {
  if (!pending.length) return scanned;
  const parts = await Promise.all(pending);
  return scanned.replace(PLACEHOLDER_PATTERN, (_, index) => parts[Number(index)]);
};

/** @param {string} markup @param {number} depth */
const renderComponentTagsAsync = async (markup, depth) => {
  const pending = /** @type {Array<Promise<string>>} */ ([]);
  return settle(scanAsync(markup, depth, pending), pending);
};

/**
 * Points `globalThis.location` at one request's URL and hands back what it held.
 *
 * A path is resolved against whatever `location` already describes, so `'/users/2?page=3#top'`
 * works without a caller having to invent an origin.
 */
const LOCATION_PARTS = ['href', 'protocol', 'host', 'hostname', 'port', 'pathname', 'search', 'hash', 'origin'];

const applyLocation = (location) => {
  const current = globalThis.location;
  const previous = Object.fromEntries(LOCATION_PARTS.map((part) => [part, current?.[part]]));
  const next = new URL(String(location), current?.href ?? 'http://localhost/');
  for (const part of LOCATION_PARTS) current[part] = next[part];
  return previous;
};

const restoreLocation = (previous) => {
  const current = globalThis.location;
  for (const part of LOCATION_PARTS) current[part] = previous[part];
};

/** Instantiates a registered component and returns its declarative-shadow (or light) markup. */
/**
 * Which element a tag should be rendered as — shared by both chains, because deciding it has nothing
 * to do with whether the render may wait.
 *
 * A component the *parent* built and appended is rendered as itself, carrying whatever the parent
 * assigned to it. The fresh instance built here is discarded in that case; only its attributes were
 * ever needed, and they came from the markup that instance wrote in the first place.
 *
 * **The tag has to match.** The marker's name is already unguessable, so this is the second lock on
 * the same door: a marker can only ever produce the component it was written for.
 */
const buildInstance = (tag, attrString) => {
  const element = new (registry.get(tag))();
  element.localName = tag;
  if (attrString) {
    for (const [, name, quoted, single, bare] of attrString.matchAll(ATTRIBUTE)) {
      element.setAttribute(name, decodeEntities(quoted ?? single ?? bare ?? ''));
    }
  }
  const pending = pendingInstances.get(element.getAttribute(INSTANCE_ATTRIBUTE));
  return pending && pending.localName === tag ? pending : element;
};

const renderComponent = (tag, attrString, depth, props, children) =>
  renderInstance(buildInstance(tag, attrString), tag, depth, props, children);

/**
 * The asynchronous mirror of `renderComponent`. Identical in what it decides; different only in that
 * it hands off to a lifecycle it is allowed to wait for.
 */
const renderComponentAsync = async (tag, attrString, depth, props, children) => {
  const { open, inner } = await renderInstanceAsync(buildInstance(tag, attrString), tag, depth, props, children);
  /**
   * **Open tag and contents only** — the scanner emits the closing tag from the markup it is walking,
   * exactly as it does for the synchronous chain. Returning a complete element here produced
   * `</child-badge></child-badge>` on every nested component.
   */
  return `${open}${inner}`;
};

/**
 * Everything an instance needs before its lifecycle runs — the marker bookkeeping, `props`, and the
 * children. Shared by both chains: none of it depends on whether the render may wait.
 *
 * @param {any} element @param {string} tag @param {Record<string, unknown>} [props] @param {string} [children]
 */
const prepareInstance = (element, tag, props, children) => {
  element._rendered = true;
  /** Read before it is removed, or the map keeps the instance for the rest of the process. */
  pendingInstances.delete(element.getAttribute(INSTANCE_ATTRIBUTE));
  element.removeAttribute(INSTANCE_ATTRIBUTE);

  /**
   * Properties are assigned before `connectedCallback`, which is where a client parent would have
   * put them too. Attributes can only carry strings, so a component that takes rows, a config
   * object or anything else structured could not be server-rendered with real data at all — it had
   * to be handed a JSON string and parse it back.
   */
  if (props) {
    try {
      /**
       * **`__proto__` is skipped**, because `Object.assign` copies it with `[[Set]]` and that
       * *replaces the element's prototype*. `props` exists to be handed structured data, and
       * `props: await request.json()` is the obvious way to use it — `JSON.parse` makes `__proto__`
       * an ordinary own key, so one request body ended the render with
       * `element.upgrade is not a function` and, on the way there, gave the caller control of what
       * the component inherited from. Nothing legitimate assigns a prototype through this option.
       */
      for (const [name, value] of Object.entries(props)) if (name !== '__proto__') element[name] = value;
    } catch (error) {
      /**
       * `Object.assign` onto a getter-only property throws `Cannot set property x of #<Class>` —
       * true, and no help at all: it names neither the component, nor the option the value came
       * from, nor that a server render was in progress. Every other bad input to `renderToString`
       * says what to do about it.
       */
      throw new TypeError(
        `ssr: <${tag}> refused a value from \`props\` — ${String(/** @type {Error} */ (error).message)}. ` +
          `A read-only property cannot be set; pass it as an attribute, or give the class a setter.`
      );
    }
  }
  /**
   * Children go in **before** `connectedCallback`, because that is where a client finds them: the
   * parser has already built them when the element upgrades. A component that reads or slots them
   * therefore sees them, and one that overwrites its own light DOM wins — same order, same result.
   */
  if (children) element.innerHTML = children;


};

/** Runs the lifecycle on an element that is already built, and serializes it. */
const renderInstance = (element, tag, depth, props, children) => {
  prepareInstance(element, tag, props, children);

  renderedTags.add(tag);
  const previousTag = setRenderingTag(tag) ?? tag;
  element.upgrade();
  const pending = element.connectedCallback?.();
  /** Inside the rendering tag, so a re-render's styles are still hoisted against this component. */
  flushFrames((error) => renderErrors.push({ error, tag }));
  setRenderingTag(previousTag);

  /**
   * Rendering is synchronous end to end, so an `async connectedCallback` returns a promise nobody
   * can wait for, and everything after its first `await` happens long after the markup was
   * serialized. That produced an empty component and said nothing about it, which is the worst of
   * the available outcomes.
   *
   * **The reason it is synchronous is not what this used to say.** It claimed the recursion runs
   * inside `String.replace` and therefore cannot await; `renderComponentTags` is a plain `while`
   * loop and there is no such callback anywhere in the chain. The real constraint is the one stated
   * at `renderPage`: the per-render bookkeeping — `renderedTags`, `renderErrors`,
   * `pendingInstances`, `instanceCount`, the hoisting state — is **module-level**, so two renders
   * that interleaved would read each other's. Being synchronous end to end is what makes concurrent
   * `renderToString` calls safe, which `tests/ssr-request-isolation.test.mjs` relies on.
   *
   * Making this async is therefore a matter of threading that state through rather than of the shape
   * of the recursion — a real change with a real payoff (async lifecycles, and a routed component
   * rendering its route), and one nobody should start from this comment alone.
   *
   * Load data before `renderToString` and pass it in through attributes.
   */
  if (pending && typeof pending.then === 'function') {
    throw new Error(
      `ssr: <${tag}> has an async connectedCallback, which cannot be awaited during a synchronous ` +
        `render — its markup would be empty. Load data before renderToString and pass it as attributes.`
    );
  }

  const open = element.openTag();
  /**
   * `_shadowRoot`, not `shadowRoot` — **a closed root is hidden from the page and still serialized.**
   * `element.shadowRoot` is `null` for `mode: 'closed'`, exactly as it is in a browser, so reading it
   * here dropped the whole template and the component rendered empty. Declarative shadow DOM
   * expresses `closed` (`<template shadowrootmode="closed">`) and the client re-creates it just as
   * hidden, so there is nothing to withhold — the mode governs who can reach in, not what is written.
   */
  const shadowRoot = element._shadowRoot;
  if (shadowRoot) {
    /** Styles are prepended after the scan, never passed through it — see `styleTags`. */
    const inner = renderComponentTags(shadowRoot.innerHTML, depth);
    /**
     * The element's own light DOM follows the template. It used to be discarded for any shadow
     * component, so content a component put in its own light DOM — the thing its `<slot>` projects
     * — was on the page client-side and missing server-side.
     */
    const light = element.innerHTML ? renderComponentTags(element.innerHTML, depth) : '';
    return {
      open,
      inner: `<template${shadowRoot.templateAttributes()}>${shadowRoot.styleTags()}${inner}</template>${light}`,
    };
  }
  /** Light DOM: rendered content becomes the element's children (client re-render replaces). */
  return { open, inner: renderComponentTags(element.innerHTML, depth) };
};

/**
 * What an element serializes to, before anything inside it has been scanned — shared by both chains,
 * because none of it depends on whether the render may wait. Each chain scans the two markup
 * fragments with its own scanner and assembles the same way.
 *
 * @param {any} element
 */
const instancePieces = (element) => {
  const shadowRoot = element._shadowRoot;
  return {
    open: element.openTag(),
    shadowRoot,
    /** The template's own markup, and the element's light DOM, each still to be scanned. */
    shadowMarkup: shadowRoot ? shadowRoot.innerHTML : '',
    lightMarkup: element.innerHTML,
  };
};

/** Puts the scanned halves back together — the one shape both chains produce. */
const assembleInstance = ({ open, shadowRoot }, scannedShadow, scannedLight) =>
  shadowRoot
    ? {
        open,
        inner: `<template${shadowRoot.templateAttributes()}>${shadowRoot.styleTags()}${scannedShadow}</template>${scannedLight}`,
      }
    : { open, inner: scannedLight };

/**
 * The asynchronous mirror of `renderInstance`. The lifecycle is awaited and the frame drain lets
 * promises settle between rounds; everything else is the shared helpers the synchronous one uses.
 */
const renderInstanceAsync = async (element, tag, depth, props, children) => {
  prepareInstance(element, tag, props, children);

  renderedTags.add(tag);
  const previousTag = setRenderingTag(tag) ?? tag;
  element.upgrade();
  /**
   * **Awaited, which is the whole point of this chain.** The synchronous render refuses an
   * `async connectedCallback` because its markup would be empty; here it is simply waited for.
   */
  await element.connectedCallback?.();
  await flushFramesAsync((error) => renderErrors.push({ error, tag }));
  setRenderingTag(previousTag);

  const pieces = instancePieces(element);
  const scannedShadow = pieces.shadowRoot ? await renderComponentTagsAsync(pieces.shadowMarkup, depth) : '';
  const scannedLight = pieces.lightMarkup ? await renderComponentTagsAsync(pieces.lightMarkup, depth) : '';
  return assembleInstance(pieces, scannedShadow, scannedLight);
};

/**
 * Renders a component module to markup.
 *
 * @param url Module URL (the component's file; Node resolves its imports natively — the
 * `.ts`-via-`.js` convention included)
 * @param {object} [options]
 * @param {string} [options.tag] Picks the element when the module defines several
 * @param {string | Record<string, unknown>} [options.attributes] The entry tag's attributes — an
 * object, whose values are escaped; a string is written through untouched
 * @param {Record<string, unknown>} [options.props] Properties assigned before `connectedCallback`,
 * which is how structured data reaches a component
 * @param {string} [options.children] Markup placed inside the entry tag — what a `<slot>` renders
 * @param {Set<string>} [options.seen] Carried across renders so a component's styles reach the
 * page once, for a shell assembled from several islands
 * @param {string | URL} [options.base] A directory the module must resolve inside. Pass it whenever
 * any part of `url` came from a request
 * @param {boolean} [options.static] Declare that this page will not be interactive, so its stores
 * need not be reactive. Worth roughly 3x — the proxy behind `createStore` is the whole reactivity
 * cost of a server render — and the markup is identical. A component that writes to a store during
 * the render throws in development rather than silently rendering something that never updated.
 * @param {string | URL} [options.location] This request's URL, for any component that reads one.
 * Applied after every await and restored afterwards, so concurrent renders cannot see each other's
 * — assigning to `globalThis.location` yourself is not safe once two requests overlap
 * @return `{ html, styles, title }` — `styles` collects light-DOM `@scope` sheets for the page
 * shell, and `title` is `document.title` as this render left it, which the shell puts in `<title>`.
 * Both are returned rather than left on a global so concurrent renders cannot see each other's.
 */
const renderModule = async (
  url,
  { tag, attributes = '', children = '', props, seen, base, location, static: isStatic = false } = {},
  isAsync = false
) => {
  /**
   * The options are checked because getting one wrong otherwise surfaced an internal: `children: 5`
   * threw `markup.includes is not a function`, `seen: []` threw `seen?.has is not a function`, and
   * omitting the URL entirely produced `Cannot find package 'undefined'`. None of those name the
   * thing the caller got wrong. Server-side, so it costs a browser nothing.
   */
  if (typeof url !== 'string' && !(url instanceof URL)) {
    throw new TypeError('ssr: renderToString needs a module URL — a URL or a string');
  }
  if (typeof attributes !== 'string' && (typeof attributes !== 'object' || Array.isArray(attributes))) {
    throw new TypeError('ssr: `attributes` must be an object of names to values, or a string');
  }
  if (typeof children !== 'string') throw new TypeError('ssr: `children` must be a markup string');
  /**
   * An **array** is refused along with the other wrong types. `Object.assign(element, ['a'])` sets a
   * property named `0`, so passing rows straight through instead of `{ rows }` — the obvious slip —
   * assigned nothing anyone meant and said nothing about it. `attributes` already refuses one.
   */
  if (props !== undefined && (typeof props !== 'object' || props === null || Array.isArray(props))) {
    throw new TypeError('ssr: `props` must be an object of properties to assign');
  }
  if (seen !== undefined && !(seen instanceof Set)) throw new TypeError('ssr: `seen` must be a Set');
  if (location !== undefined && typeof location !== 'string' && !(location instanceof URL)) {
    throw new TypeError('ssr: `location` must be a URL or a path string');
  }
  if (typeof isStatic !== 'boolean') throw new TypeError('ssr: `static` must be true or false');
  /** A `tag` that is not a string cannot name a custom element, and saying so here names the option. */
  if (tag !== undefined && typeof tag !== 'string') {
    throw new TypeError(`ssr: \`tag\` must be a custom element name, and ${typeof tag} is not one`);
  }

  const href = url instanceof URL ? url.href : url;

  /**
   * `import()` executes whatever it is given, so a URL with any request data in it needs bounding —
   * and `new URL` resolves `../` *before* this function sees anything, so the traversal has already
   * happened by the time the string arrives. Mapping a route to a component file is the obvious way
   * to use a server renderer, which is exactly where that goes wrong.
   *
   * Opt-in rather than required: most calls name a constant, and ceremony that is always trivially
   * satisfied stops being read. Deliberately the same shape and the same wording as
   * `@verajs/autoloader`'s containment check, so "module URLs are bounded to a base" is one idea in
   * this framework rather than two.
   */
  if (base) {
    /**
     * Read as a directory whether or not it was written as one.
     *
     * `new URL('.', 'file:///app/components')` is `file:///app/` — the **parent**. A caller who
     * wrote the directory without a trailing slash therefore got a bound one level wider than the
     * one they asked for, silently, and the module was imported before anything noticed. Appending
     * the slash can only ever tighten the bound, and a caller who meant a file gets a loud refusal
     * on the next render rather than a quiet widening on this one.
     */
    const given = base instanceof URL ? base.href : String(base);
    const root = new URL('.', given.endsWith('/') ? given : `${given}/`).href;
    if (!href.startsWith(root)) {
      throw new Error(`ssr: refused ${href} — resolves outside ${root}`);
    }
  }

  /**
   * The import is what registers the component, so it cannot be skipped merely because the caller
   * named a `tag` — a first render with `{ tag }` would then look for a definition nothing had
   * created. `entryTags` having the href is proof the module has already been imported, and that
   * is the only condition under which the import is skipped.
   */
  if (!entryTags.has(href)) {
    const module = await import(href);
    let derived;

    /**
     * The entry tag is found by matching this module's **exports** against the registry, never by
     * diffing the registry around the import.
     *
     * The diff was unsound the moment two renders overlapped, which for a server is the normal
     * condition: both snapshot the registry, both await their import, and both then see both
     * modules' registrations as "new" — so a request for one component was answered with another's
     * markup. Verified before the change: concurrent renders of `race-a` and `race-b` both returned
     * `race-b`. Identity matching depends on nothing outside the module being asked about.
     */
    for (const exported of [module.default, ...Object.values(module)]) {
      if (typeof exported !== 'function') continue;
      for (const [name, Class] of registry) if (Class === exported) derived = name;
      if (derived) break;
    }
    /** Recorded either way — the entry doubles as "this href has been imported". */
    entryTags.set(href, derived ?? '');
  }

  tag = tag || entryTags.get(href);
  if (!tag || !registry.has(tag)) {
    throw new Error(
      `ssr: no custom element definition found for ${url} — export the component's class, or pass { tag }`
    );
  }

  /**
   * An object is escaped; a string is written through untouched.
   *
   * The string form was the only one, and it is a hole: `attributes` reaches the markup verbatim, so
   * a value taken from a request could close the tag and open a `<script>`. It stays, because a
   * caller may genuinely need to write markup only they can produce, but it is no longer the
   * ordinary way to do the ordinary thing — an object cannot escape the tag it describes.
   */
  const attrString =
    typeof attributes === 'string'
      ? attributes
      : Object.entries(attributes)
          .filter(([, value]) => value != null && value !== false)
          .map(([name, value]) => {
            /**
             * **The name is checked, because escaping the value is only half of it.**
             *
             * The claim this form makes is that it cannot escape the tag it describes, and it could
             * not — but it could add *more attributes inside* that tag, which is just as bad and
             * less obvious: `{ 'a=1 onload': v }` wrote `a="1" onload="v"`, an event handler with a
             * caller-controlled body, and `{ 'a x': v }` wrote two attributes from one entry. A
             * server mapping request data onto attribute names is the case this option exists for.
             *
             * The rule is the HTML attribute-name production, and it is the same set the browser
             * engines reject in `setAttribute` — space, quote, apostrophe, `>`, `/`, `=` and
             * controls (see `tests/browser/spread-names.test.js`, which records that engines accept
             * everything else). So this refuses exactly what the client would refuse, rather than
             * inventing a stricter rule the two halves would then disagree about.
             */
            if (/[\0-\x20"'>/=\x7f]/.test(name) || name === '')
              throw new TypeError(
                `ssr: \`attributes\` cannot use ${JSON.stringify(name)} as a name — an attribute name may not ` +
                  `contain whitespace, a quote, "/", "=" or ">". Written into a tag it would produce more ` +
                  `attributes than the one entry describes, and setAttribute refuses it in the browser too.`
              );
            return ` ${name}="${escapeHtml(value === true ? '' : value)}"`;
          })
          .join('');

  assertRendererIntact();

  /**
   * The request's URL, applied **here** — after every `await` and immediately before the render.
   *
   * `globalThis.location` is process-global and a request is not. The documented way to render a
   * route used to be to assign to it and then call this, which is safe only until two requests
   * overlap: `renderToString` awaits `import(href)`, and on a module's first import that await
   * yields, so whichever request assigned last won for every render after it. Measured with three
   * concurrent first-time imports, **two of three rendered another request's path** — a page
   * answered with someone else's data, which is the worst thing a server renderer can do.
   *
   * Everything from this line to the end of the render is synchronous, so setting it now and
   * restoring it after cannot interleave with anything.
   */
  const previousLocation = location === undefined ? undefined : applyLocation(location);
  /**
   * A component setting `document.title` is ordinary — it is how a shell names the page, and what a
   * router's `title` option does. It is also a **process global**, so the value one render produced
   * was left sitting there for the next one to read, and a caller doing the obvious thing
   * (`await renderToString(...)` then `document.title`) got whichever request finished last.
   *
   * Returned on the result instead, exactly as `styles` is — something the render produced belongs
   * to the render — and the global is put back, so a concurrent render cannot see it at all.
   */
  const previousTitle = globalThis.document.title;

  /**
   * From here to the end in a `try`, so a render that **throws** still puts the globals back.
   *
   * The first version of this restored them just before returning, which is every path except the
   * one that matters most: a failed render left its URL and its title on the process for every
   * request after it, and a request that fails is followed by others exactly as one that succeeds
   * is. The leak this whole area exists to close, surviving on the error path.
   */
  const restore = () => {
    globalThis.document.title = previousTitle;
    if (previousLocation !== undefined) restoreLocation(previousLocation);
    /** Always, so a throw cannot leave the next render's stores inert. */
    if (isStatic) setStaticStores(false);
  };

  /**
   * **Awaited inside the `try`, not returned from it.** `try { return promise } finally` runs the
   * restore when the promise is *created*, not when it settles — so the title and location would go
   * back before the render that reads them had finished. The synchronous branch stays a plain
   * return, so it pays nothing for a hazard it does not have.
   */
  if (isAsync) {
    try {
      return await renderPageAsync();
    } finally {
      restore();
    }
  }
  try {
    return renderPage();
  } finally {
    restore();
  }

  /**
   * The bookkeeping every render starts from, shared so the two page renderers cannot drift on it.
   * It is module-level state, which is why the synchronous render must stay synchronous end to end
   * and why the asynchronous one takes a turn at a time — see `renderToStringAsync`.
   */
  function beginRender() {
    renderedTags.clear();
    renderErrors.length = 0;
    /** Re-arms the once-per-class hoist rule, which keeps one request's CSS out of another's. */
    beginHoisting();
    /** Anything a previous render marked and never emitted must not be adopted by this one. */
    pendingInstances.clear();
  }

  function renderPage() {
  /** Synchronous from here, so the per-render bookkeeping below cannot interleave with another. */
  beginRender();
  /**
   * `children` is what a `<slot>` in the component renders. Without it a component built around a
   * slot could be server-rendered only empty — the entry tag's contents were the shadow template
   * and nothing else.
   */
  /**
   * **`static: true` says this page will not be interactive**, so its stores need not be reactive.
   * A server render is one shot — subscriptions built during it are never fired afterwards — and on
   * a component rendering twenty rows the proxy behind `createStore` is the *entire* reactivity
   * overhead: about 40 µs against a 15 µs baseline, where effects and the scheduler cost nothing
   * measurable. Turning it off is worth roughly 3x.
   *
   * Set here rather than around the whole call so it covers exactly the component tree and not the
   * module import, and restored in the `finally` below so a throw cannot leave a server rendering
   * inert pages afterwards. A write to a store while it is on throws in development, naming the
   * option, rather than silently changing nothing.
   */
  if (isStatic) setStaticStores(true);
  const entry = renderComponent(tag, attrString, 0, props, children);
  return finishPage(`${entry.open}${entry.inner}</${tag}>`, /** @type {string} */ (tag), seen);
  }

  /** The asynchronous page render — the same bookkeeping, an entry component that may wait. */
  async function renderPageAsync() {
    beginRender();
    if (isStatic) setStaticStores(true);
    /** The entry's closing tag is added here; nested ones get theirs from the scanner. */
    const entry = await renderComponentAsync(/** @type {string} */ (tag), attrString, 0, props, children);
    return finishPage(`${entry}</${tag}>`, /** @type {string} */ (tag), seen);
  }

  /**
   * Everything after the entry component has rendered: marker cleanup, the collected failures, and
   * the styles this request is responsible for. Shared, because none of it depends on whether the
   * render was allowed to wait.
   *
   * @param {string} rendered @param {string} tag @param {Set<string>} [seen]
   */
  function finishPage(rendered, tag, seen) {
  let html = rendered;
  /**
   * A marker that was never consumed must not reach the page.
   *
   * Everything the scan renders has its marker removed as it renders. Markup the scan does not
   * read — inside a `<template>` a component wrote itself, or a raw-text element — is never
   * rendered and so keeps its marker, which would ship an internal attribute to the browser.
   */
  if (pendingInstances.size) html = html.replaceAll(new RegExp(` ${INSTANCE_ATTRIBUTE}="\\d+"`, 'g'), '');

  /**
   * Thrown once the walk is over rather than at the point of failure, so the message can name
   * every component that failed instead of only the first — and so core's own isolation still
   * holds while the render runs.
   *
   * Catch it to fall back to a client-rendered shell, which is what `renderToString` throwing
   * means in React and Vue too. It is never right to ship the empty markup this replaces.
   */
  if (renderErrors.length) {
    const [first] = renderErrors;
    const others = renderErrors.length > 1 ? ` (and ${renderErrors.length - 1} more)` : '';
    throw new Error(
      `ssr: <${first.tag ?? tag}> threw while rendering${others} — its markup would be empty. ` +
        `${String(first.error?.message ?? first.error)}`,
      { cause: first.error }
    );
  }
  /**
   * Escaped on the way out. The caller places this string themselves — typically into a `<style>`
   * in their page shell — which makes that their render boundary, and handing them CSS that can
   * close the element is handing them an XSS. The escape is transparent to the CSS parser, so
   * there is no reason to make it their problem.
   */
  /**
   * `seen` makes a page of several islands work.
   *
   * Each render correctly returns the styles of what *it* rendered, so two islands sharing a
   * component each carry that component's CSS and the assembled page ships it twice. Carrying one
   * `Set` across the calls emits each component's styles into the page once, and leaves a single
   * render — the common case — behaving exactly as before.
   */
  const title = globalThis.document.title;

  const styles = [];
  for (const rendered of renderedTags) {
    if (seen?.has(rendered)) continue;
    seen?.add(rendered);
    for (const css of hoistedStyles.get(rendered) ?? []) styles.push(css);
  }
  return { html, styles: styles.map(escapeStyleText).join('\n'), title };
  }
};

/**
 * `hoistedStyles` is **not** re-exported. It is the internal `Map` of light-DOM `@scope` blocks,
 * keyed by the tag that hoisted them, and `renderToString` already returns the ones belonging to the
 * page it built as `styles` — which is the whole reason it is keyed rather than flat. Exporting the
 * raw map put a piece of this package's bookkeeping into its public surface, where nothing used it
 * and nothing documented it.
 */
/**
 * Render a component module to markup.
 *
 * @param url Module URL @param {object} [options] The same options `renderToStringAsync` takes
 * @return `{ html, styles, title }`
 */
export const renderToString = (url, options) => renderModule(url, options, false);

/**
 * **One render at a time**, so an asynchronous render cannot see another's bookkeeping.
 *
 * The per-render state this package keeps — `renderedTags`, `renderErrors`, `pendingInstances`,
 * `instanceCount`, the hoisting state — is module-level, and being synchronous end to end is what
 * makes concurrent `renderToString` calls safe today. An asynchronous render pauses, so that
 * protection does not hold for it, and two overlapping ones would read each other's.
 *
 * Taking a turn each is the version of this that cannot be wrong. It costs concurrency between
 * *asynchronous* renders — `renderToString` is unaffected and still runs whenever it likes — and
 * that is the honest trade for a first version. Holding the state per render instead (Node's
 * `AsyncLocalStorage` is the mechanism, measured at ~220 ns a render) would lift the restriction,
 * and is a separate change with its own gate.
 */
let asyncTurn = Promise.resolve();

/**
 * Render a component module to markup, **awaiting its lifecycle**.
 *
 * The difference from `renderToString` is only *when* a render may wait: this one awaits a
 * component's `connectedCallback` and lets promises settle between frame rounds. That is what an
 * `async connectedCallback` needs — the synchronous render refuses one, because its markup would be
 * empty — and what a routed component's first navigation needs to reach the page.
 *
 * Everything that decides *what* to emit is shared with `renderToString`, and
 * `tests/ssr-async-parity.test.mjs` renders every fixture through both and compares.
 *
 * Asynchronous renders take a turn each; see above.
 *
 * @param url Module URL @param {object} [options] The same options `renderToString` takes
 * @return `{ html, styles, title }`
 */
export const renderToStringAsync = (url, options) => {
  const mine = asyncTurn.then(() => renderModule(url, options, true));
  /** The queue must survive a failed render, or one throw stops every later one. */
  asyncTurn = mine.then(
    () => undefined,
    () => undefined
  );
  return mine;
};

export { registry, serializeTemplate };
