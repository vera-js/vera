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
  for (let n = 2; code.includes(childHelper); n++) childHelper = `${CHILD_HELPER}${n}`;

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
  const childMode = (tag: string, mode: Mode): Mode =>
    tag === 'svg' ? SVG_MODE : tag === 'math' ? MATH_MODE : tag === 'foreignObject' ? HTML_MODE : mode;

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
    !node.fragment && (!/^[a-z]/.test((node as ElementNode).tag) || (node as ElementNode).tag.includes('.'));

  interface Template {
    static: (s: string) => void;
    expr: (e: string) => void;
    setKey: (k: string) => void;
  }

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

  const emitRoot = (node: JsxNode, mode: Mode): string => {
    if (isComponentTag(node)) return emitComponent(node as ElementNode, true, mode);
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
    const tagName = mode === SVG_MODE ? svgName : mode === MATH_MODE ? mathmlName : htmlName;
    if (mode === SVG_MODE) state.usedSvg = true;
    else if (mode === MATH_MODE) state.usedMathml = true;
    else state.usedHtml = true;
    let out = tagName + '`' + parts.reduce((acc, p, i) => acc + (i ? '${' + exprs[i - 1] + '}' : '') + p, '') + '`';
    if (key !== null) {
      state.usedKeyed = true;
      out = `${keyedName}(${key}, ${out})`;
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
      tpl.expr(`${spreadName}(${emitExpression(attribute.text, attribute.roots, attribute.valueStart, mode)})`);
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
          children.push(emitRoot(child as JsxNode, mode));
        }
      }
      if (children.length) props.push(`children: [${children.join(', ')}]`);
    }
    const call = `${node.tag}({ ${props.join(', ')} })`;
    if (key === null) return call;
    state.usedKeyed = true;
    return `${keyedName}(${key}, ${call})`;
  };

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

  let out = code;
  for (const root of roots.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, root.start) + emitRoot(root.node, HTML_MODE) + out.slice(root.end);
  }

  /** Auto-inject imports for what the emitted code uses (opt out with options.inject: false). */
  /** Imports first, then the child helper — so the emitted module reads the way one is written. */
  let prefix = '';
  if (options.inject !== false) {
    /**
     * Every name any import statement already binds, so injecting a second declaration of one is
     * impossible.
     *
     * This used to be a single regex anchored at the start of a line, which two ordinary shapes
     * defeated: an **indented** import — every inline `<script type="text/vera-jsx">` block in an
     * HTML page is indented — and an import spread across lines, which formatters produce. Both
     * emitted a duplicate `import { html }`, and the whole module then died with
     * `Identifier 'html' has already been declared`. In the browser that is caught and logged, so
     * the page simply does nothing.
     */
    const bound = new Set<string>();
    for (const [, clause] of out.matchAll(/(?:^|\n)\s*import\s+([^'"]*?)\s*from\s*['"]/g))
      for (const name of clause!.replace(/[{}]/g, ' ').split(','))
        bound.add(name.trim().split(/\s+as\s+/).pop()!.trim());
    const has = (name: string) => bound.has(name);
    let inject = '';
    if (state.usedHtml && !has(htmlName)) inject += `import { ${htmlName} } from '${htmlFrom}';\n`;
    if (state.usedKeyed && !has(keyedName)) inject += `import { ${keyedName} } from '${keyedFrom}';\n`;
    if (state.usedSpread && !has(spreadName)) inject += `import { ${spreadName} } from '${spreadFrom}';\n`;
    if (state.usedSvg && !has(svgName)) inject += `import { ${svgName} } from '${svgFrom}';\n`;
    if (state.usedMathml && !has(mathmlName)) inject += `import { ${mathmlName} } from '${mathmlFrom}';\n`;
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
