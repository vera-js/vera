import { VOID_ELEMENTS } from '@verajs/shared-utils';
import { findRoots } from './parser.js';
import type { JsxAttribute, JsxChild, JsxNode, JsxRoot, VeraJsxOptions } from './types.js';

/**
 * JSX/TSX -> Vera tagged templates. Compile-time only, ZERO dependencies: the scanner/parser in
 * `parser.js` bounds JSX regions and expression containers lexically, and every JS/TS expression
 * passes through as a raw source slice (TS type syntax survives for the downstream stripper).
 * Every JSX root becomes one `html\`...\`` call site (nested markup is INLINE STATICS of the same
 * template, exactly like hand-written templates — so template identity and every renderer fast
 * path hold), and the runtime is the unchanged @verajs/renderer engine. React DX on web
 * standards, never "React compatibility": components stay platform classes; JSX styles the
 * templates.
 *
 * Attribute mapping:
 *   onClick={f}                    -> @click=${f}
 *   className / htmlFor           -> class / for
 *   value / checked               -> .value / .checked   (controlled-input semantics)
 *   defaultValue / defaultChecked -> value="…" / ?checked=${…}
 *   disabled / hidden / …         -> ?bool=${…} when bound; bare shorthand stays an attribute
 *   dangerouslySetInnerHTML={{__html: x}} -> .innerHTML=${x}
 *   ref={r}                       -> element-position ${r}
 *   key={k} (on a JSX root)       -> keyed(k, html`…`)
 *   style                         -> a STRING (object styles are a compile error)
 *   {...spread} on an element     -> `${spread(props)}` via @verajs/renderer/spread
 *
 * On a COMPONENT tag (dash-named), **a bare prop is a PROP** — `<calendar-day date={d}>` emits
 * `.date=${d}`, which is React's own semantics and the reason JSX exists here. No name table
 * decides which names qualify: a name that cannot be a JS identifier (`data-*`, `aria-*`,
 * `xlink:href` — see `IDENTIFIER`) has no property spelling by construction and stays an
 * attribute, the two names the DOM itself renamed (`NAME_MAP`'s targets, `class`/`for` — renamed
 * because JS syntax refuses them) stay attributes, and everything else is classified by the
 * element's own prototype chain at runtime: the renderer hands `title`, `id` or `style` to the
 * platform accessor that owns it, a declared pair to its setter, and the rest to `init()`'s
 * adoption. The HTML rows above are untouched — `<div title={x}>` is still an attribute.
 */

export const BOOLEAN_ATTRIBUTES = new Set([
  'disabled', 'hidden', 'readonly', 'required', 'open', 'selected', 'multiple',
  'autofocus', 'autoplay', 'controls', 'loop', 'muted', 'playsinline', 'inert', 'reversed',
]);

export const NAME_MAP = { className: 'class', htmlFor: 'for' };

/**
 * The attribute names a COMPONENT tag keeps as attributes: exactly `NAME_MAP`'s targets, derived
 * rather than listed twice. These are the two names the DOM itself renamed because JS syntax
 * refuses them as identifiers — which is also why they can never be the property spelling an
 * author meant. Every other non-hyphenated name on a component is a prop.
 */
const RENAMED_ATTRIBUTES = new Set<string>(Object.values(NAME_MAP));

/**
 * A name that could be a JS property access — which is what qualifies it as a PROP spelling on a
 * component tag. One grammar instead of a vocabulary: `data-x`, `aria-label` and `xlink:href` all
 * fail it (no property spelling exists for them by construction), so they stay attributes with no
 * list naming them.
 */
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * The module-local filter injected for JSX child expressions — see `emitChild`. Named with a `$`
 * so it cannot collide with an author's identifier, and DEFINED per module rather than imported:
 * an import would need a new specifier in every buildless import map (the exact gotcha the CDN
 * recipe documents), while forty-odd bytes inline cost a bundler nothing and are dropped entirely
 * from any module that compiles no JSX children.
 */
const CHILD_HELPER = '$veraChild';
/** Its body, beside its name — the two are one fact, and a caller resolves the name per module. */
const childHelperSource = (name: string) => `const ${name} = (v) => (typeof v === 'boolean' ? null : v);\n`;

/** The renderer's binding sigils. An attribute name that opens with one is the author's own choice. */
const SIGILS = new Set(['.', '?', '@', '&']);

/**
 * **Element names SVG owns outright AND that carry no visible content as HTML.**
 *
 * A template whose ROOT is one of these compiles with `svg` instead of `html`, wherever it was
 * written. That closes the one shape JSX could not express: mode tracking is lexical and stops at a
 * function boundary, so children written at a call site and handed to a component were compiled
 * where they were written —
 *
 *     const Frame = ({ children }) => <svg viewBox="0 0 24 24">{children}</svg>;
 *     <Frame><path d="M0 0h24" /></Frame>
 *
 * built its `<path>` as HTML, an `HTMLUnknownElement` with the right tag and no geometry, and an
 * app's whole header of icons vanished with nothing to search for. The call site cannot know what
 * `Frame` renders; it does not need to, because `<path>` is not an HTML element in any context.
 *
 * **Two exclusions, and the second is the subtle one.**
 *
 * Names SVG SHARES with HTML — `a`, `title`, `script`, `style`, `image`, `font` — are absent because
 * guessing there would break real HTML.
 *
 * Names that would carry VISIBLE CONTENT as an unknown HTML element are absent too, which is the
 * less obvious hazard: this upgrade fires on the root tag alone, so it also applies to a template
 * bound for an HTML parent. `<Box><text>hello</text></Box>` WOULD go from readable text to a 0×0
 * SVG element — which is why `text` is not in the set; it is the hazard avoided, not the shipped
 * behaviour. Every name kept below is empty in practice
 * (`path`, `circle`, `use`, `stop`) or a structural container nobody writes in HTML (`g`, `defs`),
 * so the same mistake costs nothing. `text`, `desc`, `title`, `metadata`, `switch`, `view`, `set`,
 * `filter`, `mask`, `marker`, `pattern`, `symbol`, `tspan` and `textPath` are therefore left out:
 * each is either content-bearing or only ever written inside an `<svg>`, where lexical mode already
 * answers correctly.
 *
 * `foreignObject` is out for the same reason read one more time: carrying visible HTML is its whole
 * purpose, so outside an `<svg>` it loses exactly what `<text>` would.
 *
 * The camelCase names (`clipPath`, `linearGradient`, `radialGradient`, `animateTransform`,
 * `animateMotion`) are out for a different one. `@verajs/ssr` serialises a template's strings and the
 * BROWSER's parser assigns the namespace, so an upgraded template landing in an HTML parent is
 * emitted `clipPath` server-side and parsed `clippath` client-side — hydration then discards the
 * server's markup and rebuilds. Every name kept below is lowercase, where the two agree.
 *
 * Omitting a name is CONSERVATIVE — it falls back to the previous behaviour. INCLUDING a wrong one
 * is not, which is why this list is short rather than complete.
 *
 * `svg` itself is excluded: a template already rooted at `<svg>` needs no tag, which is why
 * `` html`<svg><path/></svg>` `` has always worked, in lit too.
 */
