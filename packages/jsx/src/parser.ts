/**
 * A zero-dependency JSX scanner/parser — the hand-rolled parser the archived wcc `jsx-loader`
 * was kept as a reference for. It is NOT a JavaScript parser: expressions pass through as raw
 * source slices (the emitter's contract since day one), so all this must do is walk JS *lexically*
 * — strings, template literals (with `${}` nesting), comments, and regex literals — to find where
 * JSX begins, and then parse the JSX grammar itself: elements, fragments, attributes
 * (shorthand / "string" / {expression}), spreads, children, and nested expression containers,
 * which recurse back into the lexical walk (so `{x && <a>don't</a>}` cannot desync on the quote).
 *
 * `<` starts JSX only where an expression may start — see `EXPRESSION_PREFIX` and
 * `EXPRESSION_KEYWORDS` below, which are the list rather than a copy of it that can drift — AND the
 * attempt parses; a failed attempt falls back to a literal `<`, so comparisons and TS generics
 * (`Array<number>`, `f<T>(x)`, which follow identifiers) never match.
 */

import type { JsxAttribute, JsxChild, JsxFault, JsxNode, JsxRoot, ParseState } from './types.js';

/**
 * Characters after which a `<` (or `/`) can begin an expression.
 *
 * **`}` is NOT here, and neither is `)`** — and the two absences have different reasons.
 *
 * A `}` gets its own branch in `atExpressionPosition`, which returns on both paths before this set
 * is consulted, so membership here would be dead. Its rule is POSITIONAL: a block-closing `}` ends
 * its line and what follows starts a statement, while an object literal's sits mid-expression with
 * its operator beside it. A flat "a `}` means an expression may start" was tried and is wrong in
 * both directions — without it a regex at statement position made `scanCode` read `/` as division,
 * the following quote opened a string that never closed, and `findRoots` returned ZERO roots, so the
 * module came back untouched and surfaced as `Unexpected token '<'`; with it, an ordinary
 * `const q = { a: 1 } / 2, html = 1;` opened a regex that ate the binding. Both corpora carry that
 * divided-object line as a live row, so it is emphatically something people write.
 *
 * `)` stays out, and the reason is NOT that a comparison would become a JSX region — measured, it
 * would not: `foo(x) < 3` and `foo(x) <3` both fail the name-start lookahead below, so the `<` side
 * is indifferent. It is the `/` side that decides. A `/` after `)` is division far more often than
 * it is a regex (`f(x) / 2` against a braceless `if (x) /re/.test(y)`), and reading division as a
 * regex makes `blankLiterals` swallow the rest of the line — taking any binding on it with it, so
 * the injected import collides and the module will not load.
 */
const EXPRESSION_PREFIX = new Set([...'(,=?:;[{!&|+-*/%^~<>', '']);
const EXPRESSION_KEYWORDS = new Set([
  'return', 'yield', 'await', 'case', 'typeof', 'void', 'delete', 'in', 'of',
  'instanceof', 'new', 'do', 'else', 'throw',
]);

const isNameStart = (ch: string) => /[A-Za-z_$]/.test(ch);

/** The renderer's binding sigils, which may open an attribute name — see `parseJsx`. */
const SIGILS = new Set(['.', '?', '@', '&']);
/**
 * Tag names. The `.` is for a member component (`<Icons.Chevron/>`), and the `-` is for a **custom
 * element** — which on this framework is the tag people write most, and which did not parse at all:
 * `<my-comp/>` read the name as `my`, met the `-` where an attribute or `>` had to be, and gave up.
 * A failed parse is deliberately silent (see `scanCode`), so the JSX was emitted verbatim and the
 * module failed to load with a syntax error pointing at markup nobody thought was in doubt.
 */
const isNameChar = (ch: string) => /[\w$.-]/.test(ch);
const isAttrNameChar = (ch: string) => /[\w$:-]/.test(ch);

