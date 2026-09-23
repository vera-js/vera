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

// ── 1d. an SVG-only ROOT compiles with the svg tag, wherever it was written ──
/**
 * Lexical mode stops at a FUNCTION BOUNDARY, which left the one shape JSX could not express:
 *
 *     const Frame = ({ children }) => <svg viewBox="0 0 24 24">{children}</svg>;
 *     <Frame><path d="M0 0h24" /></Frame>
 *
 * The `<path>` is written outside any `<svg>`, so it compiled as html`` and drew nothing — an app
 * reported every header icon vanishing, with nothing to search for. The call site cannot know what
 * `Frame` renders and does not need to: `<path>` is not an HTML element in any context, so a root
 * carrying an SVG-ONLY name is tagged svg`` wherever it lands.
 *
 * Deciding it HERE rather than in the renderer is what makes it hold for the awkward shapes. A
 * Fragment component compiles to `` html`${children}` `` and a mapped list to a nested array, both
 * of which reach the DOM through an off-document fragment that has no namespace to read — so a
 * renderer-side inference answered "not SVG" for exactly those, order-dependently. A root tag is
 * known statically and cannot be asked at the wrong moment.
 */
const handed = transformJsx(
  `const Frame = ({ children }) => <svg viewBox="0 0 24 24">{children}</svg>;
   const Group = ({ children }) => <>{children}</>;
   export const icon = () => <Frame><path d="M0 0h24" /><circle cx="12" cy="12" r="4" /></Frame>;
   export const nested = () => <Frame><Group><path d="M1 1h2" /></Group></Frame>;`,
  'handed.jsx',
  { inject: false }
);
assert.ok(/svg`<path /.test(handed), "a component's <path> child compiles with the svg tag");
assert.ok(/svg`<circle /.test(handed), 'every SVG-only child is tagged, not just the first');
assert.equal(handed.match(/svg`<path /g).length, 2, 'including one nested inside a Fragment component');
assert.ok(
  /html`<svg viewBox/.test(handed),
  'a template ALREADY rooted at <svg> is untouched — the HTML parser handles it, and tagging it ' +
    'would wrap correct markup in a second <svg> to parse it'
);

/**
 * **A root is never upgraded over a component or custom element in its subtree.**
 *
 * An upgraded root puts its whole statically-visible subtree in the SVG namespace, and custom-element
 * upgrade is spec-gated on the HTML namespace — so `<g><my-card/></g>` compiled as svg`` leaves
 * `<my-card>` permanently inert: no `connectedCallback`, no diagnostic, in every engine. Measured on
 * Chromium, Firefox and WebKit. The guard existed for a fragment root before it existed for an
 * ELEMENT root, which is the commoner spelling by far.
 */
const withComponent = transformJsx(
  `export const a = () => <g><my-card /></g>;
   export const b = () => <g><path d="M0" /></g>;
   export const c = () => <g><defs><my-card /></defs></g>;`,
  'ce.jsx',
  { inject: false }
);
assert.ok(/a = \(\) => html`<g><my-card/.test(withComponent), 'a custom element keeps its root HTML');
assert.ok(/b = \(\) => svg`<g><path /.test(withComponent), 'CONTROL: real SVG still upgrades');
assert.ok(/c = \(\) => html`<g><defs><my-card/.test(withComponent), 'and the walk reaches any depth');

/**
 * A DOTTED component (`motion.path`) starts lowercase and carries no dash, so a hand-rolled copy of
 * the component test missed it and `<g><motion.path/></g>` upgraded. The predicate is shared with
 * `isComponentTag` now — but only for the component half: a dash-named tag is a custom ELEMENT, not
 * a component, and folding the dash into the shared test rewrote every custom element as a function
 * call and broke six suites. The two questions look alike and are not the same.
 */
const dotted = transformJsx(
  `export const a = () => <g><motion.path /></g>;
   export const b = () => <g><Icon /></g>;
   export const c = () => <order-row item={x} />;
   export const d = () => <Box><path d="M0" /></Box>;`,
  'dotted.jsx',
  { inject: false }
);
assert.ok(
  dotted.includes('a = () => html`<g>${motion.path('),
  'a dotted component keeps its root html`` — it starts lowercase and carries no dash, so a ' +
    'hand-rolled copy of the component test missed it and the root upgraded'
);
assert.ok(dotted.includes('b = () => html`<g>${Icon('), 'so does a capitalised one');
assert.ok(
  /svg`<path /.test(dotted),
  'CONTROL: without this the block passes with the feature DISABLED — every other assertion in it ' +
    'expects an html`` outcome, which is exactly what the un-upgraded compiler produces'
);
assert.ok(
  dotted.includes('c = () => html`<order-row .item='),
  'CONTROL: a dash-named tag is still an ELEMENT with a bound property, not a function call — ' +
    'folding the dash into the shared component predicate rewrote every custom element as a call'
);

/**
 * **Through an EXPRESSION too**, which is the commonest spelling and the one the first guard missed:
 * an expression child carries its JSX in `roots`, not `children`, so a mapped or conditional custom
 * element was invisible to the walk while the upgraded mode still propagated into it.
 */
const throughExpression = transformJsx(
  `export const a = () => <g>{rows.map((r) => <my-card key={r} />)}</g>;
   export const b = () => <g>{cond && <my-card />}</g>;
   export const c = () => <g>{rows.map((r) => <path d={r} />)}</g>;`,
  'expr.jsx',
  { inject: false }
);
assert.ok(/a = \(\) => html`<g>/.test(throughExpression), 'a MAPPED custom element keeps its root HTML');
assert.ok(/b = \(\) => html`<g>/.test(throughExpression), 'so does a conditional one');
assert.ok(/c = \(\) => svg`<g>/.test(throughExpression), 'CONTROL: mapped real SVG still upgrades');

/**
 * **An expression child REFUSES a fragment root** (concession 10), and nothing tested it: mutating
 * that `return 'html'` back to a `continue` failed no assertion, which would have restored the
 * round-1 defect — plain HTML inside the expression built in the SVG namespace.
 */
const exprRefuses = transformJsx(
  `export const a = () => <><path d="M0" />{cond && <section>visible</section>}</>;
   export const b = () => <><path d="M0" /><circle r="1" /></>;`,
  'er.jsx',
  { inject: false }
);
assert.ok(/a = \(\) => html`/.test(exprRefuses), 'an expression child is opaque, so the fragment refuses');
assert.ok(/b = \(\) => svg`/.test(exprRefuses), 'CONTROL: without one, the same fragment upgrades');

/**
 * **An empty fragment proves nothing, at ANY depth** — it must not disprove either. A
 * `children.length === 0` check handled `<><></><path/></>` and not `<><><></></><path/></>`, which
 * is the same tree one level further in. The rule needs three states: proves, disproves, and proves
 * nothing; collapsing the last two into one was the defect, twice.
 */
const emptyFragments = transformJsx(
  `export const a = () => <><></><path d="M0" /></>;
   export const b = () => <><><></></><path d="M0" /></>;
   export const c = () => <><></></>;
   export const d = () => <><></><div>x</div></>;`,
  'ef.jsx',
  { inject: false }
);
assert.ok(/a = \(\) => svg`/.test(emptyFragments), 'an empty fragment beside a shape does not disprove');
assert.ok(/b = \(\) => svg`/.test(emptyFragments), 'nor does one nested inside another empty one');
assert.ok(/c = \(\) => html`/.test(emptyFragments), 'CONTROL: emptiness alone proves nothing, so no upgrade');
assert.ok(/d = \(\) => html`/.test(emptyFragments), 'CONTROL: a real HTML child still disproves');

/**
 * **ATTRIBUTES carry JSX too**, and the upgraded mode propagates into them — `<g onClick={() =>
 * render(<my-card/>)}>` compiled the handler's element as SVG. That was a REGRESSION rather than a
 * missed fix: the same source emitted html`` before this feature existed. The walk reaches wherever
 * the COMPILER picks the inner tag — children, an expression child's roots, and an element's attrs.
 */
const inAttributes = transformJsx(
  `export const a = () => <g onClick={() => r(<my-card />)}><path d="M0" /></g>;
   export const b = () => <g label={<Icon />}><path d="M0" /></g>;
   export const c = () => <g onClick={() => r(<path d="M1" />)}><path d="M0" /></g>;
   export const d = () => <Box><rect width="1" /></Box>;`,
  'attrs.jsx',
  { inject: false }
);
assert.ok(/a = \(\) => html`<g @click/.test(inAttributes), 'JSX inside a handler keeps the root HTML');
assert.ok(/b = \(\) => html`<g /.test(inAttributes), 'and inside any other attribute expression');
assert.ok(
  /c = \(\) => html`<g @click/.test(inAttributes),
  'ANY JSX in an attribute refuses, even SVG-only JSX. The narrower "only a component refuses" rule ' +
    'left plain HTML behind — `<circle onClick={() => open(<form><input/></form>)}/>` built a real ' +
    'form as SVG, not an HTMLInputElement and silent. A handler\'s template goes wherever the ' +
    'handler puts it, which the root cannot know, so it must not assume'
);
assert.ok(/svg`<rect/.test(inAttributes), 'CONTROL: a shape with no attribute JSX still upgrades');

/**
 * **An HTML ISLAND is exempt.** `<foreignObject>` and `<desc>` parse their content in the
 * HTML namespace even inside an `svg` fragment, so a custom element there is safe — measured: the
 * `<g>` stays SVG and draws, the element is XHTML, and `connectedCallback` runs. Refusing over one
 * cost the upgrade for exactly the remedy the renderer's warning recommends.
 */
const island = transformJsx(
  `export const a = () => <g><foreignObject><my-card /></foreignObject></g>;
   export const b = () => <g><defs><my-card /></defs></g>;`,
  'island.jsx',
  { inject: false }
);
assert.ok(/a = \(\) => svg`<g><foreignObject/.test(island), 'a custom element inside an island is safe');
assert.ok(/b = \(\) => html`<g><defs/.test(island), 'CONTROL: outside an island it still refuses');

/**
 * `<title>` IS an integration point and the compiler treats it as one for child mode — but a root is
 * refused over a `<title>` holding a STATIC ELEMENT. `@verajs/renderer` scans `<title>` as raw text
 * in every template, by one rule shared between the scan and the parsed-tree pass; making that rule
 * namespace-aware in only one of the two was tried and reverted, because PRODUCTION then rendered
 * the marker sentinel into `<title>` and shifted every later child binding. Text and expressions
 * never reach the disagreement — an expression becomes its own template, committed as a child.
 */
const titleIsland = transformJsx(
  `export const a = () => <g><title><my-card /></title></g>;
   export const b = () => <g><title>Close</title><path d="M0" /></g>;`,
  'ti.jsx',
  { inject: false }
);
assert.ok(/a = \(\) => html`<g><title/.test(titleIsland), 'a component inside <title> refuses the upgrade');
assert.ok(/b = \(\) => svg`<g><title/.test(titleIsland), 'CONTROL: ordinary <title> content still upgrades');

/**
 * The refusal is on a STATIC ELEMENT, not on a component — an ordinary element inside a `<title>` is
 * what reaches the scan/parse disagreement, and each of these three THREW or corrupted the DOM
 * before the rule existed: a spread threw `Cannot read properties of undefined (reading '0')` at
 * `new AttrPart`, a handler painted `@click="$v…$"` with a dead listener, and a `<tspan>` with a
 * binding was silently deleted. The two controls below are the whole reason the rule is not simply
 * "any child": they are the shapes an accessible icon is actually written in.
 */
const titleElements = transformJsx(
  `export const a = () => <g><title><b {...p} /></title></g>;
   export const b = () => <g><title><b onClick={f}>hi</b></title></g>;
   export const c = () => <g><title><tspan>{l}</tspan></title></g>;
   export const d = () => <g><title>Close</title><path d="M0" /></g>;
   export const e = () => <g><title>{label}</title><path d="M0" /></g>;`,
  'te.jsx',
  { inject: false }
);
for (const name of ['a', 'b', 'c']) {
  assert.ok(
    new RegExp(`${name} = \\(\\) => html\`<g><title`).test(titleElements),
    `an element inside <title> refuses the upgrade (${name})`
  );
}
assert.ok(/d = \(\) => svg`<g><title/.test(titleElements), 'CONTROL: text-only <title> still upgrades');
assert.ok(/e = \(\) => svg`<g><title/.test(titleElements), 'CONTROL: a bound <title> still upgrades');

/**
 * ...and the child-mode half is separate from the refusal half, deliberately: `<title>` still flips
 * its content back to HTML, so a custom element written inside one compiles `html` and UPGRADES.
 * Dropping `title` from the child-mode set along with the refusal set reopened exactly the hole the
 * feature exists to close — SVG-namespaced, `connectedCallback` never running, and no warning,
 * because both halves had agreed it was fine.
 */
const titleMode = transformJsx(
  `export const a = () => <svg><title>{flag && <my-badge />}</title></svg>;
   export const b = () => <svg><g>{flag && <my-badge />}</g></svg>;`,
  'tm.jsx',
  { inject: false }
);
assert.ok(/flag && html`<my-badge/.test(titleMode), 'an expression inside <title> compiles html');

/**
 * ...and BECAUSE child mode already made that expression `html`, a component inside a `<title>`
 * EXPRESSION must NOT block the root upgrade — the three islands answer the same question the same
 * way, from one list. Splitting `<title>` into a second, stricter list was tried: it refused this
 * shape, so the surrounding `<path>` lost its namespace and the icon vanished, which is the exact
 * bug the feature exists to fix. Only a STATIC element inside a `<title>` is genuinely unsafe.
 */
const titleExpr = transformJsx(
  `export const a = () => <g><title>{c && <my-badge />}</title><path d="M0" /></g>;
   export const b = () => <g><foreignObject>{c && <my-badge />}</foreignObject><path d="M0" /></g>;
   export const c = () => <g><title><my-badge /></title><path d="M0" /></g>;`,
  'tx.jsx',
  { inject: false }
);
assert.ok(/a = \(\) => svg`<g><title/.test(titleExpr), 'a component in a <title> EXPRESSION still upgrades');
assert.ok(/b = \(\) => svg`<g><foreignObject/.test(titleExpr), 'CONTROL: the other islands agree');
assert.ok(/c = \(\) => html`<g><title/.test(titleExpr), 'CONTROL: a STATIC element inside <title> still refuses');

/**
 * **`<svg>`/`<math>` switch mode only FROM HTML mode**, because in foreign content the parser puts
 * every start tag in the ADJUSTED CURRENT NODE's namespace: inside an `<svg>`, a `<math>` element
 * is itself SVG and so is everything under it. Verified in three engines. Nothing in the tree
 * compiled a nested `<svg><math>` before this, so reverting the guard to the unconditional form
 * passed the ENTIRE fast suite — 1770 tests — without a murmur.
 */
const nested = transformJsx(
  `export const a = () => <svg><math><mtext>{c && <my-card />}</mtext></math></svg>;
   export const b = () => <math><mtext>{c && <my-card />}</mtext></math>;`,
  'ne.jsx',
  { inject: false }
);
assert.ok(/c && svg`<my-card/.test(nested), 'inside an <svg>, a nested <math> stays SVG — so does its <mtext>');
assert.ok(/c && html`<my-card/.test(nested), 'CONTROL: from HTML mode, <math> really does switch to MathML');

/**
 * **A SIBLING vouches for a name a root tag alone cannot prove.**
 *
 * This is the canonical accessible icon, and it was the hole left after the shapes drew: a
 * component's children are emitted as SEPARATE roots, so `<title>` decided alone, lost (SVG shares
 * the name with HTML), and was built as an HTML `<title>` inside the `<svg>` — the accessible name
 * of nothing. The renderer warned correctly and could only recommend `` svg`…` ``, which no JSX
 * author can write; a remedy that cannot be typed is not a remedy. One `<path>` among the children
 * settles the group.
 *
 * The CONTROLS are the whole reason the exclusion exists and must keep passing: alone, with nothing
 * to vouch for it, `<text>` stays readable HTML rather than becoming a 0×0 SVG element.
 */
const vouched = transformJsx(
  `const F = ({ children }) => <svg viewBox="0 0 24 24">{children}</svg>;
   const B = ({ children }) => <div>{children}</div>;
   export const icon = () => <F><title>Close</title><path d="M0" /></F>;
   export const frag = () => <F><><title>Close</title><path d="M0" /></></F>;
   export const label = () => <F><text>hi</text><path d="M0" /></F>;
   export const alone = () => <B><title>Close</title></B>;
   export const prose = () => <B><text>hello</text></B>;`,
  'sib.jsx',
  { inject: false }
);
assert.ok(/svg`<title>Close<\/title>`/.test(vouched), 'a <path> sibling vouches for <title>');
assert.ok(/svg`<title>Close<\/title><path/.test(vouched), 'and a fragment of the two is one SVG template');
assert.ok(/svg`<text>hi<\/text>`/.test(vouched), 'content-bearing names are vouched for too');
assert.ok(/html`<title>Close<\/title>`/.test(vouched), 'CONTROL: alone, <title> is left as HTML');
assert.ok(/html`<text>hello<\/text>`/.test(vouched), 'CONTROL: and <text> stays readable text, not a 0x0 SVG element');

/**
 * **A vouch does not exempt a raw-text element holding a static ELEMENT.** `hasComponent` walks the
 * subtree and so never asks about the ROOT itself; before a sibling could vouch, `<title>` could not
 * be a root at all, so the gap was unreachable. Vouching made it reachable, and the shape went
 * straight into the scan/parse disagreement: a dead `@click="$v…$"`, a lost binding, a throwing
 * spread, and a diagnostic blaming the parser for dropping an element that is plainly there.
 * `<style>` and `<script>` are the same names one step over.
 */
const rawRoots = transformJsx(
  `export const a = ({ F, f }) => <F><title><tspan onClick={f}>S</tspan></title><path d="M0" /></F>;
   export const b = ({ F, p }) => <F><title><tspan {...p} /></title><path d="M0" /></F>;
   export const c = ({ F, f }) => <F><style><b onClick={f}>x</b></style><path d="M0" /></F>;
   export const d = ({ F }) => <F><title>Close</title><path d="M0" /></F>;
   export const e = ({ F, l }) => <F><title>{l}</title><path d="M0" /></F>;`,
  'raw.jsx',
  { inject: false }
);
for (const [name, tag] of [['a', 'title'], ['b', 'title'], ['c', 'style']])
  assert.ok(
    new RegExp(`${name} = .*children: \\[html\`<${tag}`).test(rawRoots),
    `a static element inside <${tag}> refuses even when a sibling vouches (${name})`
  );
assert.ok(/d = .*children: \[svg`<title/.test(rawRoots), 'CONTROL: text-only <title> still upgrades');
assert.ok(/e = .*children: \[svg`<title/.test(rawRoots), 'CONTROL: a bound <title> still upgrades');

/**
 * **A sibling the compiler REFUSES cannot vouch for the others**, or one authored group is emitted
 * in two namespaces — the `<g>` kept as HTML for its custom element while the `<text>` beside it is
 * upgraded on the word of that same `<g>`. `<text>` is the content-bearing name whose whole
 * exclusion rationale then applies with no surviving SVG sibling to justify it.
 */
const vouchers = transformJsx(
  `export const a = ({ F }) => <F><text>L</text><g><my-card /></g></F>;
   export const b = ({ F }) => <F><text>L</text><g><circle r="1" /></g></F>;`,
  'vo.jsx',
  { inject: false }
);
assert.ok(/a = .*children: \[html`<text/.test(vouchers), 'a refused sibling does not vouch — the group agrees');
assert.ok(/b = .*children: \[svg`<text/.test(vouchers), 'CONTROL: a sibling that survives does vouch');

/** camelCase stays out even with a sibling: its hazard is SSR casing, which a sibling cannot speak to. */
const camel = transformJsx(
  `const F = ({ children }) => <svg>{children}</svg>;
   export const a = () => <F><clipPath id="c" /><path d="M0" /></F>;`,
  'cam.jsx',
  { inject: false }
);
assert.ok(/html`<clipPath/.test(camel), 'a camelCase name is not vouched for — the browser lowercases it outside <svg>');

/**
 * **An injected import must not collide with a name the module CONTAINS**, in any spelling.
 *
 * A duplicate declaration makes the whole file a `SyntaxError` — caught and logged in a browser, so
 * the page simply does nothing. The hole was always there for `html`; the root upgrade is what made
 * it reachable from ordinary icon JSX, which is why it surfaced with `svg`.
 *
 * Each case below was a dead module under the DECLARATION scan that shipped one round earlier, and
 * together they are why that approach was abandoned rather than widened: a regex for
 * `const|let|var|function|class NAME` cannot see a destructured binding, a second declarator, or —
 * fatally — a PARAMETER, which shadows the module-scope import and throws at the first render.
 */
for (const [shape, src] of [
  ['a plain declaration', 'const svg = 1;'],
  ['an object pattern — the buildless CDN idiom', 'const { html, svg, render } = vera;'],
  ['an array pattern', 'const [svg, setSvg] = useState();'],
  ['a second declarator', 'let q, svg;'],
]) {
  const out = transformJsx(`${src}\nexport const a = <path d="M0" />;`, 'cl.jsx', { inject: true });
  assert.match(out, /import \{ svg as \$veraSvg \}/, `the local binding is renamed, never the export: ${shape}`);
  assert.ok(/a = \$veraSvg`/.test(out), `and the call site uses the name the import bound: ${shape}`);
}

/** A PARAMETER is the one a declaration scan can never reach, and it throws rather than failing to parse. */
const param = transformJsx('export const Icon = ({ svg }) => <path d={svg} />;', 'pa.jsx', { inject: true });
assert.match(param, /import \{ svg as \$veraSvg \}/, 'a parameter shadows a module-scope import, so it counts');
assert.ok(/=> \$veraSvg`/.test(param), 'the tag is the injected name');
assert.ok(/d=\$\{svg\}/.test(param), "and the parameter's own value still reaches the binding");

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
  `import { $veraSvg } from './h.js';\nconst svg = 1;\nexport const a = <path d="M0" />;`,
  'tk.jsx',
  { inject: true }
);
assert.match(taken, /import \{ svg as \$veraSvg2 \}/, 'a taken alias is bumped rather than collided with');

/**
 * CONTROLS. A module that never mentions the name keeps the clean one — which is the common case
 * and the reason this is not simply always-prefixed.
 */
/**
 * **A TypeScript ANNOTATION is a binding, and is spelled exactly like an object key up to the `:`.**
 * `.tsx` is a first-class input, so excluding keys quietly excluded every annotated binding —
 * `let svg: SVGSVGElement` collided with the injected import, and `function draw(svg: Element)`
 * shadowed it for `svg is not a function`. What separates them is what comes BEFORE the name.
 */
for (const [shape, src] of [
  ['an annotated let', 'let svg: SVGSVGElement;'],
  ['an annotated const', 'const svg: Element = q();'],
  ['an annotated parameter', 'function draw(svg: Element) { return 1; }'],
]) {
  const typed = transformJsx(`${src}\nexport const v = () => <path d="M0" />;`, 't.tsx', { inject: true });
  assert.match(typed, /import \{ svg as \$veraSvg \}/, `${shape} is a binding, so the import is renamed`);
}
const keyed2 = transformJsx('const o = { svg: 1 };\nexport const v = () => <path d="M0" />;', 'k.tsx', { inject: true });
assert.match(keyed2, /import \{ svg \} from/, 'CONTROL: an object KEY still binds nothing');

/**
 * A name that appears only inside a STRING, a comment or a template literal is not a binding, and
 * renaming for it is noise. The scan blanks literal contents to see that — which it must do with a
 * character walk, since `` `A ${`B`} C` `` inverts any non-recursive pattern and leaks B.
 */
for (const [shape, src] of [
  ['a string', 'const d = "svg";'],
  ['a line comment', '// svg goes here'],
  ['a block comment', '/* svg goes here */'],
  ['a template literal', 'const d = `a svg here`;'],
  ['a NESTED template literal', 'const d = `a ${`svg`} here`;'],
]) {
  const quiet = transformJsx(`${src}\nexport const a = <path d="M0" />;`, 'q.jsx', { inject: true });
  assert.match(quiet, /import \{ svg \} from/, `${shape} is not a binding, so the name is untouched`);
  assert.ok(/a = svg`/.test(quiet), `${shape}: and so is the call site`);
}

const noClash = transformJsx(`export const a = <path d="M0" />;`, 'nc.jsx', { inject: true });
assert.match(noClash, /import \{ svg \} from/, 'CONTROL: nothing to collide with, so the name is untouched');
assert.ok(/a = svg`/.test(noClash), 'CONTROL: and so is the call site');

const owned = transformJsx(`const svg = 1;\nexport const a = <path d="M0" />;`, 'ow.jsx', { inject: false });
assert.ok(/a = svg`/.test(owned), 'CONTROL: with inject:false the caller owns the bindings, so nothing is renamed');
assert.ok(!owned.includes('import'), 'CONTROL: and nothing is injected');

/**
 * A custom element is the discriminator here on purpose: an SVG-only name like `<circle>` is a
 * ROOT in its own expression template, so the root upgrade fires and masks what child mode did.
 */
assert.ok(/flag && svg`<my-badge/.test(titleMode), 'CONTROL: inside <g> it is genuinely SVG-namespaced');

/**
 * **An island flips its CHILDREN back to HTML, but its own ATTRIBUTES are emitted in the outer
 * namespace** — so exempting the island from the walk skipped the one thing that reaches them.
 * `<g><desc onClick={() => hook(<icon-badge/>)}>` built the badge SVG-namespaced and permanently
 * inert. The exemption and the attribute walk were added one round apart, and the second undid part
 * of the first.
 */
const islandAttrs = transformJsx(
  `export const a = () => <g><desc onClick={() => h(<icon-badge />)}>d</desc></g>;
   export const b = () => <g><desc>{c && <my-card />}</desc></g>;`,
  'ia.jsx',
  { inject: false }
);
assert.ok(/a = \(\) => html`<g><desc/.test(islandAttrs), "an island's own attribute JSX is still checked");
assert.ok(/b = \(\) => svg`<g><desc/.test(islandAttrs), 'CONTROL: a component in its CHILDREN is still safe');

/**
 * **Islands are per-namespace.** `<desc>` is an HTML integration point inside `<svg>` and NOT inside
 * `<math>`; MathML's own are its token elements. One list applied to both flipped `<math><desc>` to
 * HTML — where the compiler then emitted markup its own renderer warns about — and never flipped
 * `<math><mtext>`, leaving a custom element there MathML-namespaced and permanently inert.
 */
const perNamespace = transformJsx(
  `export const a = () => <math><mtext>{c && <my-card />}</mtext></math>;
   export const b = () => <math><desc>{c && <my-card />}</desc></math>;
   export const c = () => <svg><desc>{c && <my-card />}</desc></svg>;`,
  'ns.jsx',
  { inject: false }
);
const innerTag = (name) =>
  new RegExp(`${name} = [^;]*?(svg|mathml|html)\`<my-card`, 's').exec(perNamespace)?.[1];
assert.equal(innerTag('a'), 'html', "MathML's token elements flip to html`` — they are its integration points");
assert.equal(innerTag('b'), 'mathml', '<desc> inside <math> does NOT flip — it is not one there');
assert.equal(innerTag('c'), 'html', 'CONTROL: <desc> inside <svg> does flip');

/**
 * A FRAGMENT root inside an expression was refused by accident: `cannotSurviveSvg('')` is `true`,
 * because `!/^[a-z]/.test('')` is `true`, so the `?? ''` written to let a fragment fall through to
 * the subtree walk short-circuited before reaching it. A very common list shape, silently un-upgraded.
 */
const fragmentInExpression = transformJsx(
  'export const v = () => <g>{rows.map((r) => <><path d={r} /><circle r="2" /></>)}</g>;',
  'fie.jsx',
  { inject: false }
);
assert.ok(/=> svg`<g>/.test(fragmentInExpression), 'a fragment root inside an expression upgrades');

/**
 * `foreignObject` is excluded although SVG owns the name: carrying visible HTML is its entire
 * purpose, so outside an `<svg>` it loses exactly what `<text>` would. The camelCase names are
 * excluded for a different reason — `@verajs/ssr` emits them verbatim and a browser parses them
 * lowercased outside an `<svg>`, so hydration would discard the server's markup and rebuild.
 */
const excluded = transformJsx(
  `export const a = () => <Box><foreignObject><p>x</p></foreignObject></Box>;
   export const b = () => <Box><clipPath id="c" /></Box>;
   export const c = () => <Box><circle r="1" /></Box>;`,
  'excl.jsx',
  { inject: false }
);
assert.ok(/html`<foreignObject/.test(excluded), '<foreignObject> stays html`` — its content is HTML');
assert.ok(/html`<clipPath/.test(excluded), 'and camelCase names stay html`` — SSR and the parser must agree');
assert.ok(/svg`<circle/.test(excluded), 'CONTROL: an included name in the same compile still upgrades');

/**
 * The names SVG shares with HTML are deliberately absent: guessing would break real HTML, and
 * omitting a name is CONSERVATIVE — it falls back to the previous behaviour rather than mis-tagging.
 * `@verajs/renderer` names those at runtime in development instead.
 */
/**
 * A `<>…</>` root has no tag of its own, so it takes the answer from its children — the one form of
 * "handed to a component" that stayed broken after the first pass, and silent because the runtime
 * net cannot see a namespace the parser never applied.
 */
const fragmentRoot = transformJsx(
  'export const v = () => <Frame><><path d="M0 0h1" /><circle r="1" /></></Frame>;',
  'frag.jsx',
  { inject: false }
);
assert.ok(/svg`<path /.test(fragmentRoot), 'a fragment root of SVG-only children compiles with svg``');
const mixedFragment = transformJsx(
  'export const v = () => <Frame><><path d="M0 0h1" /><div>text</div></></Frame>;',
  'mixed.jsx',
  { inject: false }
);
assert.ok(
  /html`<path /.test(mixedFragment),
  'a MIXED fragment stays html`` — one HTML child means the whole root cannot be assumed SVG'
);
assert.ok(
  /svg`<path /.test(fragmentRoot),
  'CONTROL: without this the mixed case passes with the feature DISABLED, since html`` is what the ' +
    'un-upgraded compiler produces for both'
);

/**
 * **The set excludes names that carry visible content as unknown HTML**, because the upgrade fires
 * on the root tag alone and so also applies to a template bound for an HTML parent.
 * `<Box><text>hello</text></Box>` was readable text before and would be a 0×0 SVG element after.
 * Omitting a name is conservative; including a wrong one is not.
 */
const contentBearing = transformJsx(
  `export const v = () => <Box><text>hello</text><desc>d</desc></Box>;
   export const w = () => <Box><rect width="1" /></Box>;`,
  'content.jsx',
  { inject: false }
);
assert.ok(/html`<text>/.test(contentBearing), '<text> is NOT upgraded — it renders content as HTML');
assert.ok(/html`<desc>/.test(contentBearing), 'nor is <desc>, for the same reason');
assert.ok(/svg`<rect/.test(contentBearing), 'CONTROL: an included name in the same compile still upgrades');

const ambiguous = transformJsx(
  `export const v = () => <Box><a href="/x">link</a><title>Doc</title></Box>;
   export const w = () => <Box><polygon points="0,0" /></Box>;`,
  'amb.jsx',
  { inject: false }
);
assert.ok(/html`<a href/.test(ambiguous), '<a> stays html`` — SVG shares the name with real HTML');
assert.ok(/html`<title>/.test(ambiguous), '<title> stays html`` for the same reason');
assert.ok(
  /svg`<polygon/.test(ambiguous),
  'CONTROL: without this the block passes with the feature DISABLED — both assertions above are ' +
    'negative, which is exactly what the un-upgraded compiler produces'
);

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