const SVG_ELEMENTS = new Set([
  'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon',
  'g', 'defs', 'use', 'stop', 'animate', 'mpath',
]);

/**
 * SVG names that a SIBLING can vouch for, though a root tag alone cannot.
 *
 * Every exclusion above rests on one sentence — *"this upgrade fires on the root tag alone, so it
 * also applies to a template bound for an HTML parent"* — and that sentence stops being true the
 * moment a sibling in the same group IS an SVG-only name. `<Frame><title>{label}</title><path/></Frame>`
 * is the canonical accessible icon: the `<path>` proves the group is SVG, so the `<title>` beside it
 * is the SVG one. Without this it was built as an HTML `<title>`, which is not the accessible name
 * of anything, and the renderer's warning could only recommend `` svg`…` `` — a spelling no JSX
 * author can write. The remedy has to exist for the advice to be worth printing.
 *
 * Still LOWERCASE only. The camelCase names (`foreignObject`, `textPath`, `clipPath`,
 * `linearGradient`, …) stay out even here, because their hazard is not the root-tag one: `@verajs/ssr`
 * emits the strings verbatim and the browser lowercases them outside an `<svg>`, so hydration
 * discards and rebuilds. A sibling says what the group is, not where it lands.
 */
const SVG_WITH_SIBLING = new Set([
  'title', 'a', 'style', 'script', 'image', 'font',
  'text', 'tspan', 'desc', 'metadata', 'switch', 'view', 'set',
  'filter', 'mask', 'marker', 'pattern', 'symbol',
]);

/**
 * Whether a tag names a COMPONENT — capitalised, or dotted like `motion.path`. `isComponentTag`
 * below asks the same question of a node.
 *
 * **A dash-named tag is NOT one.** `<order-row>` is a custom ELEMENT: it renders as markup and its
 * bare props become properties, which is the whole point of the dashed-tag rule. Folding dashes in
 * here rewrote every custom element as a function call and broke six suites.
 */
const isComponentName = (tag: string): boolean => tag.includes('.') || !/^[a-z]/.test(tag);

/**
 * Whether a tag cannot survive being built in the SVG namespace — a component (it would become a
 * call, not an element) or a CUSTOM ELEMENT (upgrade is spec-gated on the HTML namespace, so an
 * SVG-namespaced one is permanently inert with no `connectedCallback` and no diagnostic).
 *
 * Named once because open-coding it drifted twice: first missing the dotted form, then missing the
 * dash on the expression path. It is deliberately NOT the same question as `isComponentName` — a
 * dash-named tag is an ELEMENT, and folding the dash into that predicate rewrote every custom
 * element as a function call and broke six suites.
 */
const cannotSurviveSvg = (tag: string): boolean => isComponentName(tag) || tag.includes('-');

/**
 * SVG's HTML integration points — the spec's own term, and the runtime's own list: `foreignHost`
 * in `@verajs/renderer` names exactly these three. Content inside one parses in the HTML namespace
 * even within an `svg` template, so BOTH rules read this ONE list: `childMode` flips an expression
 * inside one to `html`, and `refusesSvg` treats what is beneath one as safe rather than blocking
 * the upgrade — refusing there would cost the fix for exactly the remedy the renderer recommends.
 *
 * `<title>` is fully a member. Splitting it out into a second list was tried and measured WRONG: it
 * refused the upgrade over a component in a `<title>` EXPRESSION, which `childMode` has already
 * compiled `html` and which renders and upgrades perfectly — so the surrounding `<path>` lost its
 * namespace and the icon vanished, which is the bug this feature exists to fix. The one shape
 * `<title>` genuinely cannot take is a STATIC element, and `titleWithElement` below bounds exactly
 * that — one narrow guard instead of a whole second list.
 */
const SVG_INTEGRATION_POINTS = new Set(['foreignObject', 'desc', 'title']);

/**
 * Whether this node is a `<title>` holding a static ELEMENT.
 *
 * `@verajs/renderer` scans `<title>` as raw text in every template, by one rule deliberately shared
 * between the scan and the parsed-tree pass. So a STATIC ELEMENT inside a `<title>` in an `svg`
 * template lands in a scan/parse disagreement: `<tspan>` is silently dropped, a binding's sigil is
 * left behind as a dead `@click="$v…$"` attribute, and a spread throws outright. An EXPRESSION never
 * reaches that — it becomes its own template, committed as a child, never scanned as `<title>`'s
 * statics — which is why this asks about static children only.
 */
const titleWithElement = (node: JsxNode): boolean =>
  node.fragment === undefined &&
  node.tag === 'title' &&
  node.children.some((kid) => !('text' in kid) && !('expr' in kid));

/**
 * MathML's TEXT integration points. `annotation-xml` is deliberately absent: it is an integration
 * point only for the two HTML `encoding` values, and a compiler cannot rely on seeing that
 * attribute as a literal — leaving it out keeps its content MathML, which is the spec's answer for
 * every other encoding. `@verajs/renderer`'s `foreignHost` reads the attribute at runtime, where it
 * is knowable, and that asymmetry is the point rather than a drift.
 */
const MATHML_ISLANDS = new Set(['mi', 'mo', 'mn', 'ms', 'mtext']);

/**
 * Whether a node cannot be built in the SVG namespace — itself, or anywhere statically beneath it.
 *
 * The hazard is narrow and worth stating exactly, because three rounds of this feature widened the
 * walk one place at a time. A component becomes a CALL rather than an element; a custom element is
 * spec-gated on the HTML namespace for upgrade, so an SVG-namespaced one is permanently inert with
 * no `connectedCallback` and no diagnostic. Either is silent, which is why the upgrade refuses
 * rather than guesses.
 *
 * It reaches wherever the COMPILER picks the inner tag: children, an expression child's `roots`,
 * and an element's ATTRIBUTES — `<g onClick={() => render(<my-card/>)}>` propagates the upgraded
 * mode into that handler, and the attribute path was the last one still unwalked. What it does not
 * need to reach is an OPAQUE runtime value: a `TemplateResult` arriving through an expression
 * carries whatever namespace its own tag gave it — `` svg`…` `` and `` mathml`…` `` results arrive
 * through the same position — and the renderer names it if it is wrong.
 */
