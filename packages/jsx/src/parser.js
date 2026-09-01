/**
 * A zero-dependency JSX scanner/parser — the hand-rolled parser the archived wcc `jsx-loader`
 * was kept as a reference for. It is NOT a JavaScript parser: expressions pass through as raw
 * source slices (the emitter's contract since day one), so all this must do is walk JS *lexically*
 * — strings, template literals (with `${}` nesting), comments, and regex literals — to find where
 * JSX begins, and then parse the JSX grammar itself: elements, fragments, attributes
 * (shorthand / "string" / {expression}), spreads, children, and nested expression containers,
 * which recurse back into the lexical walk (so `{x && <a>don't</a>}` cannot desync on the quote).
 *
 * `<` starts JSX only where an expression may start (after `( , = ? : ; [ { ! & | + - * / % ^ ~ <
 * >` or `return`/`yield`/`await`/`case`/`typeof`/`void`/`delete`/`in`/`of`/`new`/`do`/`else`, or
 * at the start) AND the attempt parses; a failed attempt falls back to a literal `<` — so
 * comparisons and TS generics (`Array<number>`, `f<T>(x)`, which follow identifiers) never match.
 */

/** Characters after which a `<` (or `/`) can begin an expression. */
const EXPRESSION_PREFIX = new Set([...'(,=?:;[{!&|+-*/%^~<>', '']);
const EXPRESSION_KEYWORDS = new Set([
  'return', 'yield', 'await', 'case', 'typeof', 'void', 'delete', 'in', 'of',
  'instanceof', 'new', 'do', 'else', 'throw',
]);

const isNameStart = (ch) => /[A-Za-z_$]/.test(ch);

/** The renderer's binding sigils, which may open an attribute name — see `parseJsx`. */
const SIGILS = new Set(['.', '?', '@', '&']);
/**
 * Tag names. The `.` is for a member component (`<Icons.Chevron/>`), and the `-` is for a **custom
 * element** — which on this framework is the tag people write most, and which did not parse at all:
 * `<my-comp/>` read the name as `my`, met the `-` where an attribute or `>` had to be, and gave up.
 * A failed parse is deliberately silent (see `scanCode`), so the JSX was emitted verbatim and the
 * module failed to load with a syntax error pointing at markup nobody thought was in doubt.
 */
const isNameChar = (ch) => /[\w$.-]/.test(ch);
const isAttrNameChar = (ch) => /[\w$:-]/.test(ch);

export class ParseState {
  constructor(code, from = 0) {
    this.code = code;
    this.i = from;
    /** The last significant character / word seen, for the expression-position heuristic. */
    this.lastChar = '';
    this.lastWord = '';
    /**
     * A closing tag that names a different element than the one it closes, if one was seen.
     *
     * Every other parse failure returns `null` and leaves the source alone, and it has to: `<` is
     * ambiguous, and `a < b` must fall through untouched rather than be called broken JSX. **A
     * `</name>` that does not match the tag it closes is the one failure that cannot be anything
     * else** — reaching it means a whole open tag and its children were already consumed — so it is
     * the one that can be reported instead of shrugged at.
     */
    this.mismatch = null;
  }
  atExpressionPosition() {
    if (this.lastChar === '' || EXPRESSION_PREFIX.has(this.lastChar)) return true;
    return EXPRESSION_KEYWORDS.has(this.lastWord);
  }
}

/**
 * Walks JS code from `state.i` until `stop(state)` says done (or EOF), collecting every JSX root
 * found at expression positions into `roots` as `{ start, end, node }`. Handles strings,
 * template literals (recursing into `${}`), comments, and regex literals.
 */
export const scanCode = (state, stop, roots) => {
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
      while (state.i < code.length && !(code[state.i] === '*' && code[state.i + 1] === '/')) state.i++;
      state.i += 2;
    } else if (ch === '/' && state.atExpressionPosition()) {
      skipRegex(state);
    } else if (ch === '<' && /[A-Za-z_$>]/.test(code[state.i + 1] ?? '') && state.atExpressionPosition()) {
      const start = state.i;
      const node = parseJsx(state);
      if (node !== null) {
        roots.push({ start, end: state.i, node });
        state.lastChar = ')'; // a JSX root is an expression
        state.lastWord = '';
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
      state.lastChar = '<';
      state.lastWord = '';
    } else {
      if (!/\s/.test(ch)) {
        if (/[\w$]/.test(ch)) {
          state.lastWord = /[\w$]/.test(state.lastChar) ? state.lastWord + ch : ch;
        } else {
          state.lastWord = '';
        }
        state.lastChar = ch;
      }
      state.i++;
    }
  }
};

const skipString = (state, quote) => {
  const { code } = state;
  state.i++;
  while (state.i < code.length && code[state.i] !== quote) {
    if (code[state.i] === '\\') state.i++;
    state.i++;
  }
  state.i++;
  state.lastChar = quote;
  state.lastWord = '';
};

const skipTemplate = (state, roots) => {
  const { code } = state;
  state.i++;
  while (state.i < code.length && code[state.i] !== '`') {
    if (code[state.i] === '\\') {
      state.i += 2;
    } else if (code[state.i] === '$' && code[state.i + 1] === '{') {
      state.i += 2;
      state.lastChar = '{';
      state.lastWord = '';
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
  state.lastChar = '`';
  state.lastWord = '';
};

const skipRegex = (state) => {
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
  state.lastChar = '/';
  state.lastWord = '';
};

/**
 * Consumes a balanced `{expression}` (state.i AT the opening brace), returning the inner source
 * and any JSX roots found inside. Delegates to `scanCode`, so nested JSX, strings, templates,
 * regexes and comments are all safe.
 */
const parseExpressionContainer = (state) => {
  const { code } = state;
  state.i++; // {
  const start = state.i;
  state.lastChar = '{';
  state.lastWord = '';
  const roots = [];
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

const skipWhitespace = (state) => {
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
export const parseJsx = (state) => {
  const { code } = state;
  const start = state.i;
  state.i++; // <

  if (code[state.i] === '>') {
    state.i++;
    const children = parseChildren(state, null);
    if (children === null) return null;
    return { fragment: true, children, start };
  }

  if (!isNameStart(code[state.i])) return null;
  let tag = '';
  while (state.i < code.length && isNameChar(code[state.i])) tag += code[state.i++];

  const attrs = [];
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
      const dots = container.text.match(/^\s*\.\.\./)[0].length;
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
    let name = SIGILS.has(ch) ? code[state.i++] : '';
    while (state.i < code.length && isAttrNameChar(code[state.i])) name += code[state.i++];
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
      attrs.push({ name, kind: 'expr', text: container.text, roots: container.roots, start: nameStart, valueStart: container.start });
    } else {
      return null;
    }
  }
};

const parseChildren = (state, closingTag) => {
  const { code } = state;
  const children = [];
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
        while (state.i < code.length && isNameChar(code[state.i])) name += code[state.i++];
        skipWhitespace(state);
        if (name !== closingTag || code[state.i] !== '>') {
          if (name !== closingTag && state.mismatch === null)
            state.mismatch = { expected: closingTag, found: name, at: state.i - name.length - 2 };
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
export const findRoots = (code) => {
  const roots = [];
  const state = new ParseState(code);
  scanCode(state, null, roots);
  return { roots, mismatch: state.mismatch };
};
