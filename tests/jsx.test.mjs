/**
 * @verajs/jsx: transform assertions plus EXECUTION — transformed output runs against the real
 * renderer build in jsdom, proving the emitted templates hit the same engine paths (identity,
 * keyed reconciliation, events) as hand-written ones.
 */
import { isProduction, load } from './dist.mjs';
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
for (const expected of ['class="a"', ' for="f"', '!value=${s.v}', 'value="dv"', '!checked=${s.c}',
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

// ── 1c. a template's namespace is decided where it LANDS, not by the compiler ──
/**
 * JSX has no svg`` of its own, and a component's children are written outside the `<svg>` they
 * render into — `<Frame><path d="…" /></Frame>` — so no compile-time rule can know their namespace.
 * Every attempt to guess (lexical mode, SVG-only root names, sibling vouching, islands) grew an edge
 * case a round, so the compiler stopped deciding: every template is html``, and every compiled
 * module wires `@verajs/renderer/namespaces`, which parses a template in the namespace of the
 * position it is placed in. Rendering correctness is proven against the real parser by
 * `./jsx-namespace-corpus.test.mjs` and on three engines by its browser twin; this pins the
 * compiler's half.
 */
const icon = transformJsx(
  `const Frame = ({ children }) => <svg viewBox="0 0 24 24">{children}</svg>;
   export const a = (pts) => <Frame>{pts.map((p) => <circle key={p} r="1" />)}<path d="M0" /></Frame>;
   export const m = (x) => <math>{x && <mi>x</mi>}</math>;`,
  'ic.jsx',
  { inject: false }
);
assert.ok(!/\b(?:svg|mathml)`/.test(icon), 'no template is tagged svg`` or mathml`` — the compiler no longer decides');
assert.ok(/keyed\(p, html`<circle/.test(icon), 'a mapped shape is html``');
assert.ok(/html`<path /.test(icon), "and so is a component's SVG child");
assert.ok(/html`<mi>x<\/mi>`/.test(icon), 'and an expression inside <math>');

/**
 * **Every compiled module wires the resolver**, so no JSX template can be built before it exists —
 * a module's imports and top-level statements run before anything it renders. Wiring the same
 * descriptor again is idempotent in core, so a hundred modules cost one registration.
 */
const WIRING = "import { namespaces } from '@verajs/renderer/namespaces';\nimport { wire } from '@verajs/core';\nwire([namespaces]);\n";
const wired = transformJsx('export const v = <p>hi</p>;', 'w.jsx');
assert.ok(wired.includes(WIRING), `the default output wires @verajs/renderer/namespaces:\n${wired}`);
assert.ok(wired.indexOf(WIRING) < wired.indexOf('html`'), 'before any template in the module');
const optedOut = transformJsx('export const v = <p>hi</p>;', 'w.jsx', { namespaces: false });
assert.ok(!optedOut.includes('namespaces') && !optedOut.includes('wire'), '`namespaces: false` wires nothing');
assert.ok(optedOut.includes("import { html } from '@verajs/core';"), 'CONTROL: and still injects the tag');
const manual = transformJsx('export const v = <p>hi</p>;', 'w.jsx', { inject: false });
assert.ok(!manual.includes('wire'), '`inject: false` means the caller owns every import — the wiring too');

/** A module that already imports the pieces is not handed a second copy of either. */
const own = transformJsx(
  "import { wire } from '@verajs/core';\nimport { namespaces } from '@verajs/renderer/namespaces';\nexport const v = <p>hi</p>;",
  'own.jsx'
);
assert.equal(own.match(/import \{ wire \}/g).length, 1, 'its own `wire` import is used, not duplicated');
assert.equal(own.match(/import \{ namespaces \}/g).length, 1, 'nor its own `namespaces` import');
assert.ok(own.includes('wire([namespaces]);'), 'CONTROL: the call is still emitted, through its bindings');

/** A module binding `wire` for something else gets the import under another name. */
const ownWire = transformJsx('const wire = (x) => x;\nexport const v = <p>hi</p>;', 'ow.jsx');
assert.match(ownWire, /import \{ wire as \$veraWire \} from '@verajs\/core';/, 'a colliding `wire` is renamed');
assert.ok(ownWire.includes('$veraWire([namespaces]);'), 'and the call uses the name the import bound');

/**
 * **`<annotation-xml>` is not a custom element**, though its name has a dash — it is one of the
 * eight names SVG and MathML own, which the spec reserves. Read as a custom element, its `encoding`
 * compiled to a PROPERTY, the parser never saw it, and HTML content inside was moved out of the
 * `<math>`. It must stay an attribute now for a second reason: the resolver reads it to decide
 * whether the content is HTML or MathML.
 */
const annotation = transformJsx(
  `export const a = (l) => <math><annotation-xml encoding="text/html">{l && <my-card />}</annotation-xml></math>;
   export const e = () => <my-el encoding="text/html" />;
   export const f = () => <g><font-face /><path d="M0" /></g>;`,
  'ax.jsx',
  { inject: false }
);
assert.ok(/a = .*<annotation-xml encoding="text\/html">/.test(annotation), 'encoding stays an ATTRIBUTE on a reserved name');
assert.ok(/f = \(\) => html`<g><font-face><\/font-face>/.test(annotation), 'and so does every reserved SVG name');
assert.ok(/e = \(\) => html`<my-el \.encoding=\$\{"text\/html"\}>/.test(annotation), 'CONTROL: a real custom element still takes the prop');

/**
 * **An injected import must not collide with a name the module CONTAINS**, in any spelling.
 *
 * A duplicate declaration makes the whole file a `SyntaxError` — caught and logged in a browser, so
 * the page simply does nothing. Each case below was a dead module under the DECLARATION scan that
 * shipped earlier, and together they are why that approach was abandoned rather than widened: a
 * regex for `const|let|var|function|class NAME` cannot see a destructured binding, a second
 * declarator, or — fatally — a PARAMETER, which shadows the module-scope import and throws at the
 * first render.
 */
for (const [shape, src] of [
  ['a plain declaration', 'const html = 1;'],
  ['an object pattern — the buildless CDN idiom', 'const { html, render } = vera;'],
  ['an array pattern', 'const [html, setHtml] = useState();'],
  ['a second declarator', 'let q, html;'],
]) {
  const out = transformJsx(`${src}\nexport const a = <p>x</p>;`, 'cl.jsx', { inject: true });
  assert.match(out, /import \{ html as \$veraHtml \}/, `the local binding is renamed, never the export: ${shape}`);
  assert.ok(/a = \$veraHtml`/.test(out), `and the call site uses the name the import bound: ${shape}`);
}

/** A PARAMETER is the one a declaration scan can never reach, and it throws rather than failing to parse. */
const param = transformJsx('export const Card = ({ html }) => <p title={html} />;', 'pa.jsx', { inject: true });
assert.match(param, /import \{ html as \$veraHtml \}/, 'a parameter shadows a module-scope import, so it counts');
assert.ok(/=> \$veraHtml`/.test(param), 'the tag is the injected name');
assert.ok(/title=\$\{html\}/.test(param), "and the parameter's own value still reaches the binding");

/**
 * **A name USED AS A TAG is a reference to the injected import, not a collision.** A module may
 * hand-write `` html`…` `` beside its JSX — `tests/jsx-twin-parity.test.mjs` is built entirely of
 * such pairs — and renaming the binding out from under it leaves `html is not defined`. That suite
 * is what caught this; it is pinned here too, where the rule lives.
 */
const twin = transformJsx(
  'export const a = <p class="a">hi</p>;\nexport const b = () => html`<p class="a">hi</p>`;',
  'tw.jsx',
  { inject: true }
);
assert.match(twin, /import \{ html \} from/, 'a hand-written tag beside JSX keeps the plain name');
assert.ok(!twin.includes('$veraHtml'), 'and is not renamed, because the reference would then dangle');

/** The chosen name is bumped until the module does not contain THAT either. */
const taken = transformJsx(
  `import { $veraHtml } from './h.js';\nconst html = 1;\nexport const a = <p>x</p>;`,
  'tk.jsx',
  { inject: true }
);
assert.match(taken, /import \{ html as \$veraHtml2 \}/, 'a taken alias is bumped rather than collided with');

/**
 * **A TypeScript ANNOTATION is a binding, and is spelled exactly like an object key up to the `:`.**
 * `.tsx` is a first-class input, so excluding keys quietly excluded every annotated binding —
 * `let html: string` collided with the injected import, and `function draw(html: string)` shadowed
 * it for `html is not a function`. What separates them is what comes BEFORE the name.
 */
for (const [shape, src] of [
  ['an annotated let', 'let html: string;'],
  ['an annotated const', 'const html: string = q();'],
  ['an annotated parameter', 'function draw(html: string) { return 1; }'],
]) {
  const typed = transformJsx(`${src}\nexport const v = () => <p>x</p>;`, 't.tsx', { inject: true });
  assert.match(typed, /import \{ html as \$veraHtml \}/, `${shape} is a binding, so the import is renamed`);
}
const keyed2 = transformJsx('const o = { html: 1 };\nexport const v = () => <p>x</p>;', 'k.tsx', { inject: true });
assert.match(keyed2, /import \{ html \} from/, 'CONTROL: an object KEY still binds nothing');

/**
 * A name that appears only inside a STRING, a comment or a template literal is not a binding, and
 * renaming for it is noise. The scan blanks literal contents to see that — which it must do with a
 * character walk, since `` `A ${`B`} C` `` inverts any non-recursive pattern and leaks B.
 */
for (const [shape, src] of [
  ['a string', 'const d = "html";'],
  ['a line comment', '// html goes here'],
  ['a block comment', '/* html goes here */'],
  ['a template literal', 'const d = `a html here`;'],
  ['a NESTED template literal', 'const d = `a ${`html`} here`;'],
]) {
  const quiet = transformJsx(`${src}\nexport const a = <p>x</p>;`, 'q.jsx', { inject: true });
  assert.match(quiet, /import \{ html \} from/, `${shape} is not a binding, so the name is untouched`);
  assert.ok(/a = html`/.test(quiet), `${shape}: and so is the call site`);
}

/**
 * CONTROLS. A module that never mentions the name keeps the clean one — which is the common case
 * and the reason this is not simply always-prefixed.
 */
const noClash = transformJsx(`export const a = <p>x</p>;`, 'nc.jsx', { inject: true });
assert.match(noClash, /import \{ html \} from/, 'CONTROL: nothing to collide with, so the name is untouched');
assert.ok(/a = html`/.test(noClash), 'CONTROL: and so is the call site');

const owned = transformJsx(`const html = 1;\nexport const a = <p>x</p>;`, 'ow.jsx', { inject: false });
assert.ok(/a = html`/.test(owned), 'CONTROL: with inject:false the caller owns the bindings, so nothing is renamed');
assert.ok(!owned.includes('import'), 'CONTROL: and nothing is injected');

/**
 * And EXECUTED: a component's SVG children, compiled as html``, render as real SVG-namespace
 * elements once the resolver is wired — the shape that drew nothing under every compile-time rule.
 */
{
  const core = await load('core');
  const { renderer } = await load('renderer');
  const { namespaces } = await load('renderer/namespaces');
  core.wire([renderer, namespaces]);
  globalThis.__vera.coreHtml = core.html;
  const svgMod = await compile('const { coreHtml: html, keyed } = globalThis.__vera;\n' +
    'const Frame = ({ children }) => <svg viewBox="0 0 10 10">{children}</svg>;\n' +
    'export const icon = (pts) => <Frame>{pts.map((p) => <circle key={p} cx={p} cy="5" r="1" />)}<path d="M0" /></Frame>;');
  const svgHost = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(svgHost);
  renderInto(svgMod.icon([1, 2, 3]), svgHost);
  const shapes = [...svgHost.querySelectorAll('circle, path')];
  assert.equal(shapes.length, 4, 'the mapped shapes and the path rendered');
  assert.ok(shapes.every((c) => c.namespaceURI === 'http://www.w3.org/2000/svg'),
    `shapes parse in the SVG namespace, not as HTMLUnknownElements — got ${shapes.map((s) => s.namespaceURI)}`);
  svgHost.remove();
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

  /**
   * **The helper must not collide with a name the module already uses.** A second
   * `const $veraChild` is a SyntaxError that kills the whole module — the same failure a
   * duplicate `import { html }` caused before the import injector grew its `bound` set, which is
   * why this is pinned rather than trusted. A text search is the right granularity here: a hit in
   * a comment or a string only costs a different name.
   */
  const owned = transformJsx('const $veraChild = 1; export const v = (x) => <p>{x}</p>;', 'h.jsx', { inject: false });
  assert.match(owned, /const \$veraChild2 = \(v\)/, 'the helper steps aside when the name is taken');
  assert.match(owned, /\$veraChild2\(x\)/, 'and the call site uses the same stepped-aside name');
  assert.equal((owned.match(/const \$veraChild\b/g) ?? []).length, 1, 'the author’s own declaration is untouched');
  const both = transformJsx('const $veraChild = 1, $veraChild2 = 2; export const v = (x) => <p>{x}</p>;', 'i.jsx', { inject: false });
  assert.match(both, /const \$veraChild3 = /, 'and keeps stepping until the name is free');

  /**
   * **A COMPONENT's children take the same rule**, because the author wrote the same thing.
   * Without it `<Row>{cond && <em/>}</Row>` handed `Row` a `false` that its own `${children}`
   * rendered as the word — measured before this was added. Filtering to `null` leaves the array's
   * length alone, so a component that counts its children is unaffected.
   */
  /**
   * **The filter is one level deep, and that is a measured decision.** React filters children
   * recursively, so `{rows.map((r) => r.ok && <li/>)}` drops the failing rows there and renders
   * "false" for each of them here. Matching React costs ~135 ns against ~15 ns per list child
   * even for arrays holding no booleans — roughly doubling every list commit to fix some lists —
   * so the development warning carries this case instead. Pinned so the divergence stays a
   * decision rather than becoming a surprise.
   */
  assert.match(
    transformJsx('const v = <ul>{rows.map((r) => r.ok && <li/>)}</ul>;', 'arr.jsx', { inject: false }),
    /\$veraChild\(rows\.map/,
    'the array itself is filtered, not its items'
  );

  const kids = transformJsx('const v = <Row>{c && <em/>}</Row>;', 'j.jsx', { inject: false });
  assert.match(kids, /children: \[\$veraChild\(c && /, 'a component child expression is filtered too');
  assert.doesNotMatch(
    transformJsx('const v = <Row><em>x</em></Row>;', 'k.jsx', { inject: false }),
    /\$veraChild/,
    'a nested ELEMENT child needs no filter — a template result is never a boolean'
  );

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

// ── 5. helpful compile errors — the sentence in development, the position + docs link in production ──
assert.throws(() => transformJsx('const a = <ul><li key={1}>x</li></ul>;', 'e.jsx'), isProduction ? /^Error: e\.jsx:1:\d+ — https:\/\/verajs\.dev\/e\/jsx-key-placement$/ : /key belongs on the JSX root/);
assert.throws(() => transformJsx('const a = <div style={{ color: c }} />;', 'e.jsx'), isProduction ? /^Error: e\.jsx:1:\d+ — https:\/\/verajs\.dev\/e\/style-object$/ : /style expects a STRING/);

// ── 6. auto-imports ──
const injected = transformJsx('export const v = () => <p>{x.map((i) => <b key={i}>{i}</b>)}</p>;', 'i.jsx');
assert.ok(injected.startsWith("import { html } from '@verajs/core';\nimport { keyed } from '@verajs/renderer/keyed';"),
  'auto-imports injected when missing');
const notDoubled = transformJsx("import { html } from '@verajs/core';\nexport const v = () => <p>x</p>;", 'i2.jsx');
assert.equal((notDoubled.match(/import \{ html \}/g) ?? []).length, 1, 'existing import not doubled');

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
  assert.ok(T('const v = <Foo.Bar a={1} />;').includes('Foo.Bar({'), 'capitalized member still a call');
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