const refusesSvg = (node: JsxNode): boolean => {
  if (node.fragment === undefined) {
    if (cannotSurviveSvg(node.tag)) return true;
    if (titleWithElement(node)) return true;
    /**
     * An island flips its CHILDREN back to HTML, so nothing below it can be harmed — but its own
     * ATTRIBUTES are emitted in the outer, upgraded mode, and returning `false` here skipped the
     * only walk that reaches them. `<g><desc onClick={() => hook(<icon-badge/>)}>` built the badge
     * SVG-namespaced and permanently inert. The island exemption and the attribute walk were added
     * one round apart, and the second undid part of the first.
     */
    if (SVG_INTEGRATION_POINTS.has(node.tag)) return jsxInAttrs(node);
  }
  return hasComponent(node);
};

/**
 * Whether any ATTRIBUTE in this element carries JSX at all — not merely a component.
 *
 * An attribute's expression is emitted in the element's own mode, so an upgraded root compiles the
 * JSX inside its handlers as SVG too — and that template goes wherever the handler puts it, which
 * the root knows nothing about. `<circle onClick={() => open(<form><input/></form>)}/>` built a real
 * form as SVG: not an `HTMLInputElement`, no form semantics, and silent — the renderer's diagnostic
 * inspects only hosts that are themselves SVG- or MathML-namespaced, so a handler's template landing
 * in an ordinary HTML parent is never examined at all.
 *
 * **Any JSX refuses, not just a component.** The narrower test shipped one round earlier and left
 * exactly this behind — the fifth time a guard was written for the instance rather than the class.
 * The compiler cannot know a handler's destination, so it must not assume one; refusing costs an
 * upgrade on a shape that has a handler, which is the conservative direction and the one the
 * renderer names at runtime anyway.
 */
const jsxInAttrs = (node: JsxNode): boolean => {
  if (node.fragment !== undefined) return false;
  for (const attribute of node.attrs)
    if (attribute.spread === true || attribute.kind === 'expr') {
      if (attribute.roots.length > 0) return true;
    }
  return false;
};

/** Whether anything the compiler will tag lies beneath this node — see `refusesSvg`. */
const hasComponent = (node: JsxNode): boolean => {
  if (jsxInAttrs(node)) return true;

  for (const kid of node.children) {
    if ('text' in kid) continue;
    if ('expr' in kid) {
      for (const root of kid.roots) if (refusesSvg(root.node)) return true;
      continue;
    }
    if (refusesSvg(kid)) return true;
  }
  return false;
};

/**
 * What a fragment's children PROVE about their namespace: `svg` (at least one SVG-only element and
 * nothing against it), `html` (something disproves it), or `nothing` (only namespace-free content).
 *
 * Three states rather than two, because "proves nothing" and "disproves" are different and
 * collapsing them was a defect twice. Text proves nothing; so does an EMPTY fragment, at any depth —
 * `<><><></></><path/></>` is the same tree as `<><path/></>` and has to reach the same answer,
 * which a `children.length === 0` check only managed one level down.
 */
const fragmentProof = (node: JsxNode): 'svg' | 'html' | 'nothing' => {
  let found = false;
  for (const kid of node.children) {
    /** Text carries no namespace, so it neither proves nor disproves. */
    if ('text' in kid) continue;
    /**
     * An expression DISPROVES — the `'html'` state, not `'nothing'`, and the distinction is
     * load-bearing at exactly this line. The compiler cannot see what an expression yields, and
     * upgrading over one built its HTML children — custom elements included, which then never
     * upgrade — in the SVG namespace. `'nothing'` here would make `<><path/>{x}</>` compile `svg`,
     * which is the round-1 defect.
     */
    if ('expr' in kid) return 'html';
    if (kid.fragment === true) {
      const inner = fragmentProof(kid);
      if (inner === 'html') return 'html';
      if (inner === 'svg') found = true;
      continue;
    }
    /** Vouchable but not self-proving: neutral here, exactly like text — see `SVG_WITH_SIBLING`. */
    if (SVG_WITH_SIBLING.has(kid.tag)) continue;
    if (!SVG_ELEMENTS.has(kid.tag)) return 'html';
    found = true;
  }
  return found ? 'svg' : 'nothing';
};

/** Whether a fragment's children are ALL, provably, SVG-only — see `fragmentProof`. */
const allSvgChildren = (node: JsxNode): boolean => fragmentProof(node) === 'svg';

/** Platform idiom, named in the principles: an error class STAYS a class. */
class JsxError extends Error {
  constructor(message: string, code: string, fileName: string, offset: number) {
    const upTo = code.slice(0, offset);
    const line = upTo.split('\n').length;
    const character = offset - (upTo.lastIndexOf('\n') + 1) + 1;
    super(`${fileName}:${line}:${character} — ${message}`);
  }
}

/** Escapes static text for placement inside a template literal. */
const escapeStatic = (text: string) => text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

/** React-ish JSX text: whitespace runs containing a newline collapse away at edges, to one space inside. */
const collapseText = (raw: string): string => {
  const text = raw.replace(/^\s*\n\s*/, '').replace(/\s*\n\s*$/, '').replace(/\s*\n\s*/g, ' ');
  return /\n/.test(raw) && text.trim() === '' ? '' : text;
};

/**
 * Transforms JSX/TSX source to plain JS/TS using Vera tagged templates. Returns the code
 * unchanged when it contains no JSX.
 */
