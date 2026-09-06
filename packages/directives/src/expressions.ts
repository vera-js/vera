/**
 * The expression tier — DESIGN-DIRECTIVES §5, as refined by §19.2. A STANDALONE ADDITIVE ENTRY:
 * this file imports nothing from the engine at runtime (type imports erase), and reaches it only
 * through the connector `wireDirectives` hands seams to — the renderer's additive-entry rule, so
 * the CDN two-bundle case cannot create a second engine.
 *
 * The grammar: literals · paths (`a.b`, `@page`, `!x`) · STRICT equality (`==`/`!=` carry
 * ===-semantics — state is typed data, there is no loose mode) · comparisons · `&&`/`||` · unary
 * `!`/`-` · arithmetic `+ - * / %` · ternary · parentheses · array and object literals (objects
 * null-prototyped) · calls into PURE_FUNCTIONS only. Calm math is the contract: an unknown key
 * reads `undefined`, arithmetic on it yields NaN, division by zero yields Infinity — never a
 * throw at evaluation time.
 *
 * THUNK-COMPILED, not interpreted per run: parse once into a tree of tiny closures, cached by
 * source string. CSP-safe (no Function, no eval), deterministic (the PURE set holds no clock and
 * no randomness), and the tokenizer is hand-rolled and linear — no regex ever touches author
 * input, so the ReDoS class is structurally absent.
 *
 * The base grammar in `./parse.js` is this file's LITTLE TWIN — same key tokens, same object
 * shape (values here may be `{ kind: 'expr', thunk }` nodes the engine's evaluate hands back to
 * `evalExpr`). Change one grammar's surface and visit the other.
 */
import type { Parsed, ParsedObject } from './parse.js';
import type { EngineConnector } from './engine.js';

type Read = (segments: string[], global: boolean) => unknown;
type Thunk = (read: Read) => unknown;
type ExprNode = { kind: 'expr'; thunk: Thunk; src: string };

const fail = (code: string, at: number, message: string): never => {
  throw Object.assign(new Error(message), { code, at });
};

/**
 * The deterministic pure set — v1 keeps it small and boring on purpose: same page, same state,
 * same result is an agent-facing promise, so no clock, no randomness, no locale.
 */
const PURE: Record<string, (...args: unknown[]) => unknown> = {
  abs: (n) => Math.abs(Number(n)),
  min: (...ns) => Math.min(...ns.map(Number)),
  max: (...ns) => Math.max(...ns.map(Number)),
  round: (n) => Math.round(Number(n)),
  floor: (n) => Math.floor(Number(n)),
  ceil: (n) => Math.ceil(Number(n)),
  len: (v) => (typeof v === 'string' || Array.isArray(v) ? v.length : NaN),
  upper: (v) => String(v ?? '').toUpperCase(),
  lower: (v) => String(v ?? '').toLowerCase(),
};

/**
 * The dangerous-name denylist, parse-time — one answer with the renderer/spread matrix. The
 * engine's own-property read already refuses the prototype chain; this refuses the SPELLING, so a
 * hostile path never even compiles.
 */
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

const SOURCE_MAX = 4096;
const DEPTH_MAX = 24;

const isIdStart = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$';
const isId = (c: string) => isIdStart(c) || (c >= '0' && c <= '9') || c === '-';
const isDigit = (c: string) => c >= '0' && c <= '9';