/**
 * The cursor over the source — a plain record, not a class (the conventions pass's ruling:
 * authoring-time code, no perf concern, and the shape rule prefers data + functions).
 *
 * `mismatch`: a closing tag that names a different element than the one it closes, if one was
 * seen. Every other parse failure returns `null` and leaves the source alone, and it has to:
 * `<` is ambiguous, and `a < b` must fall through untouched rather than be called broken JSX.
 * **A `</name>` that does not match the tag it closes is the one failure that cannot be
 * anything else** — reaching it means a whole open tag and its children were already consumed —
 * so it is the one that can be reported instead of shrugged at.
 */
export const createParseState = (code: string, from = 0): ParseState => ({
  code,
  i: from,
  lastChar: '',
  lastWord: '',
  lastPrev: '',
  brokeLine: false,
  mismatch: null,
});

/**
 * Records `ch` as the last meaningful character, carrying the one it displaces into `lastPrev`.
 * Every write to `lastChar` goes through here so the two can never disagree.
 */
export const mark = (state: ParseState, ch: string, word = ''): void => {
  state.lastPrev = state.lastChar;
  state.lastChar = ch;
  state.lastWord = word;
  state.brokeLine = false;
};

export const atExpressionPosition = (state: ParseState): boolean => {
  /**
   * A `}` is where the two readings live, and a LINE BREAK tells them apart. A block-closing `}` is
   * the end of its line and what follows starts a statement — `function f() {}` then a regex, or a
   * JSX root. An object literal's `}` is mid-expression, with its operator on the same line:
   * `const q = { a: 1 } / 2`. Reading that second one as a regex opener consumed to the next slash
   * anywhere on the line and swallowed whatever lay between, and a slash inside an ordinary string
   * (`"a/b"`) was enough to supply one.
   *
   * Asked here rather than by scanning ahead for a closing slash, which was tried and was worse: it
   * cannot tell a terminator from a slash inside a later string (`"a/b"` supplied one), and skipping
   * strings to fix THAT broke every regex carrying a quote or a backtick outside a character class.
   * With the line break deciding, the look-ahead answered nothing the `}` test does not, and no
   * test could tell it from its absence — so it is gone rather than kept as ornament.
   */
  /**
   * A postfix `++`/`--` ENDS an expression, so what follows is an operator — but `+` and `-` are in
   * the set, and `lastChar` sees only the second sign. `{n++ / total}` is an ordinary running
   * percentage, and reading its `/` as a regex opener handed the whole module back untouched
   * (`Unexpected token '<'` from whatever ran it next) or, in the literal scan, ate the binding on
   * the line so the injected import collided with it.
   */
  if (state.lastChar === '+' || state.lastChar === '-') {
    if (state.lastPrev === state.lastChar) return false;
  }
  /**
   * `!` is both a prefix operator — `!/^a/.test(s)`, where a regex really may follow — and
   * TypeScript's postfix non-null assertion, where one may not. What precedes it decides: an
   * identifier, a `)`, a `]` or a string end means the `!` ENDED an expression. `.tsx` is a
   * first-class input, and `a! / b`, `o.n! / 2` and `f()! / 2` are ordinary TypeScript that
   * otherwise opened a regex — losing every root in the module, or eating the binding on the line
   * so the injected import collided with it.
   */
  if (state.lastChar === '!') return !/[\w$)\]'"`]/.test(state.lastPrev);
  if (state.lastChar === '}') return state.brokeLine;

  if (state.lastChar === '' || EXPRESSION_PREFIX.has(state.lastChar)) return true;
  return EXPRESSION_KEYWORDS.has(state.lastWord);
};

/**
 * Walks JS code from `state.i` until `stop(state)` says done (or EOF), collecting every JSX root
 * found at expression positions into `roots` as `{ start, end, node }`. Handles strings,
 * template literals (recursing into `${}`), comments, and regex literals.
 */