export const transformJsx = (code: string, fileName = 'module.jsx', options: VeraJsxOptions = {}): string => {
  if (!/<[A-Za-z>]/.test(code)) return code;

  /**
   * The emitted call sites must use the SAME identifiers the injected imports bind. These were
   * previously read only where the imports are written, so `{ html: ['h', 'my-lib'] }` imported `h`
   * and then emitted `html\`…\`` — code referencing a name that was never imported. Resolving them
   * here keeps the two in step by construction.
   */
  const [htmlName, htmlFrom] = options.html ?? ['html', '@verajs/core'];
  const [keyedName, keyedFrom] = options.keyed ?? ['keyed', '@verajs/renderer/keyed'];
  const [spreadName, spreadFrom] = options.spread ?? ['spread', '@verajs/renderer/spread'];
  const [svgName, svgFrom] = options.svg ?? ['svg', '@verajs/core'];
  const [mathmlName, mathmlFrom] = options.mathml ?? ['mathml', '@verajs/core'];

  /**
   * **A tag name the module does not already DECLARE**, because injecting an import of a name the
   * module binds itself makes the whole file a `SyntaxError` — *"Identifier 'svg' has already been
   * declared"* — and in a browser that is caught and logged, so the page simply does nothing.
   *
   * `const svg = document.querySelector('svg')` beside a `<path/>` is the shape that found this,
   * and it is not exotic: the root upgrade means ordinary icon JSX now injects `svg`, where before
   * only a template already written inside an `<svg>` did. The hole was always there for `html`.
   *
   * The import keeps the EXPORT's real name and renames only the local binding, so the emitted
   * call sites and the import stay in step whichever name is chosen. Three cases, in order: the
   * module already IMPORTS the name, and that import is the binding — use it and inject nothing;
   * nothing is injected at all (`inject: false`), so the caller owns the bindings and renaming one
   * would emit a call to a name they never made; otherwise take the first free suffix.
   *
   * A text scan for declarations rather than a scope analysis, matching this transform's lexical
   * design — and it is the same approach `childHelper` below already takes for its own name, which
   * is where this was copied from. A hit inside a string or a comment only costs a different name.
   */
  const { roots, mismatch } = findRoots(code);
  /**
   * **Reported, not shrugged at.** Everything else the parser cannot make sense of it hands back
   * untouched, because `<` is ambiguous and `a < b` has to survive — but the cost of that is that a
   * genuine typo is emitted verbatim and surfaces as `Unexpected token '<'` from whatever runs the
   * output next, pointing at JSX the reader believes was compiled. A closing tag that names a
   * different element is the one failure that cannot be a comparison, so it gets the same treatment
   * as every other JSX mistake here: file, line, column, and what was wrong.
   */
  if (mismatch !== null)
    throw new JsxError(
      `<${mismatch.expected}> is closed by </${mismatch.found}>`,
      code,
      fileName,
      mismatch.at
    );
  if (roots.length === 0) return code;

  const injecting = options.inject !== false;
  /**
   * **A tag name the module does not contain AT ALL** — the same rule, and the same substring test,
   * that `childHelper` below uses for its own name. Injecting an import of a name the module also
   * binds makes the whole file a `SyntaxError` — *"Identifier 'svg' has already been declared"* —
   * and in a browser that is caught and logged, so the page simply does nothing.
   *
   * **A scan for DECLARATIONS was tried here and was wrong**, which is worth recording because the
   * shape is so tempting. A regex for `const|let|var|function|class NAME` misses every other way a
   * module binds a name, and each miss is a dead module: `const { svg } = vera` — the buildless CDN
   * idiom — `const [svg, setSvg] = useState()`, and `let a, svg`. Worse, it can never see a
   * PARAMETER: `({ svg }) =&gt; &lt;path d={svg} /&gt;` shadows the module-scope import and throws
   * *"svg is not a function"* at the first render. Chasing binding forms with regexes is scope
   * analysis by other means, and this transform is deliberately lexical.
   *
   * So the question asked is not "does the module bind this name" but "does the module contain it",
   * which needs no parsing and cannot be wrong in the dangerous direction. Over-renaming costs an
   * uglier identifier in the output; under-renaming costs the whole module.
   *
   * Because the chosen name is then free BY CONSTRUCTION, the injection needs no separate check for
   * what the module already imports — which is what removed the second import scan that used to
   * live here, and with it a defect of its own: it ran over the untransformed source, so JSX TEXT
   * reading `import html from "./x.js"` inside a `&lt;pre&gt;` registered as a real import and suppressed
   * the injection, leaving `html is not defined`.
   */
  /**
   * **All the JavaScript in the module**: what lies outside every JSX root, PLUS every expression
   * written inside one. Both halves are load-bearing and each was missing once.
   *
   * Reading the raw source instead let JSX TEXT reading `import html from "./x.js"` inside a
   * `<pre>` register as a real import, and made a module that merely WRITES `<svg>` markup rename
   * its own import for nothing. Cutting the roots out wholesale then went too far the other way:
   * `items.map((svg) => <path d={svg} />)` binds `svg` INSIDE a root, and `{x ? html`…` : null}`
   * references a tag inside one — both invisible, both a crash at first render.
   */
  const js = (() => {
    const parts: string[] = [];
    const walk = (node: JsxNode): void => {
      if (node.fragment === undefined)
        for (const attribute of node.attrs)
          if (attribute.spread === true || attribute.kind === 'expr') parts.push(attribute.text);
      for (const kid of node.children) {
        if ('text' in kid) continue;
        if ('expr' in kid) parts.push(kid.expr);
        else walk(kid);
      }
    };
    let at = 0;
    for (const root of [...roots].sort((a, b) => a.start - b.start)) {
      parts.push(code.slice(at, root.start));
      walk(root.node);
      at = root.end;
    }
    parts.push(code.slice(at));
    return parts.join('\n');
  })();

  /**
   * The same JavaScript with COMMENTS removed, which is the only form safe to look for import
   * statements in: a commented-out `import { html } from '@verajs/core';` otherwise reads as a real
   * one, suppresses the injection, and leaves `html is not defined`. Crude on purpose — it may eat a
   * `//` inside a string, which costs nothing here, since all this text is ever asked is whether a
   * name is imported or bound.
   */
  const source = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  /**
   * The same again with every TEMPLATE LITERAL's contents blanked, for the two questions that must
   * not read prose: a module holding its own source as a string —
   * `` const T = `import { html } from 'x';` `` — otherwise registers that as a real import,
   * suppresses the injection, and leaves `html is not defined`. Found by transforming a corpus of
   * 1 041 modules and RUNNING each one, which is the only way this class shows up: it parses.
   *
   * The delimiters stay, so a tag use (`` html` ``) is still visible to the test below that needs
   * it — that one asks `source`, deliberately, because the backtick is the whole signal.
   */
  const outsideText = source.replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``');
  /** Names a real import statement already binds — those need no injecting and no renaming. */
  const imported = new Set<string>();
  for (const [, clause] of outsideText.matchAll(/(?:^|\n)\s*import\s+([^'"]*?)\s*from\s*['"]/g))
    for (const part of clause!.replace(/[{}]/g, ' ').split(','))
      imported.add(part.trim().split(/\s+as\s+/).pop()!.trim());
  /** Every local name already handed out, so two of them can never be the same. */
  const taken = new Set<string>();
  /**
   * The local name for an injected tag: the plain one unless the module BINDS it, in which case the
   * import is renamed rather than duplicated.
   *
   * Three spellings are subtracted before asking, and each is a measured defect if left in. A TAG
   * USE — `` html`…` `` — is a REFERENCE to the very import being added, not a collision; renaming
   * over it leaves `html is not defined`, and `tests/jsx-twin-parity.test.mjs` is built of such
   * pairs. A TAG POSITION — `<svg`, `</svg` — is markup, never a binding.
   *
   * What remains is asked as a substring, not parsed. A DECLARATION scan was tried and abandoned:
   * a regex for `const|let|var|function|class NAME` misses `const { svg } = vera`, `const [svg] = …`
   * and `let a, svg`, and can never see a parameter. Over-renaming costs an uglier identifier;
   * under-renaming costs the whole module.
   */
  const localName = (exported: string): string => {
    if (!injecting) return exported;
    /**
     * Import STATEMENTS come out too: every binding one makes is already in `imported`, while the
     * export name in `import { html as h }` binds nothing at all — leaving those lines in renamed a
     * tag for a collision that does not exist.
     */
    const stripped = outsideText
      .replace(/(?:^|\n)\s*import\s+[^'"]*?\s*from\s*['"][^'"]*['"];?/g, '')
      .split(`${exported}\``)
      .join('')
      .split(`<${exported}`)
      .join('')
      .split(`</${exported}`)
      .join('');
    /**
     * **When the module TAGS with the name, the substring test is not enough and the question gets
     * narrower.** A tag use is a reference to the import being added, so renaming over it dangles —
     * but a module may equally define its OWN tag of that name, where renaming is exactly right.
     * The two are indistinguishable by substring: `const svg = (s, …v) => …` and the string
     * `'text/html'` both merely contain the word. So where a tag use exists, only a DECLARATION
     * counts, which is narrow but wrong far less often than either substring answer.
     *
     * The residual limit, stated rather than papered over: a module that BOTH defines its own tag
     * of this name in a form no declaration keyword introduces — `const { svg } = vera` — AND writes
     * `` svg`…` `` by hand is not distinguishable here. That module wants `options.svg` or
     * `inject: false`, and both are in the README.
     */
    const escaped = exported.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    /**
     * A WHOLE-WORD match, not a substring: `options.html` may name `h`, and a bare `includes('h')`
     * is true of almost any source — `export`, `the`, a hex colour — so every configured short name
     * renamed itself for nothing.
     */
    const bound = source.includes(`${exported}\``)
      ? new RegExp(`(?:^|[^\\w$.])(?:const|let|var|function|class)[\\s{[,]+[^=;]*?\\b${escaped}\\b`).test(outsideText)
      : new RegExp(`\\b${escaped}\\b`).test(stripped);
    /**
     * An existing IMPORT is consulted only after the binding test, never instead of it. A module can
     * import a tag AND shadow it — `import { svg } from '@verajs/core'` beside
     * `({ svg }) => <path d={svg}/>` — and short-circuiting on the import emitted `` svg`…` `` into
     * the scope where the parameter wins, for `svg is not a function` at first render.
     */
    if (!bound && !taken.has(exported)) {
      taken.add(exported);
      return exported;
    }
    const base = `$vera${exported[0]!.toUpperCase()}${exported.slice(1)}`;
    let name = base;
    for (let n = 2; code.includes(name) || taken.has(name); n++) name = `${base}${n}`;
    taken.add(name);
    return name;
  };
  const htmlLocal = localName(htmlName);
  const keyedLocal = localName(keyedName);
  const spreadLocal = localName(spreadName);
  const svgLocal = localName(svgName);
  const mathmlLocal = localName(mathmlName);
  const clauseFor = (exported: string, local: string) =>
    exported === local ? exported : `${exported} as ${local}`;

  const state = { usedHtml: false, usedKeyed: false, usedSpread: false, usedSvg: false, usedMathml: false, usedChild: false };

  /**
   * **A name the module does not already use**, because injecting a second `const $veraChild`
   * makes the whole module a `SyntaxError` — *"Identifier '$veraChild' has already been
   * declared"* — and in a browser that is caught and logged, so the page simply does nothing.
   *
   * This repo has met that failure before, one line away: the import injector carries a `bound`
   * set for exactly it, after a duplicate `import { html }` killed modules the same way. The
   * lesson was recorded there and this reintroduced it, which is what the standing rule about a
   * house rule living in one of two homes is about.
   *
   * A text search rather than a scope analysis, matching this transform's lexical design: a hit
   * inside a string or a comment only makes it pick a different name, which costs nothing.
   */
  let childHelper = CHILD_HELPER;
  /** `taken` as well as the source: the two name-choosers must know about each other, or an exotic
   *  `options.html` naming `Child` picks `$veraChild` for the tag and this picks it again. */
  for (let n = 2; code.includes(childHelper) || taken.has(childHelper); n++)
    childHelper = `${CHILD_HELPER}${n}`;
  taken.add(childHelper);

  /**
   * **The content mode a JSX expression sits in, tracked lexically** — the namespace fix React
   * users never have to think about, done at compile time. A template's namespace is decided by
   * the tag that parses it, so a map callback's shapes inside `<svg>` compiled as `html\`…\``
   * yielded HTMLUnknownElements that never draw; there was NO JSX spelling that worked, because
   * JSX has no `svg\`\`` of its own. Now the surrounding element decides: expressions inside
   * `<svg>` compile their roots with the `svg` tag, inside `<math>` with `mathml`, and
   * `<foreignObject>` flips back to HTML — exactly the tag an author writing templates by hand
   * would have to pick, picked from the same lexical position. A component's children inherit the
   * mode of the position they are WRITTEN in, which is the least-surprise reading of an
   * unknowable runtime placement, and what a hand-written template would do too.
   */
  type Mode = 0 | 1 | 2; // html | svg | math
  const HTML_MODE = 0;
  const SVG_MODE = 1;
  const MATH_MODE = 2;
  /**
   * `SVG_INTEGRATION_POINTS`, not `foreignObject` alone. The two rules disagreeing was a hole:
   * `refusesSvg` let a subtree through on the grounds that an island flips the namespace back,
   * while this only flipped for `foreignObject` — so a custom element inside `<desc>` or `<title>`
   * was compiled `svg` and never upgraded, silently, and the renderer's warning cannot see it
   * because the element genuinely IS SVG-namespaced. Half of it predates this feature. One list,
   * both uses.
   */
  const childMode = (tag: string, mode: Mode): Mode =>
    /**
     * A nested `<svg>`/`<math>` switches namespace only from an HTML insertion mode. Inside foreign
     * content the parser puts EVERY start tag in the adjusted current node's namespace, so
     * `<svg><math><mi>` is all SVG — measured against the platform. Switching unconditionally made
     * the compiler emit `html` for an `<mtext>` that is really SVG, and its own renderer then warned
     * about the output. An integration point is the only way back, which `childMode` handles below.
     */
    mode === HTML_MODE && tag === 'svg'
      ? SVG_MODE
      : mode === HTML_MODE && tag === 'math'
        ? MATH_MODE
        : mode === SVG_MODE && SVG_INTEGRATION_POINTS.has(tag)
          ? HTML_MODE
          : mode === MATH_MODE && MATHML_ISLANDS.has(tag)
            ? HTML_MODE
            : mode;

  /** An expression slice with any JSX roots inside it transformed (bottom-up, offsets stable). */
  const emitExpression = (text: string, roots: JsxRoot[], base: number, mode: Mode): string => {
    let out = text;
    for (const root of [...roots].sort((a, b) => b.start - a.start)) {
      out = out.slice(0, root.start - base) + emitRoot(root.node, mode) + out.slice(root.end - base);
    }
    return out;
  };

  /** One JSX root -> one `html\`…\`` (or a component call), optionally wrapped in `keyed()`. */
  /**
   * A JSX tag is a COMPONENT (a function call) rather than a host element when it is capitalised
   * OR a member expression. A host HTML tag name is always a bare lowercase identifier and can
   * never contain a dot, so `.` cleanly marks both the member components React writes as
   * `<Foo.Bar/>` and the lowercase-namespace ones the ecosystem writes as `<motion.div/>` /
   * `<styled.button/>`. Before this, only the first character was tested: `<Foo.Bar/>` became the
   * call `Foo.Bar({…})` but `<motion.div/>` was silently emitted as the broken host tag
   * `<motion.div>` — a wrong-answer-not-error hazard (run 25).
   */
  type ElementNode = Extract<JsxNode, { tag: string }>;
  const isComponentTag = (node: JsxNode): boolean =>
    !node.fragment && isComponentName((node as ElementNode).tag);

  type Template = {
    static: (s: string) => void;
    expr: (e: string) => void;
    setKey: (k: string) => void;
  };

  /**
   * What `key=…` means, for BOTH emitters.
   *
   * It exists as a function because writing it twice is how this audit's headline defect was born:
   * the element path and the component path each answered a React question and drifted. Even here,
   * with the two sites four lines apart, the first draft of the component half turned a bare
   * `<Row key>` into `keyed(true, …)` while the element half makes it `keyed(null, …)`.
   */
  const keyExpression = (attribute: Extract<JsxAttribute, { spread?: undefined }>, isRoot: boolean, mode: Mode): string => {
    if (!isRoot)
      throw new JsxError('key belongs on the JSX root returned from a list callback', code, fileName, attribute.start);
    return attribute.kind === 'expr'
      ? emitExpression(attribute.text, attribute.roots, valueBase(attribute), mode)
      : JSON.stringify(attribute.kind === 'str' ? attribute.text : null);
  };

  const emitRoot = (node: JsxNode, mode: Mode, vouched = false): string => {
    /** A component dispatches on its own; only a real element's name decides a namespace. */
    if (isComponentTag(node)) return emitComponent(node as ElementNode, true, mode);
    /**
     * A fragment has no tag of its own, so it takes the answer from its children — `<><path/></>`
     * handed to a component is the same shape as `<path/>` handed to one, and was the one form of
     * it that stayed broken.
     */
    if (mode === HTML_MODE) {
      const svgRoot =
        node.fragment === undefined
          ? SVG_ELEMENTS.has(node.tag) || (vouched && SVG_WITH_SIBLING.has(node.tag))
          : allSvgChildren(node);
      /** …but never over a component or custom element, which cannot survive the namespace. */
      if (svgRoot && !hasComponent(node)) mode = SVG_MODE;
    }
    const parts = [''];
    const exprs: string[] = [];
    let key: string | null = null;
    const tpl: Template = {
      static: (s) => (parts[parts.length - 1] += s),
      expr: (e) => {
        exprs.push(e);
        parts.push('');
      },
      setKey: (k) => (key = k),
    };
    emitInto(node, tpl, true, mode);
    const tagName = mode === SVG_MODE ? svgLocal : mode === MATH_MODE ? mathmlLocal : htmlLocal;
    if (mode === SVG_MODE) state.usedSvg = true;
    else if (mode === MATH_MODE) state.usedMathml = true;
    else state.usedHtml = true;
    let out = tagName + '`' + parts.reduce((acc, p, i) => acc + (i ? '${' + exprs[i - 1] + '}' : '') + p, '') + '`';
    if (key !== null) {
      state.usedKeyed = true;
      out = `${keyedLocal}(${key}, ${out})`;
    }
    return out;
  };

  /** Emits an element/fragment INLINE into the current template context. */
  const emitInto = (node: JsxNode, tpl: Template, isRoot: boolean, mode: Mode): void => {
    if (node.fragment) {
      for (const child of node.children) emitChild(child, tpl, mode);
      return;
    }
    if (isComponentTag(node)) {
      tpl.expr(emitComponent(node as ElementNode, false, mode));
      return;
    }
    const inner = childMode(node.tag, mode);
    tpl.static('<' + node.tag);
    for (const attribute of node.attrs) emitAttribute(node, attribute, tpl, isRoot, mode);
    /**
     * **The ELEMENT decides how the tag closes, never how the author spelled it** — which is
     * HTML's own rule, and why `node.selfClosing` is deliberately not read here.
     *
     * JSX borrows XML's `<div/>`; HTML has no such syntax outside foreign content. Passed through,
     * both spellings were wrong in opposite directions and both silently:
     *
     *     <div/><span>after</span>   parsed as  <div><span>after</span></div>   sibling swallowed
     *     <br></br>                  parsed as  <br><br>                        one break, rendered twice
     *
     * Server and client agreed — the statics reach the browser either way — so nothing ever failed;
     * the DOM simply had a shape the source never described. Emitting by element instead makes both
     * spellings mean what every JSX toolchain already means by them.
     *
     * Foreign content needs no special case. Self-closing IS honoured inside `<svg>`/`<math>`, but
     * `<circle></circle>` is equally valid there, and no SVG or MathML element shares a name with
     * an HTML void element — so the rewrite is correct in both content modes without tracking which
     * one we are in. The lookup lowercases because a host tag keeps the author's case (`<bR/>`),
     * while HTML tag names do not.
     */
    if (VOID_ELEMENTS.has(node.tag.toLowerCase())) {
      /**
       * A void element cannot hold anything, so children are not a shape to normalise — there is no
       * markup that means what was written. `<input>{label}</input>` put a BINDING after the input
       * as a text node; refusing at compile time is the only channel that reaches the author.
       */
      if (node.children.length > 0)
        throw new JsxError(
          `<${node.tag}> is a void element — it has no end tag and cannot hold children. ` +
            `Move them out, or use an element that can hold them.`,
          code,
          fileName,
          node.start
        );
      tpl.static(' />');
      return;
    }
    tpl.static('>');
    for (const child of node.children) emitChild(child, tpl, inner);
    tpl.static(`</${node.tag}>`);
  };

  const emitChild = (child: JsxChild, tpl: Template, mode: Mode): void => {
    if ('text' in child && child.text !== undefined) {
      const text = collapseText(child.text);
      if (text !== '') tpl.static(escapeStatic(text));
    } else if ('expr' in child && child.expr !== undefined) {
      /**
       * **A boolean child renders nothing — React's rule, in the grammar React users write.**
       *
       * `{items.length > 0 && <em/>}` evaluates to `false` when the test fails, and a template
       * renders that as the word "false" (lit's rule, which `@verajs/renderer` matches on purpose).
       * It is the single most common JSX conditional and nobody means the text, so the child is
       * filtered here — the one value semantic on which JSX and a hand-written template differ,
       * and the reason the renderer names a boolean child in development.
       *
       * Filtered in USER CODE, before the value reaches a template: the renderer and
       * `@verajs/ssr` both already drop `null`, so neither needs to know this rule exists and
       * there is no second implementation to keep in step. Costs a module-local arrow and one
       * call per child value — measured at or below the noise floor in all three engines, and a
       * bundle that compiles no JSX never sees it.
       *
       * `{0 && <x/>}` still renders `0`, exactly as React does: the rule is about booleans, not
       * about falsiness, which is why it cannot be a truthiness test.
       */
      state.usedChild = true;
      tpl.expr(`${childHelper}(${emitExpression(child.expr, child.roots, child.exprStart, mode)})`);
    } else {
      emitInto(child as JsxNode, tpl, false, mode);
    }
  };

  const emitAttribute = (_node: ElementNode, attribute: JsxAttribute, tpl: Template, isRoot: boolean, mode: Mode): void => {
    if (attribute.spread) {
      /**
       * `<div {...props} />` -> `<div ${spread(props)}>`. Emitted exactly like `ref`, because it is
       * the same shape: an expression in element position. `@verajs/renderer/spread` resolves the sigils in
       * the keys at runtime, which is the point — a template cannot know the names.
       */
      state.usedSpread = true;
      tpl.static(' ');
      tpl.expr(`${spreadLocal}(${emitExpression(attribute.text, attribute.roots, attribute.valueStart, mode)})`);
      return;
    }
    let name = attribute.name;
    const bound = attribute.kind === 'expr';
    const expression = attribute.kind === 'expr'
      ? emitExpression(attribute.text, attribute.roots, valueBase(attribute), mode) : null;
    const literal = attribute.kind === 'str' ? attribute.text : null;

    if (name === 'key') {
      tpl.setKey(keyExpression(attribute, isRoot, mode));
      return;
    }
    if (name === 'ref') {
      tpl.static(' ');
      tpl.expr(bound ? expression! : JSON.stringify(literal));
      return;
    }
    if (name === 'dangerouslySetInnerHTML') {
      const match = attribute.kind === 'expr' ? /^\s*\{\s*__html\s*:([\s\S]*)\}\s*$/.exec(attribute.text) : null;
      if (!match) throw new JsxError('dangerouslySetInnerHTML expects {{ __html: expr }}', code, fileName, attribute.start);
      const inner = match[1]!.trim().replace(/,\s*$/, '');
      const bearer = attribute as Extract<JsxAttribute, { kind: 'expr' }>;
      const innerStart = valueBase(bearer) + bearer.text.indexOf(inner);
      tpl.static(' .innerHTML=');
      tpl.expr(emitExpression(inner, bearer.roots, innerStart, mode));
      return;
    }
    if (name === 'style' && attribute.kind === 'expr' && /^\s*\{/.test(attribute.text)) {
      throw new JsxError('style expects a STRING in Vera JSX (e.g. style={`color:${c}`}), not an object', code, fileName, attribute.start);
    }

    /**
     * A sigil the author wrote is passed through untouched — they have asked for a specific binding,
     * and every rule below (`on*` → `@`, the boolean table, `value` → `.value`) exists to *guess* one
     * for names that carry no sigil. Guessing on top of an explicit answer is how `?hidden` would
     * become `??hidden`.
     */
    if (SIGILS.has(name[0]!)) {
      if (attribute.kind === 'none')
        throw new JsxError(`${name} needs a value — write ${name}={…}`, code, fileName, attribute.start);
      tpl.static(` ${name}=`);
      tpl.expr(bound ? expression! : JSON.stringify(literal));
      return;
    }
    name = (NAME_MAP as Record<string, string>)[name] ?? name;
    if (/^on[A-Z]/.test(name)) {
      tpl.static(` @${name.slice(2).toLowerCase()}=`);
      tpl.expr(bound ? expression! : JSON.stringify(literal));
      return;
    }
    /**
     * **On a component tag, a bare prop is a PROP** — React's semantics, and the reason this
     * surface exists. `date={d}`, `date="literal"` and the bare flag `active` all emit `.name`
     * bindings (`active` is `true`, as JSX has always meant it), so the value reaches the
     * component by identity and `init()`'s adoption makes it reactive; the runtime classifies the
     * names this transform cannot — the element's own prototype chain hands `title` or `id` to
     * the platform, a declared pair to its setter — which is what makes this safe with no name
     * table here. A name that cannot be a JS identifier (`data-x`, `aria-label`, `xlink:href` — see
     * `IDENTIFIER`) has no property spelling by construction, and `class`/`for`
     * (`RENAMED_ATTRIBUTES`) were renamed by the DOM itself, so those stay attributes; the form
     * guesses below (`value`/`checked`, the boolean table) are interpretations of HTML controls
     * and deliberately never reach a component — its `disabled={x}` is its own prop.
     */
    if (_node.tag.includes('-') && IDENTIFIER.test(name) && !RENAMED_ATTRIBUTES.has(name)) {
      tpl.static(` .${name}=`);
      tpl.expr(bound ? expression! : JSON.stringify(attribute.kind === 'none' ? true : literal));
      return;
    }
    if (name === 'value' || name === 'checked') {
      tpl.static(` .${name}=`);
      tpl.expr(bound ? expression! : JSON.stringify(literal ?? true));
      return;
    }
    if (name === 'defaultValue') name = 'value';
    if (name === 'defaultChecked') name = 'checked';
    if (BOOLEAN_ATTRIBUTES.has(name) || name === 'checked') {
      if (attribute.kind === 'none') {
        tpl.static(` ${name}`); // bare shorthand: a static attribute
        return;
      }
      tpl.static(` ?${name}=`);
      tpl.expr(bound ? expression! : JSON.stringify(literal !== 'false' && literal !== ''));
      return;
    }
    if (attribute.kind === 'none') {
      tpl.static(` ${name}`);
    } else if (literal !== null) {
      tpl.static(` ${name}="${escapeStatic(literal).replace(/"/g, '&quot;')}"`);
    } else {
      tpl.static(` ${name}=`);
      tpl.expr(expression!);
    }
  };

  const valueBase = (attribute: Extract<JsxAttribute, { valueStart: number }>): number => attribute.valueStart ?? 0;

  /**
   * `<App a={1}>kids</App>` -> `App({ a: 1, children: [...] })`. Spread is fine here.
   *
   * **`key` is the one prop a component never receives**, and until 2026-09-12 it received it: the
   * element path consumes `key` into `keyed(…)` and refuses a misplaced one by name, but this path
   * never called `emitAttribute`, so it inherited neither. `<Row key={id}>` became
   * `Row({ key: id })`, which reached `@verajs/renderer/tag`'s spread as an ordinary prop and wrote
   * `key="7"` into the DOM — a junk attribute, and no list identity at all, so rows reconciled
   * POSITIONALLY: focus, scroll and input state followed the index instead of the item.
   *
   * Every OTHER React rule the element path applies is deliberately NOT applied here, and that is
   * not an omission. `className`, `onClick`, the boolean table and `dangerouslySetInnerHTML` are
   * interpretations of an ATTRIBUTE; a component receives PROPS and decides for itself what they
   * mean, which is React's rule too. Rewriting them on the way in would take that decision away
   * from every component author. Where the component is `tag`'s — which does forward to an element
   * — the mapping belongs at that runtime boundary, and `jsxName` is where it lives.
   */
  const emitComponent = (node: ElementNode, isRoot: boolean, mode: Mode): string => {
    const props: string[] = [];
    let key: string | null = null;
    for (const attribute of node.attrs) {
      if (attribute.spread) {
        props.push(`...${emitExpression(attribute.text, attribute.roots, valueBase(attribute), mode)}`);
        continue;
      }
      if (attribute.name === 'key') {
        key = keyExpression(attribute, isRoot, mode);
        continue;
      }
      if (attribute.kind === 'none') props.push(`${JSON.stringify(attribute.name)}: true`);
      else if (attribute.kind === 'str') props.push(`${JSON.stringify(attribute.name)}: ${JSON.stringify(attribute.text)}`);
      else props.push(`${JSON.stringify(attribute.name)}: ${emitExpression(attribute.text, attribute.roots, valueBase(attribute), mode)}`);
    }
    if (node.children && node.children.length > 0) {
      const children = [];
      /**
       * **A component's children are ONE sibling group, and they decide together.** They are emitted
       * as separate roots — `children: [html`<title>…`, svg`<path…`]` — so each was deciding alone,
       * and a name only a sibling can vouch for lost every time. One `<path>` among them settles the
       * group's namespace for all of them; see `SVG_WITH_SIBLING`.
       */
      const vouched =
        mode === HTML_MODE &&
        node.children.some(
          (kid) => !('text' in kid) && !('expr' in kid) && kid.fragment === undefined && SVG_ELEMENTS.has(kid.tag)
        );
      for (const child of node.children) {
        if ('text' in child && child.text !== undefined) {
          const text = collapseText(child.text);
          if (text !== '') children.push(JSON.stringify(text));
        } else if ('expr' in child && child.expr !== undefined) {
          /**
           * A component's children take the same rule as an element's, because the author wrote
           * the same thing: `<Row>{cond && <em/>}</Row>` must not hand `Row` a `false` that its
           * own `${children}` then renders as the word. Filtered to `null`, so the array's LENGTH
           * is unchanged for a component that counts its children — only what renders differs.
           * A nested JSX element below needs no filter: a template result is never a boolean.
           */
          state.usedChild = true;
          children.push(`${childHelper}(${emitExpression(child.expr, child.roots, child.exprStart, mode)})`);
        } else {
          children.push(emitRoot(child as JsxNode, mode, vouched));
        }
      }
      if (children.length) props.push(`children: [${children.join(', ')}]`);
    }
    const call = `${node.tag}({ ${props.join(', ')} })`;
    if (key === null) return call;
    state.usedKeyed = true;
    return `${keyedLocal}(${key}, ${call})`;
  };

  let out = code;
  for (const root of roots.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, root.start) + emitRoot(root.node, HTML_MODE) + out.slice(root.end);
  }

  /** Auto-inject imports for what the emitted code uses (opt out with options.inject: false). */
  /** Imports first, then the child helper — so the emitted module reads the way one is written. */
  let prefix = '';
  if (options.inject !== false) {
    /**
     * No check for what the module already imports. `localName` has guaranteed every local binding
     * is free, so a duplicate declaration is impossible — and the scan that used to decide this read
     * `import … from` with no idea of comments or strings, so an import inside a BLOCK COMMENT or a
     * template literal suppressed the injection and left `html is not defined`. A module that
     * imports a tag itself now gets a second, aliased import: correct, and one line of noise is the
     * price of never parsing import statements to decide it.
     */
    /** Nothing to inject only when the module's OWN import is the binding the emitted code uses. */
    const has = (name: string, local: string) => imported.has(name) && local === name;
    let inject = '';
    if (state.usedHtml && !has(htmlName, htmlLocal)) inject += `import { ${clauseFor(htmlName, htmlLocal)} } from '${htmlFrom}';\n`;
    if (state.usedKeyed && !has(keyedName, keyedLocal)) inject += `import { ${clauseFor(keyedName, keyedLocal)} } from '${keyedFrom}';\n`;
    if (state.usedSpread && !has(spreadName, spreadLocal)) inject += `import { ${clauseFor(spreadName, spreadLocal)} } from '${spreadFrom}';\n`;
    if (state.usedSvg && !has(svgName, svgLocal)) inject += `import { ${clauseFor(svgName, svgLocal)} } from '${svgFrom}';\n`;
    if (state.usedMathml && !has(mathmlName, mathmlLocal)) inject += `import { ${clauseFor(mathmlName, mathmlLocal)} } from '${mathmlFrom}';\n`;
    prefix = inject;
  }
  /**
   * **Outside the `inject` branch, because `inject` governs IMPORTS and this is not one.**
   *
   * `inject: false` means "I import `html`/`keyed`/`spread` myself" — a caller cannot reasonably
   * be asked to also declare a helper this compiler invented, and emitting the call without its
   * definition produces a module that throws `$veraChild is not defined` at first render. Caught
   * by the equivalence suites, which compile with `inject: false`; a user of that option would
   * have met the same ReferenceError.
   */
  if (state.usedChild) prefix += childHelperSource(childHelper);
  return prefix + out;
};
