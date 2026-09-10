/**
 * The phase-1 value grammar: LITERALS, PATHS (`open`, `user.name`, `@count`, `!path`), and the
 * braced OBJECT (`{ key: value, ... }`, nesting allowed). This is deliberately the pre-expression
 * subset — the design doc's tiering means `show="open"` and `on-click="{ open: !open }"` work with
 * no evaluator loaded; the full expression tier (phase 2) extends evaluation behind the same seam
 * without touching callers.
 *
 * Hand-rolled and linear (the literals.ts discipline): no regex ever touches author input, so the
 * ReDoS class is structurally absent. Parsed objects get NULL PROTOTYPES — the grammar guarantees
 * no getters and no references (literals only, cycles impossible), and null-proto closes the last
 * inherited-name hole to match the renderer's dangerous-name matrix by construction.
 *
 * Functional throughout (the house rule): the scanner is a closure over an index, and a parse
 * failure is an ordinary Error carrying `code`/`at` as assigned properties — the same shape
 * `@verajs/autoloader` gives its refusals, not a subclass.
 */

export type ValueError = Error & { code: string; at: number };

const fail = (code: string, at: number, message: string): never => {
  throw Object.assign(new Error(message), { code, at });
};

export type Path = { kind: 'path'; negate: boolean; global: boolean; segments: string[] };
export type Parsed = string | number | boolean | null | Path | ParsedObject | Parsed[];
export type ParsedObject = { [key: string]: Parsed };

/**
 * One cache for every attribute string on the page. CMS lists repeat identical attribute text
 * across hundreds of rows; this turns per-row parsing into a Map hit. Bounded rather than weak —
 * keys are strings — with a cheap reset at a size no real page reaches by accident.
 */
const cache = new Map<string, Parsed>();
const CACHE_MAX = 2000;

/**
 * Sized for the biggest legitimate value: a motion object carries EVERY property's keyframes,
 * bands included, in one attribute — the budget one `data-vm-*` attribute used to have, times
 * the element. The parser is linear and the cache is entry-bounded, so the cost of headroom is
 * nothing; the cap exists so a hostile attribute cannot make the page hold megabytes, not to
 * ration authors.
 */
const SOURCE_MAX = 16384;
const DEPTH_MAX = 8;

const isIdStart = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$';
const isId = (c: string) => isIdStart(c) || (c >= '0' && c <= '9') || c === '-';

/**
 * Whether a `-` at `at` begins a CSS CUSTOM PROPERTY rather than a negative number.
 *
 * Exported because the expressions tier parses objects too, and this rule lived in three places
 * once — the base grammar and both of the tier's key readers. `data-vd-style="{ --x: p.x }"` was
 * refused by whichever copy was in force, while `style`'s own contract said custom properties were
 * supported; fixing one copy fixed the base tier and left the page (which wires expressions)
 * refusing exactly as before. One rule, one address.
 */
export const startsCustomProperty = (source: string, at: number): boolean =>
  source[at] === '-' && (source[at + 1] === '-' || source[at + 1] === '_' || isIdStart(source[at + 1] ?? ''));
const isDigit = (c: string) => c >= '0' && c <= '9';