export const scanCode = (state: ParseState, stop: ((s: ParseState) => boolean) | null, roots: JsxRoot[]): void => {
  const { code } = state;
  while (state.i < code.length) {
    if (stop !== null && stop(state)) return;
    const ch = code[state.i];

    if (ch === "'" || ch === '"') {
      skipString(state, ch);
    } else if (ch === '`') {
      skipTemplate(state, roots);
    } else if (ch === '/' && code[state.i + 1] === '/') {
      while (state.i < code.length && code[state.i] !== '\n') state.i++;
    } else if (ch === '/' && code[state.i + 1] === '*') {
      state.i += 2;
      while (state.i < code.length && !(code[state.i] === '*' && code[state.i + 1] === '/')) {
        if (code[state.i] === '\n') state.brokeLine = true;
        state.i++;
      }
      state.i += 2;
    } else if (ch === '/' && atExpressionPosition(state)) {
      skipRegex(state);
    } else if (ch === '<' && /[A-Za-z_$>]/.test(code[state.i + 1] ?? '') && atExpressionPosition(state)) {
      const start = state.i;
      const node = parseJsx(state);
      if (node !== null) {
        roots.push({ start, end: state.i, node });
        mark(state, ')'); // a JSX root is an expression
        continue;
      }
      /**
       * Not JSX after all — back off one character and carry on reading it as ordinary code.
       *
       * The tolerance is load-bearing rather than lazy: a TSX generic arrow (`<T,>(x: T) => x`)
       * and a generic call both sit at an expression position and start `<` + a letter, and
       * neither is markup. The cost is that genuinely unsupported *markup* passes through
       * untransformed instead of being reported, so a gap here surfaces as a syntax error at load.
       * `tests/jsx-equivalence.test.mjs` is what closes that loop.
       */
      state.i = start + 1;
      mark(state, '<');
    } else {
      if (!/\s/.test(ch)) {
        if (/[\w$]/.test(ch)) {
          /**
           * A word that begins right after a `.` is a MEMBER NAME, never a keyword, and marking it
           * so is the whole fix: `stats.new / 2` and `timings.in / 2` otherwise left `lastWord` at
           * `new`/`in`, which `EXPRESSION_KEYWORDS` accepts, so the `/` opened a regex that ran to
           * the next slash — losing every root in the module, or eating a binding on the line and
           * colliding with the injected import. The `.` prefix cannot match any keyword.
           */
          mark(
            state,
            ch,
            /[\w$]/.test(state.lastChar) ? state.lastWord + ch : state.lastChar === '.' ? `.${ch}` : ch
          );
        } else {
          mark(state, ch);
        }
      } else if (ch === '\n') {
        state.brokeLine = true;
      }
      state.i++;
    }
  }
};

const skipString = (state: ParseState, quote: string): void => {
  const { code } = state;
  state.i++;
  while (state.i < code.length && code[state.i] !== quote) {
    if (code[state.i] === '\\') state.i++;
    state.i++;
  }
  state.i++;
  mark(state, quote);
};

const skipTemplate = (state: ParseState, roots: JsxRoot[]): void => {
  const { code } = state;
  state.i++;
  while (state.i < code.length && code[state.i] !== '`') {
    if (code[state.i] === '\\') {
      state.i += 2;
    } else if (code[state.i] === '$' && code[state.i + 1] === '{') {
      state.i += 2;
      mark(state, '{');
      let depth = 1;
      scanCode(
        state,
        (s) => {
          const c = s.code[s.i];
          if (c === '{') depth++;
          if (c === '}') {
            depth--;
            if (depth === 0) return true;
          }
          return false;
        },
        roots
      );
      state.i++; // the closing }
    } else {
      state.i++;
    }
  }
  state.i++;
  mark(state, '`');
};

