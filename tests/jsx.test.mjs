/**
 * @verajs/jsx: transform assertions plus EXECUTION — transformed output runs against the real
 * renderer build in jsdom, proving the emitted templates hit the same engine paths (identity,
 * keyed reconciliation, events) as hand-written ones.
 */
import { load } from './dist.mjs';
import { transformJsx } from '../packages/jsx/src/index.js';
import { JSDOM } from 'jsdom';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dom = new JSDOM('<div id="root"></div>');
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
const { render, keyed } = await load('renderer');
const html = (strings, ...values) => ({ strings, values });

const dir = mkdtempSync(join(tmpdir(), 'vera-jsx-'));
let n = 0;
/** Compile a snippet with injection off, provide html/keyed locally, import it as a module. */
const compile = async (code) => {
  const js = transformJsx(code, `snip${n}.jsx`, { inject: false });
  const file = join(dir, `snip${n++}.mjs`);
  writeFileSync(file, js);
  const mod = await import(pathToFileURL(file).href + `?html`);
  return mod;
};
globalThis.__vera = { html, keyed };
const PRELUDE = 'const { html, keyed } = globalThis.__vera;\n';

// ── 1. the full mapping matrix, structurally ──
const emitted = transformJsx(`
const view = (s) => (
  <form className="a" htmlFor-x="ignored">
    <label htmlFor="f">L</label>
    <input value={s.v} defaultValue="dv" checked={s.c} defaultChecked disabled={s.d} onChange={s.f} />
    <div dangerouslySetInnerHTML={{ __html: s.trusted }} />
    <span ref={s.r} hidden />
  </form>
);`, 't.jsx', { inject: false });
for (const expected of ['class="a"', ' for="f"', '.value=${s.v}', 'value="dv"', '.checked=${s.c}',
  'checked', '?disabled=${s.d}', '@change=${s.f}', '.innerHTML=${s.trusted}', ' ${s.r}', 'hidden />']) {
  assert.ok(emitted.includes(expected), `mapping emits ${expected}`);
}
assert.ok(!emitted.includes('defaultValue') && !emitted.includes('dangerously'), 'react names fully translated');

// ── 2. behavior: events, keyed identity, conditionals — through the real engine ──
const mod = await compile(PRELUDE + `
export const app = (s) => (
  <section>
    <button onClick={s.bump}>n={s.n}</button>
    <ul>{s.items.map((item) => <li key={item.id}>{item.label}</li>)}</ul>
    {s.flag && <em>on</em>}
  </section>
);`);
const container = dom.window.document.getElementById('root');
let clicks = 0;
const state = { bump: () => clicks++, n: 1, flag: false,
  items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] };
render(mod.app(state), container);
container.querySelector('button').dispatchEvent(new dom.window.Event('click'));
assert.equal(clicks, 1, 'onClick wired through @click');
assert.equal(container.querySelector('em'), null, 'false conditional renders nothing');

const liB = container.querySelectorAll('li')[1];
state.items = [state.items[1], state.items[0]];
state.flag = true;
render(mod.app(state), container);
assert.equal(container.querySelectorAll('li')[0], liB, 'key -> keyed(): reorder MOVED the node');
assert.equal(container.querySelector('em').textContent, 'on', 'conditional toggled in');
const before = container.querySelector('section');
render(mod.app(state), container);
assert.equal(container.querySelector('section'), before, 'template identity stable across calls');

// ── 3. components: call convention, spread, children ──
const comp = await compile(PRELUDE + `
const Chip = ({ tone, children }) => <b class={'chip ' + tone}>{children}</b>;
export const page = (s) => <div><Chip tone="warm" {...s.extra}>hi {s.who}</Chip></div>;`);
render(comp.page({ who: 'you', extra: {} }), container);
assert.equal(container.querySelector('b').textContent, 'hi you', 'component call + children flatten');
assert.ok(container.querySelector('b').className.includes('warm'), 'props pass through');

// ── 4. fragments = multi-root; text collapsing; template-literal escaping ──
const frag = await compile(PRELUDE + `export const t = (s) => <>
  <i>one</i>
  <i>{'\`'}{s.x} costs \${9}</i>
</>;`);
render(frag.t({ x: 'tick' }), container);
const italics = container.querySelectorAll('i');
assert.equal(italics.length, 2, 'fragment renders multi-root');
assert.equal(italics[1].textContent, '`tick costs $9', 'backticks and dollar-brace survive');

// ── 5. helpful compile errors ──
assert.throws(() => transformJsx('const a = <ul><li key={1}>x</li></ul>;', 'e.jsx'), /key belongs on the JSX root/);
assert.throws(() => transformJsx('const a = <div style={{ color: c }} />;', 'e.jsx'), /style expects a STRING/);

// ── 6. auto-imports ──
const injected = transformJsx('export const v = () => <p>{x.map((i) => <b key={i}>{i}</b>)}</p>;', 'i.jsx');
assert.ok(injected.startsWith("import { html } from '@verajs/core';\nimport { keyed } from '@verajs/renderer';"),
  'auto-imports injected when missing');