const compile = (source: string, from = 0, stopAt: string | null = null): { thunk: Thunk; end: number } => {
  let i = from;
  const done = () => i >= source.length;
  const ws = () => {
    while (!done() && (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r')) i++;
  };
  const peek = () => source[i];
  const eat = (text: string) => {
    if (source.startsWith(text, i)) {
      i += text.length;
      return true;
    }
    return false;
  };

  const primary = (depth: number): Thunk => {
    if (depth > DEPTH_MAX) fail('expr-too-deep', i, `nesting deeper than ${DEPTH_MAX}`);
    ws();
    if (done()) fail('expr-empty', i, 'expected a value');
    const c = peek();
    if (eat('(')) {
      const inner = ternary(depth + 1);
      ws();
      if (!eat(')')) fail('expr-unclosed-paren', i, 'expected ")"');
      return inner;
    }
    if (eat('!')) {
      const operand = primary(depth + 1);
      return (read) => !operand(read);
    }
    if (c === '-' && !isDigit(source[i + 1])) {
      i++;
      const operand = primary(depth + 1);
      return (read) => -Number(operand(read));
    }
    if (c === "'" || c === '"') {
      i++;
      const start = i;
      while (!done() && peek() !== c) i++;
      if (done()) fail('string-unterminated', start, 'unterminated string');
      const text = source.slice(start, i);
      i++;
      return () => text;
    }
    if (c === '-' || isDigit(c)) {
      const start = i;
      if (c === '-') i++;
      while (!done() && isDigit(peek())) i++;
      if (peek() === '.') {
        i++;
        while (!done() && isDigit(peek())) i++;
      }
      const n = Number(source.slice(start, i));
      if (!Number.isFinite(n)) fail('number-bad', start, 'not a number');
      return () => n;
    }
    if (eat('[')) {
      const items: Thunk[] = [];
      ws();
      if (!eat(']'))
        for (;;) {
          items.push(ternary(depth + 1));
          ws();
          if (eat(',')) continue;
          if (eat(']')) break;
          fail('array-unterminated', i, 'expected "," or "]"');
        }
      return (read) => items.map((t) => t(read));
    }
    if (eat('{')) {
      const entries: Array<[string, Thunk]> = [];
      ws();
      if (!eat('}'))
        for (;;) {
          ws();
          const start = i;
          if (source[i] === "'" || source[i] === '"') {
            const q = source[i];
            i++;
            while (!done() && peek() !== q) i++;
            i++;
          } else while (!done() && (isId(peek()) || peek() === '.' || peek() === '@')) i++;
          const key = source.slice(start, i).replace(/^['"]|['"]$/g, '');
          if (!key) fail('object-bad-key', start, 'expected a key');
          if (FORBIDDEN.has(key)) fail('name-forbidden', start, `"${key}" is not a legal key`);
          ws();
          if (!eat(':')) fail('object-missing-colon', i, `expected ":" after "${key}"`);
          entries.push([key, ternary(depth + 1)]);
          ws();
          if (eat(',')) continue;
          if (eat('}')) break;
          fail('object-unterminated', i, 'expected "," or "}"');
        }
      return (read) => {
        const out: Record<string, unknown> = Object.create(null);
        for (const [k, t] of entries) out[k] = t(read);
        return out;
      };
    }
    if (c === '@' || isIdStart(c)) {
      const global = eat('@');
      const start = i;
      while (!done() && (isId(peek()) || peek() === '.')) i++;
      const word = source.slice(start, i);
      if (!word) fail('path-bad', start, 'expected a name');
      if (!global) {
        if (word === 'true') return () => true;
        if (word === 'false') return () => false;
        if (word === 'null') return () => null;
      }
      ws();
      /** A call — PURE functions only, with the names listed when one is unknown. */
      if (!global && peek() === '(' && !word.includes('.')) {
        const fn = PURE[word];
        if (!fn)
          fail('unknown-function', start, `"${word}" is not a pure function here. Available: ${Object.keys(PURE).join(', ')}.`);
        i++;
        const args: Thunk[] = [];
        ws();
        if (!eat(')'))
          for (;;) {
            args.push(ternary(depth + 1));
            ws();
            if (eat(',')) continue;
            if (eat(')')) break;
            fail('call-unterminated', i, 'expected "," or ")"');
          }
        return (read) => fn(...args.map((t) => t(read)));
      }
      const segments = word.split('.');
      for (const seg of segments)
        if (FORBIDDEN.has(seg)) fail('name-forbidden', start, `"${seg}" is not a legal path segment`);
      return (read) => read(segments, global);
    }
    return fail('expr-unexpected', i, `unexpected "${c}"`);
  };

  const binary = (depth: number, min: number): Thunk => {
    let left = primary(depth);
    for (;;) {
      ws();
      /** `===`/`!==` get a TEACHING refusal — `==` already carries strict semantics here, and one
       *  spelling per meaning is the grammar's whole promise (the vocabulary is agent-facing). */
      if (source.startsWith('===', i) || source.startsWith('!==', i))
        fail('strict-spelling', i, `"${source.slice(i, i + 3)}" is not needed — == and != are already strict here`);
      const op =
        eat('==') ? '==' : eat('!=') ? '!=' : eat('<=') ? '<=' : eat('>=') ? '>=' :
        peek() === '<' ? (i++, '<') : (peek() === '>' && stopAt !== '>') ? (i++, '>') :
        eat('&&') ? '&&' : eat('||') ? '||' :
        eat('+') ? '+' : (peek() === '-' && source[i + 1] !== '-') ? (i++, '-') :
        eat('*') ? '*' : (peek() === '/' ? (i++, '/') : eat('%') ? '%' : null);
      if (op === null) return left;
      const prec = op === '||' ? 1 : op === '&&' ? 2 : op === '==' || op === '!=' ? 3 :
        op === '<' || op === '<=' || op === '>' || op === '>=' ? 4 :
        op === '+' || op === '-' ? 5 : 6;
      if (prec < min) {
        /** Not ours at this level — back the cursor up and let the caller take it. */
        i -= op.length;
        return left;
      }
      const right = binary(depth + 1, prec + 1);
      const l = left;
      left =
        op === '||' ? (r) => l(r) || right(r)
        : op === '&&' ? (r) => l(r) && right(r)
        : op === '==' ? (r) => l(r) === right(r)
        : op === '!=' ? (r) => l(r) !== right(r)
        : op === '<' ? (r) => (l(r) as number) < (right(r) as number)
        : op === '<=' ? (r) => (l(r) as number) <= (right(r) as number)
        : op === '>' ? (r) => (l(r) as number) > (right(r) as number)
        : op === '>=' ? (r) => (l(r) as number) >= (right(r) as number)
        : op === '+' ? (r) => (l(r) as number) + (right(r) as number)
        : op === '-' ? (r) => (l(r) as number) - (right(r) as number)
        : op === '*' ? (r) => (l(r) as number) * (right(r) as number)
        : op === '/' ? (r) => (l(r) as number) / (right(r) as number)
        : (r) => (l(r) as number) % (right(r) as number);
    }
  };

  const ternary = (depth: number): Thunk => {
    const cond = binary(depth, 0);
    ws();
    if (!eat('?')) return cond;
    const then = ternary(depth + 1);
    ws();
    if (!eat(':')) fail('ternary-missing-colon', i, 'expected ":"');
    const other = ternary(depth + 1);
    return (read) => (cond(read) ? then(read) : other(read));
  };

  const thunk = ternary(0);
  ws();
  if (stopAt === null && i < source.length) fail('expr-trailing', i, `unexpected "${source[i]}"`);
  return { thunk, end: i };
};

/* ── the attribute-value parser (superset of ./parse.js — objects same shape, values richer) ── */

const cache = new Map<string, Parsed>();
const CACHE_MAX = 2000;

const exprNode = (source: string, from: number, stopAt: string | null): { node: Parsed; end: number } => {
  const { thunk, end } = compile(source, from, stopAt);
  const src = source.slice(from, end).trim();
  return { node: { kind: 'expr', thunk, src } as unknown as Parsed, end };
};

const parseTier = (source: string): Parsed => {
  const hit = cache.get(source);
  if (hit !== undefined) return hit;
  if (source.length > SOURCE_MAX) fail('value-too-long', 0, `value is ${source.length} chars; the cap is ${SOURCE_MAX}`);
  let out: Parsed;
  let i = 0;
  while (source[i] === ' ' || source[i] === '\t' || source[i] === '\n') i++;
  if (source[i] === '{') out = parseObject(source, i).node;
  else out = exprNode(source, 0, null).node;
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(source, out);
  return out;
};

/** The braced object: keys are tokens (same rules as the base grammar), values are EXPRESSIONS. */
const parseObject = (source: string, from: number): { node: ParsedObject; end: number } => {
  let i = from + 1; // {
  const out: ParsedObject = Object.create(null);
  const ws = () => {
    while (i < source.length && (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r')) i++;
  };
  ws();
  if (source[i] === '}') return { node: out, end: i + 1 };
  for (;;) {
    ws();
    const start = i;
    if (source[i] === '@') i++;
    if (isDigit(source[i])) while (i < source.length && isDigit(source[i])) i++;
    else if (isIdStart(source[i])) while (i < source.length && (isId(source[i]) || source[i] === '.')) i++;
    const key = source.slice(start, i);
    if (!key || key === '@') fail('object-bad-key', start, 'expected a key');
    ws();
    if (source[i] !== ':') fail('object-missing-colon', i, `expected ":" after "${key}"`);
    i++;
    ws();
    let v: { node: Parsed; end: number };
    if (source[i] === '{') v = parseObject(source, i);
    else v = exprNode(source, i, '}');
    if (key in out) fail('object-duplicate-key', i, `"${key}" appears twice`);
    out[key] = v.node;
    i = v.end;
    ws();
    if (source[i] === ',') {
      i++;
      continue;
    }
    if (source[i] === '}') return { node: out, end: i + 1 };
    fail('object-unterminated', i, 'expected "," or "}"');
  }
};

/* ── the connector ────────────────────────────────────────────────────────────────────────── */

/** `wireDirectives([expressions])` — the tier installs through the engine's seams. */
export const expressions: EngineConnector = (seams) => {
  seams.setParse(parseTier);
  seams.setEvalExpr((node, read) => (node as ExprNode).thunk(read));
};

/** Exported for the corpus and for anyone building tooling on the grammar. */
export const compileExpression = (source: string): ((read: Read) => unknown) => compile(source, 0, null).thunk;