const skipRegex = (state: ParseState): void => {
  const { code } = state;
  state.i++;
  let inClass = false;
  while (state.i < code.length) {
    const ch = code[state.i];
    if (ch === '\\') state.i++;
    else if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) break;
    else if (ch === '\n') break; // not a regex after all; bail without harm
    state.i++;
  }
  state.i++;
  while (state.i < code.length && /[a-z]/.test(code[state.i])) state.i++; // flags
  mark(state, '/');
};

/**
 * Consumes a balanced `{expression}` (state.i AT the opening brace), returning the inner source
 * and any JSX roots found inside. Delegates to `scanCode`, so nested JSX, strings, templates,
 * regexes and comments are all safe.
 */
const parseExpressionContainer = (state: ParseState): { text: string; start: number; roots: JsxRoot[] } | null => {
  const { code } = state;
  state.i++; // {
  const start = state.i;
  mark(state, '{');
  const roots: JsxRoot[] = [];
  let depth = 1;
  scanCode(
    state,
    (s) => {
      const c = s.code[s.i];
      if (c === '{') depth++;
      if (c === '}') {
        depth--;
        if (depth === 0) return true;
      }
      return false;
    },
    roots
  );
  if (state.i >= code.length) return null;
  const text = code.slice(start, state.i);
  state.i++; // }
  return { text, start, roots };
};

const skipWhitespace = (state: ParseState): void => {
  while (state.i < state.code.length && /\s/.test(state.code[state.i])) state.i++;
};

/**
 * Parses one JSX element/fragment with `state.i` at `<`. Returns the node or null (caller treats
 * the `<` literally). Nodes:
 *   { fragment: true, children, start }
 *   { tag, attrs: [{ name, kind: 'none'|'str'|'expr', text?, roots?, start } | { spread, text, roots }],
 *     selfClosing, children, start }
 * Children: { text } | { expr, roots } | element nodes.
 */