const notDoubled = transformJsx("import { html } from '@verajs/core';\nexport const v = () => <p>x</p>;", 'i2.jsx');
assert.equal((notDoubled.match(/@verajs\/core/g) ?? []).length, 1, 'existing import not doubled');

// ── 7. TSX: type syntax passes through untouched for the downstream stripper ──
const tsx = transformJsx('export const v = (s: State) => <p>{(s.n as number) + 1}</p>;', 'v.tsx', { inject: false });
assert.ok(tsx.includes('(s.n as number) + 1') && tsx.includes('(s: State)'), 'TS syntax preserved');

rmSync(dir, { recursive: true, force: true });
console.log('jsx ok — mapping, engine behavior, components, fragments, errors, imports, tsx');

// ── parser edges: the lexer traps a hand-rolled scanner must survive ──
const T = (code) => transformJsx(code, 'edge.jsx', { inject: false });

// apostrophes/quotes inside JSX text must not desync expression scanning
assert.ok(T(`const v = <p>{x && <b>don't "quote" me</b>}</p>;`).includes(`don't "quote" me`), 'quotes in JSX text');
// regex literal containing a quote before JSX
assert.ok(T(`const re = /"'/; const v = <i>ok</i>;`).includes('html`<i>ok</i>`'), 'regex with quotes skipped');
// division is not a regex; comparison is not JSX
assert.equal(T('const a = x / 2 < y && b < c;'), 'const a = x / 2 < y && b < c;', 'comparisons untouched');
// TS generics after identifiers are untouched
assert.equal(T('const a: Array<number> = f<T>(x);'), 'const a: Array<number> = f<T>(x);', 'generics untouched');
// template literal with ${} nesting AND JSX inside the interpolation
assert.ok(T('const s = `a ${cond ? <b>x</b> : null} z`;').includes('${cond ? html`<b>x</b>` : null}'), 'JSX inside template interpolation');
// comments containing tags are not JSX
assert.equal(T('// <div>no</div>\nconst a = 1; /* <b>no</b> */'), '// <div>no</div>\nconst a = 1; /* <b>no</b> */', 'comments untouched');
// JSX comment containers vanish; nested braces in attr expressions balance
assert.ok(T('const v = <p title={fn({ a: { b: 1 } })}>{/* note */}x</p>;').includes('title=${fn({ a: { b: 1 } })}'), 'nested braces + jsx comment');
// arrow returning JSX after => (the ">" prefix case)
assert.ok(T('const f = () => <li>row</li>;').includes('html`<li>row</li>`'), 'JSX directly after arrow');
// attribute string with an unpaired quote of the other kind
assert.ok(T(`const v = <a title="it's fine">t</a>;`).includes(`title="it's fine"`), 'apostrophe in attr string');

console.log('parser edges ok');

// ── spread on elements ────────────────────────────────────────────────────────────────────────
//
// `{...props}` used to be a compile error, on the grounds that the template language had no spread
// part. It has one now — an expression in element position, resolved at runtime by
// `@verajs/renderer/spread` — so JSX emits the same thing a hand-written template would.
{
  const out = T('const v = <div {...props} class="base">hi</div>;');
  assert.ok(out.includes('html`<div ${spread(props)} class="base">hi</div>`'),
    'spread emits an element-position expression, written attributes intact');
  /** `T` disables injection so the edge tests compare bare output; these need it on. */
  const injected = (code) => transformJsx(code, 'spread.jsx');
  assert.ok(injected('const v = <div {...props} />;').includes("import { spread } from '@verajs/renderer/spread';"),
    'the import is injected, like html and keyed');

  // An expression, not just an identifier.
  assert.ok(T('const v = <div {...getProps(a, { b: 1 })} />;').includes('${spread(getProps(a, { b: 1 }))}'),
    'an arbitrary expression spreads');

  // Several on one element — each is its own element-position slot, which the runtime keeps apart.
  assert.ok(T('const v = <div {...a} {...b} />;').includes('${spread(a)} ${spread(b)}'),
    'two spreads emit two slots');

  // Ordering is preserved, because attribute order decides who wins.
  assert.ok(T('const v = <div id="x" {...p} title="y" />;').includes('id="x" ${spread(p)} title="y"'),
    'source order is preserved');

  // Already imported: do not inject a second time.
  assert.equal(
    (injected("import { spread } from '@verajs/renderer/spread';\nconst v = <div {...p} />;").match(/@verajs\/renderer\/spread/g) ?? []).length,
    1,
    'an existing import is respected');

  // No spread, no import.
  assert.ok(!injected('const v = <div id="x" />;').includes('@verajs/renderer/spread'), 'unused, uninjected');

  // Components still take spread as a plain object argument — unchanged.
  assert.ok(T('const v = <App {...props} a={1} />;').includes('App({'), 'component spread untouched');

  console.log('jsx spread ok');
}