/** Parse one attribute value. Throws a `ValueError`-shaped Error; callers convert to rejections. */
export const parseValue = (source: string): Parsed => {
  const hit = cache.get(source);
  if (hit !== undefined) return hit;
  if (source.length > SOURCE_MAX) fail('value-too-long', 0, `value is ${source.length} chars; the cap is ${SOURCE_MAX}`);

  let i = 0;
  const done = () => i >= source.length;
  const ws = () => {
    while (!done()) {
      const c = source[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') i++;
      else break;
    }
  };

  /**
   * Keys are TOKENS the directive interprets: names, dotted paths, `@names`, bare numbers — and
   * **CSS custom properties**, which could not be written at all.
   *
   * `data-vd-style`'s own contract says "custom properties included", and `{ --x: p.x }` was
   * refused by the grammar before the directive ever saw it: a key could CONTAIN a hyphen
   * (`background-color`) but not begin with one. A documented capability with no spelling.
   *
   * The leading hyphen is admitted only when a letter, `_` or a second hyphen follows, so `--x` and
   * `-webkit-thing` read as names while `-5` stays a number and cannot be mistaken for one.
   */
  const key = (): string => {
    const start = i;
    if (source[i] === '@') i++;
    if (startsCustomProperty(source, i)) {
      i++;
      while (!done() && isId(source[i])) i++;
    } else if (isDigit(source[i])) {
      while (!done() && isDigit(source[i])) i++;
    } else if (isIdStart(source[i])) {
      while (!done() && (isId(source[i]) || source[i] === '.')) i++;
    }
    if (i === start || (i === start + 1 && source[start] === '@')) fail('object-bad-key', start, 'expected a key');
    return source.slice(start, i);
  };

  const string = (quote: string): string => {
    i++;
    const start = i;
    while (!done() && source[i] !== quote) i++;
    if (done()) fail('string-unterminated', start, 'unterminated string');
    const out = source.slice(start, i);
    i++;
    return out;
  };

  const number = (): number => {
    const start = i;
    if (source[i] === '-') i++;
    while (!done() && isDigit(source[i])) i++;
    if (source[i] === '.') {
      i++;
      while (!done() && isDigit(source[i])) i++;
    }
    const out = Number(source.slice(start, i));
    if (!Number.isFinite(out)) fail('number-bad', start, 'not a number');
    return out;
  };

  const pathOrKeyword = (): Parsed => {
    let negate = false;
    while (source[i] === '!') {
      negate = !negate;
      i++;
      ws();
    }
    const global = source[i] === '@';
    if (global) i++;
    const start = i;
    if (!isIdStart(source[i])) fail('path-bad', i, 'expected a name');
    while (!done() && (isId(source[i]) || source[i] === '.')) i++;
    const word = source.slice(start, i);
    if (!negate && !global) {
      if (word === 'true') return true;
      if (word === 'false') return false;
      if (word === 'null') return null;
    }
    return { kind: 'path', negate, global, segments: word.split('.') };
  };

  const object = (depth: number): ParsedObject => {
    i++; // {
    /** Null prototype — see the header. */
    const out: ParsedObject = Object.create(null);
    ws();
    if (source[i] === '}') {
      i++;
      return out;
    }
    for (;;) {
      ws();
      const k = key();
      ws();
      if (source[i] !== ':') fail('object-missing-colon', i, `expected ":" after "${k}"`);
      i++;
      const v = value(depth + 1);
      if (k in out) fail('object-duplicate-key', i, `"${k}" appears twice`);
      out[k] = v;
      ws();
      const c = source[i];
      if (c === ',') {
        i++;
        continue;
      }
      if (c === '}') {
        i++;
        return out;
      }
      fail('object-unterminated', i, 'expected "," or "}"');
    }
  };

  /**
   * An array of LITERALS — `[]`, `['css', 'js']`, `[1, 2]`. The shape multi-select needs: a seed
   * DECLARES an array key (so the URL and a checkbox group know what shape to restore into) and
   * may pre-select. Deliberately literals only, no paths and no nesting — an array here is data,
   * never expression, and keeping it that way is what keeps it small.
   */
  const array = (): Parsed[] => {
    i++; // [
    const out: Parsed[] = [];
    ws();
    if (source[i] === ']') {
      i++;
      return out;
    }
    for (;;) {
      ws();
      const c = source[i];
      let entry: Parsed;
      if (c === "'" || c === '"') entry = string(c);
      else if (c === '-' || isDigit(c)) entry = number();
      else return fail('array-not-literal', i, 'arrays hold quoted strings and numbers only');
      out.push(entry);
      ws();
      const t = source[i];
      if (t === ',') {
        i++;
        continue;
      }
      if (t === ']') {
        i++;
        return out;
      }
      fail('array-unterminated', i, 'expected "," or "]"');
    }
  };

  const value = (depth: number): Parsed => {
    if (depth > DEPTH_MAX) fail('value-too-deep', i, `nesting deeper than ${DEPTH_MAX}`);
    ws();
    if (done()) fail('value-empty', i, 'expected a value');
    const c = source[i];
    if (c === '{') return object(depth);
    if (c === '[') return array();
    if (c === "'" || c === '"') return string(c);
    if (c === '-' || isDigit(c)) return number();
    if (c === '!' || c === '@' || isIdStart(c)) return pathOrKeyword();
    return fail('value-unexpected', i, `unexpected "${c}"`);
  };

  const out = value(0);
  ws();
  if (!done()) fail('value-trailing', i, `unexpected "${source[i]}" after the value`);
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(source, out);
  return out;
};

/**
 * The LITERAL class parser — used for `value: 'literal'` directives directly, in BOTH tiers, so a
 * bare word is a string and never a path to resolve: `sync="draft"` names the key, it does not
 * read it. Numbers and the three keywords parse; everything else is the trimmed text itself.
 */
export const parseLiteral = (source: string): string | number | boolean | null => {
  const text = source.trim();
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  /** Hand-rolled numeric shape (the file's no-regex rule): -?digits(.digits)? and nothing else. */
  const j = text[0] === '-' ? 1 : 0;
  const digitsFrom = (k: number) => {
    const start = k;
    while (k < text.length && text[k] >= '0' && text[k] <= '9') k++;
    return k > start ? k : -1;
  };
  let k = digitsFrom(j);
  if (k !== -1) {
    if (k < text.length && text[k] === '.') k = digitsFrom(k + 1);
    if (k === text.length) return Number(text);
  }
  if (text.length >= 2 && ((text[0] === "'" && text.endsWith("'")) || (text[0] === '"' && text.endsWith('"'))))
    return text.slice(1, -1);
  return text;
};

export const isPath = (v: Parsed): v is Path =>
  typeof v === 'object' && v !== null && (v as Path).kind === 'path';

/**
 * A braced OBJECT LITERAL — not merely "a JavaScript object".
 *
 * **Any node with a `kind` is a parser node, not data**, and testing only for `'path'` was a bug
 * that arrived with the second kind: once the expressions tier existed, `data-vd-state="oops"`
 * parsed to `{ kind: 'expr', src: 'oops' }`, which is an object by every check here — so the
 * refusal never fired and the element's state silently BECAME the parser's internal node, keys and
 * all. Every object-valued directive shared it: `data-vd-class="oops"` would have gone looking for
 * classes named `kind` and `src`.
 *
 * Written against the presence of `kind` rather than a list of kinds, so a third node type cannot
 * reopen it the way the second one did.
 */
export const isObject = (v: Parsed): v is ParsedObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v) &&
  (v as { kind?: string }).kind === undefined;


/**
 * **Did this value CHANGE?** — one notion, shared by the two places that ask.
 *
 * The server's fixed-point walk asks it to decide whether a pass wrote anything, and `watch` asks
 * it to decide whether a key moved. They must agree, and they were about to disagree: `watch`
 * compared with `Object.is`, so watching a key that holds an object — `counts`, `@route` — fired on
 * every republish of an equal value, because the writer builds a fresh object each time.
 *
 * Identity first, then structure, bounded by depth. The cap is what makes a cyclic or absurdly deep
 * value cost a comparison rather than a stack, and past it the answer is "changed", which is the
 * safe direction: an unnecessary run, never a missed one.
 */
export const sameValue = (a: unknown, b: unknown, depth = 0): boolean => {
  if (Object.is(a, b)) return true;
  if (depth > 4 || typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  return ak.length === bk.length
    && ak.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], depth + 1));
};
