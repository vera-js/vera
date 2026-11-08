// The IIFE counter, shared by tests/minifier-iife-sites.test.mjs and the additive rebuild's brick gate (one copy).
import { minify_sync } from 'terser';
import { createRequire } from 'node:module';
/**
 * **Counts functions IMMEDIATELY INVOKED where they are defined** — the terser shape of an inlined single-use function,
 * `((a,b)=>{…})(x,y)`, `(t=>{…})(x)`, `!function(){…}()` — from terser's own parse (below).
 *
 * History, so it is not narrowed back to patterns: a first regex counted wrapped arguments and missed the one-parenthesis
 * form (2026-10-25); its replacement saw only a BLOCK body and a parameter list without `=`, so the hook record's factory
 * (an object-literal body with a default parameter), substituted on every hook creation, read as no site, and the
 * reference core held 12 where its pin said 10. A bracket-matching lexer fixed those and then needed comments, template
 * substitutions and a depth fix, and still missed async arrows (2026-10-27). The parse sees every shape by definition.
 */
/**
 * **The count, from terser's own parse** (2026-10-27): a site is a call whose callee IS a function expression — an arrow
 * or a `function` — or that expression's `.call` / `.apply` (the same closure made and invoked where it stands). No
 * lexing at all: the hand lexer above missed comments, template substitutions, object-literal bodies, default parameters
 * and, found only by this, ASYNC arrows. terser is the tool that creates these sites; its node `TYPE`s are its internals,
 * so the planted controls below are the drift detector (an upgrade that renames a TYPE fails them, never counts 0 quietly).
 */
const isFn = (node) => node?.TYPE === 'Arrow' || node?.TYPE === 'Function';
/** Scope bookkeeping terser hangs on nodes points back up the tree; the walk follows only the syntax. */
const SKIP = new Set(['start', 'end', 'parent_scope', 'variables', 'enclosed', 'thedef', 'scope', 'globals', 'uses_with', 'uses_eval']);
export const iifes = (src) => {
  const { ast } = minify_sync(src, { module: true, compress: false, mangle: false, output: { ast: true, code: false } });
  let n = 0;
  const seen = new Set();
  const stack = [ast];
  while (stack.length) {
    const node = stack.pop();
    if (node === null || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const x of node) stack.push(x);
      continue;
    }
    if (node.TYPE === undefined) continue;
    if (node.TYPE === 'Call') {
      const callee = node.expression;
      if (isFn(callee) || (callee?.TYPE === 'Dot' && (callee.property === 'call' || callee.property === 'apply') && isFn(callee.expression))) n++;
    }
    for (const k in node) if (!SKIP.has(k)) stack.push(node[k]);
  }
  return n;
};
/** The terser this count reads (it arrives through @rollup/plugin-terser), printed beside every count. */
export const terserVersion = createRequire(import.meta.url)('terser/package.json').version;
/** The counter's own control: each planted shape counts exactly once, each look-alike not at all. */
export const CONTROLS = [
  ['((a,b)=>{x()})(1,2);', 1, 'a block body'],
  ['(t=>{x()})(1);', 1, 'one bare parameter'],
  ['((o,k=0)=>({o,k}))(1);', 1, 'an object-literal body and a default parameter'],
  ['(()=>1)();', 1, 'an expression body'],
  ['f((()=>{x()}));', 0, 'a wrapped argument'],
  ['f((a=>a+1),2);', 0, 'a wrapped argument with an expression body'],
  ['s="((x)=>{})(";', 0, 'inside a string'],
  ['r=/((x)=>{})(/;', 0, 'inside a regex literal'],
  ['/* @__PURE__ */f(1),((a)=>{x()})(2);', 1, 'after a kept comment (its closing slash is not a regex)'],
  ['// ((x)=>{})(\n(t=>{x()})(1);', 1, 'a line comment holding the shape'],
  ['h`<b>${(e=>{x()})(1)}</b>`;', 1, 'inside a template substitution (code, so it counts)'],
  ['h`a ((x)=>{})( b`;', 0, 'in a template\'s text'],
  ['((a)=>{((b)=>{y()})(2)})(1);', 2, 'one nested in another'],
  ['h`${(e=>{x()})(1)} and ${f(2)}`,((a)=>{y()})(3);', 2, 'code after a substitution that held a site'],
  ['(async()=>{await x()})();', 1, 'an async arrow'],
  ['((t,n,{js:e,sites:o})=>{x()})(1,2,{});', 1, 'destructured parameters'],
  ['(function(){x()})();', 1, 'a function expression'],
  ['!function(){x()}();', 1, "the unary-prefixed form terser writes in statement position"],
  ['(function(){x()}).call(this);(()=>{x()}).apply(null,[]);', 2, '.call / .apply on a function expression: the same closure made and invoked in place, so they COUNT'],
  ['f(function(){x()});g.call(this);', 0, 'a function passed, and .call on a name'],
];
export const controlsHold = () => CONTROLS.every(([src, want]) => iifes(src) === want);
