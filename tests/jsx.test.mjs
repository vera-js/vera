/**
 * @verajs/jsx: transform assertions plus EXECUTION — transformed output runs against the real
 * renderer build in jsdom, proving the emitted templates hit the same engine paths (identity,
 * keyed reconciliation, events) as hand-written ones.
 */
import { load } from './dist.mjs';
const { transformJsx } = await load('jsx');
import { JSDOM } from 'jsdom';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dom = new JSDOM('<div id="root"></div>');
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
const { renderInto } = await load('renderer');
const { keyed } = await load('renderer/keyed');
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
  'checked', '?disabled=${s.d}', '@change=${s.f}', '.innerHTML=${s.trusted}', ' ${s.r}', 'hidden></span>']) {
  assert.ok(emitted.includes(expected), `mapping emits ${expected}`);
}
assert.ok(!emitted.includes('defaultValue') && !emitted.includes('dangerously'), 'react names fully translated');

// ── 1b. on a COMPONENT tag, a bare prop is a PROP ──
/**
 * The emitted `.name` bindings land on the reception machinery `tests/component-props.test.mjs`
 * pins end to end (adoption, platform hand-off, SSR delivery), so the runtime half is proven
 * there; THIS matrix pins the grammar. The two exception families are derivations, not a
 * vocabulary: names that cannot be JS identifiers have no property spelling by construction, and `class`/`for` are
 * the two names the DOM itself renamed because JS refuses them as identifiers.
 */
const component = transformJsx(`
const view = (s) => (
  <calendar-day date={s.date} label="lit" active disabled={s.d} slot="side"
    className="c" data-track="t" aria-label="cal" xlink:href={s.h} onPick={s.f}>
    <div title={s.t} />
  </calendar-day>
);`, 'c.jsx', { inject: false });
for (const expected of ['.date=${s.date}', '.label=${"lit"}', '.active=${true}', '.disabled=${s.d}',
  '.slot=${"side"}', 'class="c"', 'data-track="t"', 'aria-label="cal"', 'xlink:href=${s.h}', '@pick=${s.f}']) {
  assert.ok(component.includes(expected), `component mapping emits ${expected}`);
}
assert.ok(!component.includes('.xlink'), 'a colon name cannot be a prop spelling — it stays an attribute');
assert.ok(component.includes('title=${s.t}') && !component.includes('.title'),
  'an HTML tag inside the component keeps attribute semantics — the rule is per element, not per file');
assert.ok(!component.includes('?disabled'),
  'the boolean-attribute guess is an HTML-control interpretation and never reaches a component');

// ── 1c. expressions inside <svg>/<math> compile their roots in the right namespace ──
/**
 * A template's namespace is decided by the tag that parses it, so a map callback's shapes inside
 * `<svg>` compiled as html`` yielded HTMLUnknownElements that never draw — and JSX has no svg`` of
 * its own to reach for, so NO spelling worked. The surrounding element now decides, lexically:
 * `<svg>` children compile with the svg tag, `<math>` with mathml, `<foreignObject>` flips back.
 */
