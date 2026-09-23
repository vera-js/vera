import { RESERVED_ELEMENT_NAMES, VOID_ELEMENTS } from '@verajs/shared-utils';
import { atExpressionPosition, createParseState, findRoots, isBlankExpression, mark } from './parser.js';
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
 *   disabled / hidden / …         -> ?bool=${…}, a literal too ("" true, "false" false); bare stays static
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
 * Whether a tag names a COMPONENT — capitalised, or dotted like `motion.path`. `isComponentTag`
 * below asks the same question of a node.
 *
 * **A dash-named tag is NOT one.** `<order-row>` is a custom ELEMENT: it renders as markup and its
 * bare props become properties, which is the whole point of the dashed-tag rule. Folding dashes in
 * here rewrote every custom element as a function call and broke six suites.
 */
const isComponentName = (tag: string): boolean => tag.includes('.') || !/^[a-z]/.test(tag);

/**
 * A dash makes a tag a custom element — except the eight names SVG and MathML already own, which the
 * spec reserves. `<annotation-xml>` read as a custom element had its `encoding` compiled to a
 * property, where the parser cannot see it.
 */
const isCustomElementName = (tag: string): boolean =>
  tag.includes('-') && !RESERVED_ELEMENT_NAMES.has(tag.toLowerCase());

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
  /**
   * The cheap gate, and it has to admit every name `parser.ts` admits — `isNameStart` there is
   * `[A-Za-z_$]`. Narrower here, a module whose JSX is all `<_Icon/>` or `<$Icon/>` was returned
   * verbatim and failed later as `Unexpected token '<'`, which is the silent total loss this
   * transform reports the mismatch case to avoid.
   */
  if (!/<[A-Za-z_$>]/.test(code)) return code;

  /**
   * The emitted call sites must use the SAME identifiers the injected imports bind. These were
   * previously read only where the imports are written, so `{ html: ['h', 'my-lib'] }` imported `h`
   * and then emitted `html\`…\`` — code referencing a name that was never imported. Resolving them
   * here keeps the two in step by construction.
   */
  const [htmlName, htmlFrom] = options.html ?? ['html', '@verajs/core'];
  const [keyedName, keyedFrom] = options.keyed ?? ['keyed', '@verajs/renderer/keyed'];
  const [spreadName, spreadFrom] = options.spread ?? ['spread', '@verajs/renderer/spread'];

  const { roots, mismatch } = findRoots(code);
  /**
   * **Reported, not shrugged at.** Everything else the parser cannot make sense of it hands back
   * untouched, because `<` is ambiguous and `a < b` has to survive — but the cost of that is that a
   * genuine typo is emitted verbatim and surfaces as `Unexpected token '<'` from whatever runs the
   * output next, pointing at JSX the reader believes was compiled. A FAULT — a closing tag that names
   * a different element, or an attribute or spread expression holding nothing — cannot be a
   * comparison or a type, so it gets the same treatment as every other JSX mistake here: file, line,
   * column, and what was wrong. `createParseState`'s doc in `parser.ts` is the list.
   */
  if (mismatch !== null) throw new JsxError(mismatch.message, code, fileName, mismatch.at);
  if (roots.length === 0) return code;

  const injecting = options.inject !== false;
  /**
   * **A tag name the module does not already BIND** — computed by `localName` far below, which is
   * where the rule actually lives and the only place to change it. Injecting an import of a name the
   * module also binds makes the whole file a `SyntaxError` — *"Identifier 'svg' has already been
   * declared"* — and in a browser that is caught and logged, so the page simply does nothing.
   *
   * It is a WHOLE-WORD match over BLANKED text, not the bare substring test `childHelper` uses for
   * its own name — an earlier revision of this comment claimed they were the same rule and they have
   * not been for some time. Comment and string CONTENTS are blanked first (`blankLiterals`), so a
   * hit inside either costs nothing rather than merely costing a different name; and whole-word
   * matching is what keeps a tag REFERENCE (`<svg>` in the markup, `svgPath` in a variable) from
   * being read as a binding and forcing a pointless rename.
   *
   * **A scan for DECLARATIONS was tried here and was wrong**, which is worth recording because the
   * shape is so tempting. A regex for `const|let|var|function|class NAME` misses every other way a
   * module binds a name, and each miss is a dead module: `const { svg } = vera` — the buildless CDN
   * idiom — `const [svg, setSvg] = useState()`, and `let a, svg`. Worse, it can never see a
   * PARAMETER: `({ svg }) =&gt; &lt;path d={svg} /&gt;` shadows the module-scope import and throws
   * *"svg is not a function"* at the first render. Chasing binding forms with regexes is scope
   * analysis by other means, and this transform is deliberately lexical.
   *
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
    /**
     * An expression's own JSX is cut out of it exactly as the module's is, and this recursion is the
     * whole point. Pushing the raw slice instead put the markup of a NESTED root — its TEXT children
     * included — into the scan, so `` {x && <p>Don't stop</p>} `` fed an apostrophe to it, which
     * opened a string that never closed and blanked every binding after it. That is the same hazard
     * the outer loop removes for top-level roots, surviving one level in.
     */
    const pushExpression = (text: string, base: number, inner: readonly JsxRoot[]): void => {
      let at = base;
      for (const root of [...inner].sort((a, b) => a.start - b.start)) {
        parts.push(code.slice(at, root.start));
        walk(root.node);
        at = root.end;
      }
      parts.push(code.slice(at, base + text.length));
    };
    const walk = (node: JsxNode): void => {
      if (node.fragment === undefined)
        for (const attribute of node.attrs)
          if (attribute.spread === true || attribute.kind === 'expr')
            pushExpression(attribute.text, attribute.valueStart, attribute.roots);
      for (const kid of node.children) {
        if ('text' in kid) continue;
        if ('expr' in kid) pushExpression(kid.expr, kid.exprStart, kid.roots);
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
    /**
     * Joined with `;`, not a bare newline, because every seam is a place an EXPRESSION may start —
     * the head of an attribute or child expression, or the code after a root, which itself began at
     * an expression position. A newline alone left the walk holding the previous part's last
     * character, so in `<p>{n} is {/^['"]/.test(s) ? 'q' : 'b'}</p>` the second expression's regex
     * read as `n` divided, its quote opened a string, and the binding after the JSX was blanked —
     * the injected import then collided with it.
     */
    return parts.join('\n;');
  })();

  /**
   * **The JavaScript with every comment, string and template-literal CONTENT blanked**, delimiters
   * and newlines kept, so the two questions below read code and never prose.
   *
   * A pair of regexes did this and was wrong in BOTH directions, each fatally. Blanking `` `…` ``
   * non-recursively inverts on a NESTED literal — `` `A ${`B`} C` `` pairs the first backtick with
   * the second, so A and C are blanked and B LEAKS — and a fake `import { html } from …` inside B
   * then suppressed the injection for `html is not defined`. In the other direction a lone backtick
   * inside a string (`` const hint = "wrap in `" ``) paired with the next real literal and ATE the
   * binding between them, so a real `const { html } = vera` went unseen and the injected import
   * collided with it. `//` inside `'https://…'` and `/*` as a string's contents do the same.
   *
   * Hence a scan rather than a pattern: whether a token is inside a literal is a question about
   * characters, and nothing shorter answers it. Newlines survive so the line-anchored import match
   * still works, and delimiters survive so a tag use (`` html` ``) stays visible.
   */
  const blankLiterals = (text: string): string => {
    let out = '';
    let i = 0;
    /**
     * Open template literals, and the BRACE DEPTH inside the innermost `${…}`. A bare `}` counter
     * assumed every `}` closed an interpolation, so an object literal, a destructuring pattern or a
     * block inside one ended it early — `` `${ n ? f({ n }) : `it's empty` }` `` then read the
     * NESTED template's opening backtick as a closing one and spilled its text into code, where an
     * apostrophe opened a fake string and ate the binding after it.
     */
    const open: number[] = [];
    /**
     * The expression-position heuristic is `parser.ts`'s, and so is the cursor it reads: this walk
     * keeps the REAL `ParseState` and records into it with the same `mark`, rather than a private
     * pair of `lastChar`/`lastWord` locals kept in step by hand. That copy is what "one rule, two
     * addresses" cost here — it had drifted again by the time it was removed, marking a non-word
     * character as a whole `lastWord` where `scanCode` clears it.
     */
    const cursor = createParseState(text);
    const eatTemplate = () => {
      while (i < text.length) {
        if (text[i] === '\\') {
          out += '  ';
          i += 2;
          continue;
        }
        if (text[i] === '`') {
          out += '`';
          i++;
          open.pop();
          /** A finished template is a VALUE, so a `/` after it is division — `parser.ts` agrees. */
          mark(cursor, '`');
          return;
        }
        if (text[i] === '$' && text[i + 1] === '{') {
          out += '${';
          i += 2;
          open[open.length - 1] = 0;
          /** Inside `${` an expression STARTS, so a leading `/` opens a regex. Leaving the cursor at
           *  whatever preceded the literal read it as division and blanked the rest of the file. */
          mark(cursor, '{');
          return;
        }
        out += text[i] === '\n' ? '\n' : ' ';
        i++;
      }
    };
    while (i < text.length) {
      const c = text[i];
      const next = text[i + 1];
      if (c === '/' && next === '/') {
        while (i < text.length && text[i] !== '\n') {
          out += ' ';
          i++;
        }
        continue;
      }
      if (c === '/' && next === '*') {
        const close = text.indexOf('*/', i + 2);
        const stop = close < 0 ? text.length : close + 2;
        for (; i < stop; i++) {
          if (text[i] === '\n') cursor.brokeLine = true;
          out += text[i] === '\n' ? '\n' : ' ';
        }
        continue;
      }
      if (c === '"' || c === "'") {
        out += c;
        i++;
        while (i < text.length && text[i] !== c) {
          if (text[i] === '\\') {
            out += '  ';
            i += 2;
            continue;
          }
          out += text[i] === '\n' ? '\n' : ' ';
          i++;
        }
        if (i < text.length) {
          out += c;
          i++;
        }
        /** A finished string is a VALUE too. Without this `const qs = 'w' / 2;` read the `/` as a
         *  regex opener and swallowed the binding on the same line. */
        mark(cursor, "'");
        continue;
      }
      if (c === '`') {
        open.push(0);
        out += c;
        i++;
        eatTemplate();
        continue;
      }
      /**
       * Braces inside an interpolation are code, so they are MARKED like any other character — as
       * `scanCode` marks them. Counting them without marking left the walk holding whatever preceded
       * the `{`, so in `` `${(function () { /'/.test(x); })()}` `` the `)` before the block made the
       * regex read as division, its quote blanked the rest of the module, and a binding went with it.
       */
      if (c === '{' && open.length > 0) {
        open[open.length - 1]! += 1;
        out += c;
        i++;
        mark(cursor, c);
        continue;
      }
      if (c === '}' && open.length > 0) {
        out += c;
        i++;
        if (open[open.length - 1]! > 0) {
          open[open.length - 1]! -= 1;
          mark(cursor, c);
        } else eatTemplate();
        continue;
      }
      /**
       * A REGEX literal, which the walk used to copy as code — so `/^['"]/` opened a fake string on
       * its quote and blanked the real source after it, hiding a binding and letting the injected
       * import collide with it. `/^https?:\/\//` is an everyday URL matcher. `parser.ts` has always
       * discriminated this; this walk is the same rule's second address and went without it.
       */
      /**
       * A regex exactly where `parser.ts` says one may start — the same call, not a second opinion,
       * because the two walks disagreeing is what produced three separate defects in this audit.
       *
       * A closing-slash look-ahead used to guard this as well and is gone: it could not tell a
       * terminator from a slash inside a later string, and skipping strings to fix that broke every
       * regex carrying a quote or a backtick. The `}` line-break rule in `atExpressionPosition`
       * answers the same question properly.
       *
       * **A regex never contains a line break, so reaching one UNDOES the reading** — the blanking is
       * rolled back and the `/` is division. `scanCode` can bail at a newline "without harm" because it
       * only moves a cursor; this walk writes as it goes, so bailing without the rollback blanked the
       * rest of the line — an object literal divided ACROSS lines (`{ a: 1 }` newline `/ 2, html = 1`)
       * lost its binding and the injected import collided with it. What remains is an object literal
       * divided on its own line with a SECOND slash later on that line, which a line-bounded walk
       * cannot tell from a regex — the same residual as a `}` sharing its line with one.
       */
      if (c === '/' && ((cursor.i = i), atExpressionPosition(cursor))) {
        out += c;
        i++;
        const body = i;
        const kept = out.length;
        let closed = false;
        let inClass = false;
        while (i < text.length) {
          const r = text[i];
          if (r === '\\') {
            out += '  ';
            i += 2;
            continue;
          }
          if (r === '\n') break;
          if (r === '[') inClass = true;
          else if (r === ']') inClass = false;
          else if (r === '/' && !inClass) {
            out += '/';
            i++;
            closed = true;
            break;
          }
          out += ' ';
          i++;
        }
        if (!closed) {
          out = out.slice(0, kept);
          i = body;
          mark(cursor, '/');
          continue;
        }
        while (i < text.length && /[a-z]/.test(text[i]!)) {
          out += text[i];
          i++;
        }
        mark(cursor, '/');
        continue;
      }
      if (/\S/.test(c!)) {
        /** Member names are not keywords — `parser.ts`'s `scanCode` marks them the same way, and the
         *  two walks answering differently is what let `timings.in / 2, html = 1` eat its binding
         *  here while the parser read it correctly. */
        mark(
          cursor,
          c!,
          /[\w$]/.test(c!)
            ? /[\w$]/.test(cursor.lastChar)
              ? cursor.lastWord + c
              : cursor.lastChar === '.'
                ? `.${c}`
                : c!
            : ''
        );
      } else if (c === '\n') {
        cursor.brokeLine = true;
      }
      out += c;
      i++;
    }
    return out;
  };
  const source = blankLiterals(js);

  /**
   * Names a real import statement binds, **each with the module it came from**.
   *
   * The specifier is the whole point. Without it any import that merely shares a name with a tag was
   * taken to BE that tag: `import svg from './icon.svg'` — the SVGR/Vite asset idiom, and reachable
   * only since the root upgrade started injecting `svg` into ordinary icon modules — suppressed the
   * injection, emitted `` svg`…` `` against the imported asset, and failed at first render with
   * `svg is not a function`. An import is a BINDING like any other; it is only the tag when it comes
   * from the tag's own module.
   */
  const imported = new Map<string, string>();
  /**
   * Statements found in the BLANKED text, specifiers read from the original at the same offsets.
   *
   * Both halves are needed and neither alone works. `source` is what can be trusted to say where a
   * real import statement is — a module holding its own source in a template literal otherwise
   * registers a fake one and the injection is suppressed — but it blanks the specifier along with
   * every other string, so `import { svg } from '@verajs/core'` came back as coming from nowhere
   * and stopped being recognised as the tag's own. `blankLiterals` replaces characters one for one,
   * so the offsets line up and the specifier can simply be sliced out of `js`.
   */
  for (const match of source.matchAll(/(?:^|\n)\s*import\s+([^'"]*?)\s*from\s*['"]([^'"]*)['"]/g)) {
    const quote = match[0]!.search(/['"]/);
    const at = match.index! + quote + 1;
    const from = js.slice(at, at + match[2]!.length);
    for (const part of match[1]!.replace(/[{}]/g, ' ').split(','))
      imported.set(part.trim().split(/\s+as\s+/).pop()!.trim(), from);
  }
  /** Every local name already handed out, so two of them can never be the same. */
  const taken = new Set<string>();
  /**
   * The local name for an injected tag: the plain one unless the module BINDS it, in which case the
   * import is renamed rather than duplicated.
   *
   * Three spellings are subtracted before asking, and each is a measured defect if left in. A TAG
   * USE — `` html`…` `` — is a REFERENCE to the very import being added, not a collision; renaming
   * over it leaves `html is not defined`, and `tests/jsx-twin-parity.test.mjs` is built of such
   * pairs. A NAME AFTER `<` binds nothing either — not markup, which is cut out before this text is
   * built, but a type argument or a comparison (`Set<svg>`, `a <svg`), which over-renamed.
   *
   * What remains is asked as a whole WORD, not parsed. A DECLARATION scan was tried and abandoned:
   * a regex for `const|let|var|function|class NAME` misses `const { svg } = vera`, `const [svg] = …`
   * and `let a, svg`, and can never see a parameter. Over-renaming costs an uglier identifier;
   * under-renaming costs the whole module.
   */
  const localName = (exported: string, from: string): string => {
    if (!injecting) return exported;
    /**
     * Their OWN import of this tag — the tag's own module — is the binding to use, and any other
     * import of the name is a collision rather than the tag. Neither answer may skip the binding
     * test below: a module can import a tag AND shadow it, and returning early here meant that
     * adding `import { html } from '@verajs/core'` — a line the transform would otherwise have
     * injected verbatim — turned a working module into a first-render `TypeError`, because the
     * shadowing parameter won at the call site. A binding beats an import, whichever module it
     * came from.
     */
    const ownImport = imported.get(exported) === from;
    const foreignImport = !ownImport && imported.has(exported);
    /**
     * Import STATEMENTS come out too: every binding one makes is already in `imported`, while the
     * export name in `import { html as h }` binds nothing at all — leaving those lines in renamed a
     * tag for a collision that does not exist.
     */
    const stripped = source
      .replace(/(?:^|\n)\s*import\s+[^'"]*?\s*from\s*['"][^'"]*['"];?/g, '')
      .split(`${exported}\``)
      .join('')
      .split(`<${exported}`)
      .join('');
    /**
     * A whole-WORD match, not a substring: `options.html` may name `h`, and a bare `includes('h')`
     * is true of almost any source — `export`, `the`, a hex colour.
     *
     * One test, over text the three misleading spellings have already left. A narrower DECLARATION
     * pattern guarded this while string contents were still visible (`'text/html'` read as a
     * binding), and it cost more than it saved: `[^=;]*?` spans lines, so a
     * `class Chart { row() { return html\`…\` } }` matched as though `class … html` were a binding,
     * and nothing shaped like a regex can see a PARAMETER, which `items.map((svg) => <path d={svg}/>)`
     * binds inside an expression. Blanking literal contents removed the reason for it.
     */
    const escaped = exported.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    /**
     * Two positions the name can occupy without binding anything, and both dangled a hand-written
     * tag when they counted: a MEMBER access (`a.html`) and a KEY (`{ html: 1 }`). A key followed by
     * `:` never binds ITS own name — `const { html: renamed } = lib` binds `renamed` — so the same
     * exclusion serves the object literal and the renaming pattern, while shorthand `{ html }`,
     * which does bind, has no colon and still counts.
     */
    /**
     * ...but `.tsx` is a first-class input, and a TYPE ANNOTATION is spelled exactly like a key up to
     * the colon — `let svg: SVGSVGElement` and `function draw(svg: Element)` are bindings that the
     * key exclusion threw away, for a duplicate declaration and a `svg is not a function`. What
     * distinguishes them is what comes BEFORE: a declaration keyword, or a parameter position. An
     * object literal's `, html: 1` can still match that second form, which over-renames rather than
     * under-renames and is the direction that costs an identifier instead of the module.
     */
    const annotated = new RegExp(`(?:(?:const|let|var|function|class)\\s+|[(,]\\s*)${escaped}\\s*:`);
    /**
     * `...html` is a REST binding, not a member access, and the dot guard rejected it on the dot —
     * so `const { zq, ...html } = lib` was invisible and the injected import collided with it. The
     * inner lookbehind is what tells one dot from three.
     */
    const bound =
      new RegExp(`(?<![\\w$])(?<!(?<!\\.\\.)\\.)${escaped}\\b(?!\\s*:)`).test(stripped) ||
      annotated.test(stripped);
    if (!bound && !foreignImport && !taken.has(exported)) {
      taken.add(exported);
      return exported;
    }
    /** Bound AND imported from the tag's own module: rename, and the injection below still happens
     *  because `has` compares the local name, which is no longer the plain one. */
    const base = `$vera${exported[0]!.toUpperCase()}${exported.slice(1)}`;
    let name = base;
    for (let n = 2; code.includes(name) || taken.has(name); n++) name = `${base}${n}`;
    taken.add(name);
    return name;
  };
  const htmlLocal = localName(htmlName, htmlFrom);
  const keyedLocal = localName(keyedName, keyedFrom);
  const spreadLocal = localName(spreadName, spreadFrom);
  const clauseFor = (exported: string, local: string) =>
    exported === local ? exported : `${exported} as ${local}`;

  const state = { usedHtml: false, usedKeyed: false, usedSpread: false, usedChild: false, usedForeign: false };

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

  /** An expression slice with any JSX roots inside it transformed (bottom-up, offsets stable). */
  const emitExpression = (text: string, roots: JsxRoot[], base: number): string => {
    let out = text;
    for (const root of [...roots].sort((a, b) => b.start - a.start)) {
      out = out.slice(0, root.start - base) + emitRoot(root.node) + out.slice(root.end - base);
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
  const keyExpression = (attribute: Extract<JsxAttribute, { spread?: undefined }>, isRoot: boolean): string => {
    if (!isRoot)
      throw new JsxError('key belongs on the JSX root returned from a list callback', code, fileName, attribute.start);
    return attribute.kind === 'expr'
      ? emitExpression(attribute.text, attribute.roots, valueBase(attribute))
      : JSON.stringify(attribute.kind === 'str' ? attribute.text : null);
  };

  const emitRoot = (node: JsxNode): string => {
    if (isComponentTag(node)) return emitComponent(node as ElementNode, true);
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
    emitInto(node, tpl, true);
    state.usedHtml = true;
    let out = htmlLocal + '`' + parts.reduce((acc, p, i) => acc + (i ? '${' + exprs[i - 1] + '}' : '') + p, '') + '`';
    if (key !== null) {
      state.usedKeyed = true;
      out = `${keyedLocal}(${key}, ${out})`;
    }
    return out;
  };

  /** Emits an element/fragment INLINE into the current template context. */
  const emitInto = (node: JsxNode, tpl: Template, isRoot: boolean): void => {
    if (node.fragment) {
      for (const child of node.children) emitChild(child, tpl);
      return;
    }
    if (isComponentTag(node)) {
      tpl.expr(emitComponent(node as ElementNode, false));
      return;
    }
    tpl.static('<' + node.tag);
    for (const attribute of node.attrs) emitAttribute(node, attribute, tpl, isRoot);
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
    /**
     * Inside `<svg>`/`<math>`, anything the COMPILER does not build inline — an expression, a
     * component — lands in a foreign position at runtime as its own template, and only the renderer
     * can parse it there. That is the one case `@verajs/jsx/namespaces` exists for, so it is imported
     * exactly when a module has it.
     */
    const foreign = node.tag === 'svg' || node.tag === 'math';
    if (foreign) foreignDepth++;
    for (const child of node.children) emitChild(child, tpl);
    if (foreign) foreignDepth--;
    tpl.static(`</${node.tag}>`);
  };

  let foreignDepth = 0;
  const emitChild = (child: JsxChild, tpl: Template): void => {
    if (foreignDepth > 0 && ('expr' in child || isComponentTag(child as JsxNode))) state.usedForeign = true;
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
      tpl.expr(`${childHelper}(${emitExpression(child.expr, child.roots, child.exprStart)})`);
    } else {
      emitInto(child as JsxNode, tpl, false);
    }
  };

  const emitAttribute = (_node: ElementNode, attribute: JsxAttribute, tpl: Template, isRoot: boolean): void => {
    if (attribute.spread) {
      /**
       * `<div {...props} />` -> `<div ${spread(props)}>`. Emitted exactly like `ref`, because it is
       * the same shape: an expression in element position. `@verajs/renderer/spread` resolves the sigils in
       * the keys at runtime, which is the point — a template cannot know the names.
       */
      state.usedSpread = true;
      tpl.static(' ');
      tpl.expr(`${spreadLocal}(${emitExpression(attribute.text, attribute.roots, attribute.valueStart)})`);
      return;
    }
    let name = attribute.name;
    const bound = attribute.kind === 'expr';
    const expression = attribute.kind === 'expr'
      ? emitExpression(attribute.text, attribute.roots, valueBase(attribute)) : null;
    const literal = attribute.kind === 'str' ? attribute.text : null;

    if (name === 'key') {
      tpl.setKey(keyExpression(attribute, isRoot));
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
      /** `{{ __html: }}` names the key and gives it nothing, which emitted an empty template hole. */
      if (isBlankExpression(inner))
        throw new JsxError('dangerouslySetInnerHTML={{ __html: }} has no value', code, fileName, attribute.start);
      const bearer = attribute as Extract<JsxAttribute, { kind: 'expr' }>;
      const innerStart = valueBase(bearer) + bearer.text.indexOf(inner);
      tpl.static(' .innerHTML=');
      tpl.expr(emitExpression(inner, bearer.roots, innerStart));
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
    if (isCustomElementName(_node.tag) && IDENTIFIER.test(name) && !RENAMED_ATTRIBUTES.has(name)) {
      tpl.static(` .${name}=`);
      tpl.expr(bound ? expression! : JSON.stringify(attribute.kind === 'none' ? true : literal));
      return;
    }
    if (name === 'value' || name === 'checked') {
      tpl.static(` .${name}=`);
      /**
       * A LITERAL `checked` is a boolean by the same rule as `hidden` below — `""` is true, `"false"`
       * is false. Passed through as the string it was, the property coerced it the other way round:
       * `checked=""` rendered unchecked and `checked="false"` rendered checked, while
       * `defaultChecked=""` (the `?checked` path) got it right.
       */
      tpl.expr(bound ? expression! : JSON.stringify(name === 'checked' ? literal !== 'false' : (literal ?? true)));
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
      /**
       * `hidden=""` is TRUE. The empty string is what the platform itself SERIALISES a set boolean
       * to — `el.toggleAttribute('hidden', true)` then `outerHTML` gives exactly that — so reading it
       * as false inverted every attribute on markup round-tripped through the DOM, silently.
       * `tests/hydrate-parity.test.mjs` already recorded `<b hidden="">` as `?hidden=${true}` on the
       * renderer side, so the compiler was contradicting this repo's own fixture.
       *
       * `hidden="false"` staying false is the one deliberate divergence: the platform says true, and
       * every author who writes it means false.
       */
      tpl.expr(bound ? expression! : JSON.stringify(literal !== 'false'));
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
  const emitComponent = (node: ElementNode, isRoot: boolean): string => {
    const props: string[] = [];
    let key: string | null = null;
    for (const attribute of node.attrs) {
      if (attribute.spread) {
        props.push(`...${emitExpression(attribute.text, attribute.roots, valueBase(attribute))}`);
        continue;
      }
      if (attribute.name === 'key') {
        key = keyExpression(attribute, isRoot);
        continue;
      }
      if (attribute.kind === 'none') props.push(`${JSON.stringify(attribute.name)}: true`);
      else if (attribute.kind === 'str') props.push(`${JSON.stringify(attribute.name)}: ${JSON.stringify(attribute.text)}`);
      else props.push(`${JSON.stringify(attribute.name)}: ${emitExpression(attribute.text, attribute.roots, valueBase(attribute))}`);
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
          children.push(
            `${childHelper}(${emitExpression(child.expr, child.roots, child.exprStart)})`
          );
        } else {
          children.push(emitRoot(child as JsxNode));
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
    out = out.slice(0, root.start) + emitRoot(root.node) + out.slice(root.end);
  }

  /** Auto-inject imports for what the emitted code uses (opt out with options.inject: false). */
  /** Imports first, then the child helper — so the emitted module reads the way one is written. */
  let prefix = '';
  if (options.inject !== false) {
    /**
     * **Nothing is injected only when the module's OWN import of the tag is the binding the emitted
     * code uses** — its specifier is the tag's own module and `localName` kept the plain name. Any
     * other import of the name is a collision that `localName` has already renamed around, so a
     * duplicate declaration is impossible. `imported` is read from the BLANKED text, so an import
     * inside a comment or a template literal is not one — the scan this replaced read raw
     * `import … from`, and a commented-out import suppressed the injection.
     */
    const has = (name: string, from: string, local: string) => imported.get(name) === from && local === name;
    let inject = '';
    if (state.usedHtml && !has(htmlName, htmlFrom, htmlLocal)) inject += `import { ${clauseFor(htmlName, htmlLocal)} } from '${htmlFrom}';\n`;
    if (state.usedKeyed && !has(keyedName, keyedFrom, keyedLocal)) inject += `import { ${clauseFor(keyedName, keyedLocal)} } from '${keyedFrom}';\n`;
    if (state.usedSpread && !has(spreadName, spreadFrom, spreadLocal)) inject += `import { ${clauseFor(spreadName, spreadLocal)} } from '${spreadFrom}';\n`;
    if (state.usedForeign) inject += `import '@verajs/jsx/namespaces';\n`;
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
  /**
   * A `#!` line is only a hashbang on line ONE, so the prefix goes under it rather than over it.
   * Prepending above turned every executable JSX module into a syntax error at the first byte.
   */
  if (prefix !== '' && out.startsWith('#!')) {
    const nl = out.indexOf('\n');
    return nl < 0 ? `${out}\n${prefix}` : out.slice(0, nl + 1) + prefix + out.slice(nl + 1);
  }
  return prefix + out;
};