export const parseJsx = (state: ParseState): JsxNode | null => {
  const { code } = state;
  const start = state.i;
  state.i++; // <

  if (code[state.i] === '>') {
    state.i++;
    const children = parseChildren(state, null);
    if (children === null) return null;
    return { fragment: true, children, start };
  }

  if (!isNameStart(code[state.i]!)) return null;
  let tag = '';
  while (state.i < code.length && isNameChar(code[state.i]!)) tag += code[state.i++];

  const attrs: JsxAttribute[] = [];
  for (;;) {
    skipWhitespace(state);
    const ch = code[state.i];
    if (ch === undefined) return null;
    if (ch === '/') {
      if (code[state.i + 1] !== '>') return null;
      state.i += 2;
      return { tag, attrs, selfClosing: true, children: [], start };
    }
    if (ch === '>') {
      state.i++;
      const children = parseChildren(state, tag);
      if (children === null) return null;
      return { tag, attrs, selfClosing: false, children, start };
    }
    if (ch === '{') {
      const spreadStart = state.i;
      const container = parseExpressionContainer(state);
      if (container === null || !/^\s*\.\.\./.test(container.text)) return null;
      const dots = container.text.match(/^\s*\.\.\./)![0].length;
      attrs.push({
        spread: true,
        text: container.text.slice(dots),
        roots: container.roots,
        start: spreadStart,
        valueStart: container.start + dots,
      });
      continue;
    }
    /**
     * **A sigil may start an attribute name**, so the renderer's own bindings are writable here:
     * `.prop=`, `?bool=`, `@event=` and `&ref=` mean in JSX exactly what they mean in `html`.
     *
     * Without this, `<x-el .rows={data} />` — the natural way to hand a custom element structured
     * data, and the only way, since JSX had no property binding beyond `value` and `checked` — was
     * not an attribute name at all. The parser returned `null`, which is how it says "this was never
     * JSX", and **the whole file was emitted untransformed**: every other component in it stopped
     * compiling too, and the error came from somewhere else entirely.
     *
     * No JSX dialect gives `.`, `?`, `@` or `&` a meaning at the start of an attribute name, so
     * nothing is being taken away to make room.
     */
    if (!isNameStart(ch) && !SIGILS.has(ch)) return null;
    const nameStart = state.i;
    let name = SIGILS.has(ch) ? code[state.i++]! : '';
    while (state.i < code.length && isAttrNameChar(code[state.i]!)) name += code[state.i++];
    /** A lone sigil is a name only for `&`, which is how the renderer spells an explicit ref. */
    if (name.length === 1 && SIGILS.has(name) && name !== '&') return null;
    skipWhitespace(state);
    if (code[state.i] !== '=') {
      attrs.push({ name, kind: 'none', start: nameStart });
      continue;
    }
    state.i++; // =
    skipWhitespace(state);
    const valueChar = code[state.i];
    if (valueChar === '"' || valueChar === "'") {
      state.i++;
      const textStart = state.i;
      while (state.i < code.length && code[state.i] !== valueChar) state.i++;
      if (state.i >= code.length) return null;
      attrs.push({ name, kind: 'str', text: code.slice(textStart, state.i), start: nameStart });
      state.i++;
    } else if (valueChar === '{') {
      const container = parseExpressionContainer(state);
      if (container === null) return null;
      /**
       * An EMPTY attribute expression is reported, not emitted. `<div x={}/>` compiled straight to
       * `` html`<div x=${}>` `` — a template literal with a hole containing nothing, which is a
       * syntax error in generated code the author never wrote, with no diagnostic naming the `{}`
       * that caused it. Like a mismatched close it cannot be anything else, so it goes down the same
       * channel. An empty CHILD container stays legal and vanishes, which is what JSX does.
       */
      if (container.text.replace(/\/\*[\s\S]*?\*\//g, '').trim() === '') {
        if (state.mismatch === null)
          state.mismatch = { message: `${name}={} has no value`, at: container.start - 1 };
        return null;
      }
      attrs.push({ name, kind: 'expr', text: container.text, roots: container.roots, start: nameStart, valueStart: container.start });
    } else {
      return null;
    }
  }
};

const parseChildren = (state: ParseState, closingTag: string | null): JsxChild[] | null => {
  const { code } = state;
  const children: JsxChild[] = [];
  let text = '';
  const flushText = () => {
    if (text !== '') children.push({ text });
    text = '';
  };
  while (state.i < code.length) {
    const ch = code[state.i];
    if (ch === '<') {
      if (code[state.i + 1] === '/') {
        flushText();
        state.i += 2;
        if (closingTag === null) {
          if (code[state.i] !== '>') return null;
          state.i++;
          return children;
        }
        let name = '';
        while (state.i < code.length && isNameChar(code[state.i]!)) name += code[state.i++];
        skipWhitespace(state);
        if (name !== closingTag || code[state.i] !== '>') {
          if (name !== closingTag && state.mismatch === null)
            state.mismatch = {
              message: `<${closingTag}> is closed by </${name}>`,
              at: state.i - name.length - 2,
            };
          return null;
        }
        state.i++;
        return children;
      }
      flushText();
      const child = parseJsx(state);
      if (child === null) return null;
      children.push(child);
    } else if (ch === '{') {
      flushText();
      const container = parseExpressionContainer(state);
      if (container === null) return null;
      /** `{/* comment *​/}` and empty containers vanish. */
      const bare = container.text.replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (bare !== '') children.push({ expr: container.text, roots: container.roots, exprStart: container.start });
    } else {
      text += ch;
      state.i++;
    }
  }
  return null; // EOF before the closing tag
};

/** All top-level JSX roots in a source file. */
export const findRoots = (code: string): { roots: JsxRoot[]; mismatch: JsxFault | null } => {
  const roots: JsxRoot[] = [];
  const state = createParseState(code);
  scanCode(state, null, roots);
  return { roots, mismatch: state.mismatch };
};