const svgOut = transformJsx(`
const icon = (pts) => (
  <svg viewBox="0 0 10 10">
    {pts.map((p) => <circle key={p} cx={p} cy="5" r="1" />)}
    <foreignObject><div>{pts.length > 0 && <em>n</em>}</div></foreignObject>
  </svg>
);
const formula = (x) => <math>{x && <mi>x</mi>}</math>;`, 's.jsx', { inject: false });
assert.ok(/keyed\(p, svg`<circle/.test(svgOut), 'a mapped shape inside <svg> compiles with the svg tag');
assert.ok(/html`<em>n<\/em>`/.test(svgOut), '<foreignObject> flips its expressions back to html``');
assert.ok(/mathml`<mi>x<\/mi>`/.test(svgOut), 'expressions inside <math> compile with mathml``');
const svgInjected = transformJsx('export const v = (pts) => <svg>{pts.map((p) => <rect key={p} />)}</svg>;', 'si.jsx');
assert.ok(svgInjected.includes("import { svg } from '@verajs/core';"), 'the svg import is injected when used');

/** And EXECUTED: the compiled output renders real SVG-namespace elements through the real engine. */
{
  const { svg } = await load('core');
  globalThis.__vera.svg = svg;
  const svgMod = await compile('const { html, keyed, svg } = globalThis.__vera;\n' +
    'export const icon = (pts) => <svg viewBox="0 0 10 10">{pts.map((p) => <circle key={p} cx={p} cy="5" r="1" />)}</svg>;');
  const svgHost = dom.window.document.getElementById('root');
  renderInto(svgMod.icon([1, 2, 3]), svgHost);
  const circles = [...svgHost.querySelectorAll('circle')];
  assert.equal(circles.length, 3, 'the mapped shapes rendered');
  assert.ok(circles.every((c) => c.namespaceURI === 'http://www.w3.org/2000/svg'),
    `shapes parse in the SVG namespace, not as HTMLUnknownElements — got ${circles[0]?.namespaceURI}`);
}

// ── 1d. a boolean child renders nothing, and only a boolean ──
/**
 * React's rule, in the grammar React users write. The template equivalent still renders the word
 * `false` — that divergence is stated as an equality in `./jsx-equivalence.test.mjs` and named by
 * the renderer's development warning — so this pins the JSX half: compiled AND executed, because
 * the compiled text alone cannot show that the helper actually filters.
 */
{
  const compiled = transformJsx('export const v = (s) => <b>{s.f && <i>x</i>}</b>;', 'f.jsx', { inject: false });
  assert.ok(compiled.includes('$veraChild('), 'a child expression is wrapped');
  assert.ok(/const \$veraChild = /.test(compiled),
    'and the helper is DEFINED even with inject:false — it is a local const, not an import');
  assert.ok(!transformJsx('export const v = <b>static</b>;', 'g.jsx').includes('$veraChild'),
    'a module with no child expressions carries no helper at all');

  const mod = await compile(PRELUDE + 'export const v = (s) => <b>{s.f && <i>x</i>}</b>;\n' +
    'export const t = (s) => <b>{s.t && <i>x</i>}</b>;\n' +
    'export const z = (s) => <b>{s.zero && <i>x</i>}</b>;');
  const box = dom.window.document.getElementById('root');
  renderInto(mod.v({ f: false }), box);
  assert.equal(box.querySelector('b').textContent, '', 'a false child renders NOTHING, not "false"');
  renderInto(mod.t({ t: true }), box);
  assert.equal(box.querySelector('b').textContent, 'x', 'a true test still renders its element');
  renderInto(mod.z({ zero: 0 }), box);
  assert.equal(box.querySelector('b').textContent, '0',
    '`0` still renders — the rule is booleans, not falsiness, exactly as React has it');
}

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
renderInto(mod.app(state), container);
container.querySelector('button').dispatchEvent(new dom.window.Event('click'));
assert.equal(clicks, 1, 'onClick wired through @click');
assert.equal(container.querySelector('em'), null, 'false conditional renders nothing');

const liB = container.querySelectorAll('li')[1];
state.items = [state.items[1], state.items[0]];
state.flag = true;
renderInto(mod.app(state), container);
assert.equal(container.querySelectorAll('li')[0], liB, 'key -> keyed(): reorder MOVED the node');
assert.equal(container.querySelector('em').textContent, 'on', 'conditional toggled in');
const before = container.querySelector('section');
renderInto(mod.app(state), container);
assert.equal(container.querySelector('section'), before, 'template identity stable across calls');

// ── 3. components: call convention, spread, children ──
const comp = await compile(PRELUDE + `
const Chip = ({ tone, children }) => <b class={'chip ' + tone}>{children}</b>;
export const page = (s) => <div><Chip tone="warm" {...s.extra}>hi {s.who}</Chip></div>;`);
renderInto(comp.page({ who: 'you', extra: {} }), container);
assert.equal(container.querySelector('b').textContent, 'hi you', 'component call + children flatten');
assert.ok(container.querySelector('b').className.includes('warm'), 'props pass through');

// ── 4. fragments = multi-root; text collapsing; template-literal escaping ──
const frag = await compile(PRELUDE + `export const t = (s) => <>
  <i>one</i>
  <i>{'\`'}{s.x} costs \${9}</i>
</>;`);
renderInto(frag.t({ x: 'tick' }), container);
const italics = container.querySelectorAll('i');
assert.equal(italics.length, 2, 'fragment renders multi-root');
assert.equal(italics[1].textContent, '`tick costs $9', 'backticks and dollar-brace survive');

// ── 5. helpful compile errors ──
assert.throws(() => transformJsx('const a = <ul><li key={1}>x</li></ul>;', 'e.jsx'), /key belongs on the JSX root/);
assert.throws(() => transformJsx('const a = <div style={{ color: c }} />;', 'e.jsx'), /style expects a STRING/);

// ── 6. auto-imports ──
const injected = transformJsx('export const v = () => <p>{x.map((i) => <b key={i}>{i}</b>)}</p>;', 'i.jsx');
assert.ok(injected.startsWith("import { html } from '@verajs/core';\nimport { keyed } from '@verajs/renderer/keyed';"),
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

/* ── the auto-injected import must never duplicate one the source already has ──────────────────
 * The guard was a regex anchored at the start of a line, which two ordinary shapes defeated: an
 * **indented** import — every inline `<script type="text/vera-jsx">` block in an HTML page is
 * indented — and an import spread across lines, which formatters produce. Both emitted a second
 * `import { html }`, and the module died with `Identifier 'html' has already been declared`. In the
 * browser `standalone.js` catches that and logs it, so the page simply does nothing.
 */
{
  /** Counted as output minus input, or the source's own import is mistaken for an injected one. */
  const count = (text, name) => (text.match(new RegExp(`import \\{\\s*${name}\\s*\\}\\s*from`, 'g')) ?? []).length;
  const injections = (code, name) => count(transformJsx(code, 'dup.jsx'), name) - count(code, name);

  assert.ok(injections("      import { init, html } from '@verajs/core';\n      const a = <p>{1}</p>;", 'html') === 0, 'an indented import of html suppresses the injection');
  assert.ok(injections("import {\n  init,\n  html,\n} from '@verajs/core';\nconst a = <p>{1}</p>;", 'html') === 0, 'an import spread across lines does too');
  assert.ok(injections("    import { keyed } from '@verajs/renderer/keyed';\n    const a = <p key={1}>{1}</p>;", 'keyed') === 0, 'an indented import of keyed suppresses its injection');
  assert.ok(injections("import { html as h } from '@verajs/core';\nconst a = <p>{1}</p>;", 'html') === 1, 'a renamed import does not suppress it, because the emitted name is still unbound');
  assert.ok(injections('const a = <p>{1}</p>;', 'html') === 1, 'and a source with no import of its own still gets one');
}

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

// ── member-expression components: a dotted tag is a call, whatever its first segment's case ──
// `<Foo.Bar/>` always worked; `<motion.div/>` and `<styled.button/>` — the lowercase-namespace
// member components the React ecosystem writes — were silently emitted as broken host tags
// `<motion.div>` because the component test looked only at the first character (run 25). A host
// HTML tag can never contain a dot, so any dotted tag is a component call.
{
  assert.ok(T('const v = <motion.div a={1}>k</motion.div>;').includes('motion.div({'),
    'lowercase-namespace member component becomes a call');
  assert.ok(T('const v = <styled.button>go</styled.button>;').includes('styled.button({'),
    'and another');
  assert.ok(T('const v = <Foo.Bar a={1} />;').includes('Foo.Bar({'), 'capitalised member still a call');
  assert.ok(T('const v = <Deep.Namespace.Comp />;').includes('Deep.Namespace.Comp({'), 'deep member too');
  // host elements and hyphenated custom elements are NOT calls — they stay literal tags
  const host = T('const v = <div>plain</div>;');
  assert.ok(host.includes('html`<div>') && !host.includes('div({'), 'a bare host tag stays a literal element');
  assert.ok(T('const v = <my-el a="1" />;').includes('html`<my-el'), 'a hyphenated custom element stays literal');
  // nested member component inline in a template
  assert.ok(T('const v = <p><motion.span>x</motion.span></p>;').includes('motion.span({'),
    'a member component nested in host markup is called inline');
  console.log('jsx member-component ok');
}
