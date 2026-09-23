/**
 * Every sibling group the namespace rule can be handed, compiled AND RENDERED, with the namespace of
 * the element under test asserted in both wrappers.
 *
 * **Sibling inference is where the defects clustered once the name rule had a corpus under it.** A
 * root tag alone cannot prove SVG context, so a sibling vouches — and each round found another shape
 * where that vouch reached somewhere it should not: a raw-text element holding a static child, a
 * voucher the compiler was itself refusing, a camelCase name whose hazard is SSR casing rather than
 * context. Enumerating the groups ends that the way `jsx-name-corpus` ended the name class.
 *
 * **The wrapper deliberately does NOT change the answer, and the rows say so.** `Frame` renders an
 * `<svg>` and `Box` a `<div>`, and a vouched `<title>` compiles `` svg`…` `` in both — the tag comes
 * from the group, and where the group LANDS is unknowable at compile time. That is the accepted
 * limit, not an oversight, so `Box` appears here as a second alone-control rather than as a
 * contrast. Those alone rows are what keep the exclusions meaningful: without them
 * `<text>hello</text>` quietly becoming a 0x0 SVG element would pass.
 */
import { load } from './dist.mjs';
import { JSDOM } from 'jsdom';
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node',
  'Element', 'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event',
  'CustomEvent', 'SVGElement'])
  globalThis[key] = dom.window[key];
const { transformJsx } = await load('jsx');
const { renderInto } = await load('renderer');

test('every sibling group renders in the namespace the rule promises', async () => {
  const SVG = 'http://www.w3.org/2000/svg';

  const silence = console.warn;
  console.warn = () => {};
  const dir = mkdtempSync(join(process.cwd(), 'node_modules', '.ns-corpus-'));
  let n = 0;
  const compile = async (body) => {
    const src = `const Frame = ({ children }) => <svg viewBox="0 0 24 24">{children}</svg>;
const Box = ({ children }) => <div class="box">{children}</div>;
export const view = () => ${body};`;
    const f = join(dir, `m${n++}.mjs`);
    writeFileSync(f, transformJsx(src, 'ns.jsx', { inject: true }));
    return (await import(pathToFileURL(f).href)).view;
  };

  /**
   * The COMPLETE lists from `packages/jsx/src/transform.ts` — `SVG_WITH_SIBLING`, `SVG_ELEMENTS`, and
   * the camelCase names excluded even under a vouch. Complete on purpose: a sample would have let a
   * name join the transform's set without ever being crossed against anything here, which is the
   * gap this suite exists to close. Adding a name there means adding it here, and the guard below
   * reads the transform's own sets so that drift fails loudly in BOTH directions.
   */
  const VOUCHABLE = ['title', 'a', 'style', 'script', 'image', 'font', 'text', 'tspan', 'desc',
    'metadata', 'switch', 'view', 'set', 'filter', 'mask', 'marker', 'pattern', 'symbol'];
  const SELF = ['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'g', 'defs',
    'use', 'stop', 'animate', 'mpath'];
  const CAMEL = ['clipPath', 'linearGradient', 'radialGradient', 'animateTransform', 'animateMotion',
    'foreignObject', 'textPath'];

  /**
   * **The guard reads the transform's own sets**, because asserting the length of the literals above
   * checks the test against itself. Measured: adding a name to `SVG_WITH_SIBLING` left
   * `VOUCHABLE.length` at 18, no row crossed the new name, and the suite stayed green — only REMOVAL
   * was caught, which is the direction the header did not claim.
   */
  const source = readFileSync(new URL('../packages/jsx/src/transform.ts', import.meta.url), 'utf8');
  const namesIn = (constant) => {
    const at = source.indexOf(`const ${constant} = new Set([`);
    assert.ok(at > 0, `${constant} is not a Set literal any more — this guard needs rewriting`);
    return [...source.slice(at, source.indexOf(']);', at)).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  };
  assert.deepEqual(
    [...VOUCHABLE].sort(),
    namesIn('SVG_WITH_SIBLING').sort(),
    'SVG_WITH_SIBLING drifted from the list this suite crosses — add the name here too'
  );
  assert.deepEqual(
    [...SELF].sort(),
    namesIn('SVG_ELEMENTS').sort(),
    'SVG_ELEMENTS drifted from the list this suite crosses — add the name here too'
  );


  const bad = [];
  const check = async (label, body, probe, wrapper, expected) => {
    let view;
    try { view = await compile(body); } catch (e) { bad.push(`${label}: transform/import threw ${e.message.slice(0,50)}`); return; }
    const host = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(host);
    try { renderInto(view(), host); } catch (e) { bad.push(`${label}: render threw ${e.message.slice(0,50)}`); return; }
    /**
     * `<image>` is the one name the HTML parser RENAMES: parsed as HTML it becomes `<img>`, while in
     * the SVG namespace it stays `<image>`. So the lookup accepts either spelling and the namespace
     * assertion still does the work — which is the point, since the rename is itself evidence the
     * element was built as HTML.
     */
    const names = probe === 'image' ? ['image', 'img'] : [probe.toLowerCase()];
    const el = [...host.querySelectorAll('*')].find((e) => names.includes(e.localName.toLowerCase()));
    if (el === undefined) { bad.push(`${label}: <${probe}> missing from the DOM`); return; }
    const got = el.namespaceURI === SVG ? 'SVG' : 'HTML';
    if (got !== expected) bad.push(`${label}: <${probe}> in ${wrapper} is ${got}, expected ${expected}`);
  };

  for (const v of VOUCHABLE) {
    for (const s of SELF) {
      await check(`${v}+${s} in Frame`, `<Frame><${v}>x</${v}><${s} /></Frame>`, v, 'Frame', 'SVG');
      await check(`frag ${v}+${s}`, `<Frame><><${v}>x</${v}><${s} /></></Frame>`, v, 'Frame', 'SVG');
    }
    await check(`${v} alone in Frame`, `<Frame><${v}>x</${v}></Frame>`, v, 'Frame', 'HTML');
    await check(`${v} alone in Box`, `<Box><${v}>x</${v}></Box>`, v, 'Box', 'HTML');
  }
  /** The shapes round 10 broke: a raw-text root with a static element, and a voucher that is refused. */
  for (const raw of ['title', 'style', 'script']) {
    await check(`${raw} + static element`, `<Frame><${raw}><b>x</b></${raw}><path d="M0" /></Frame>`, raw, 'Frame', 'HTML');
    await check(`${raw} + text CONTROL`, `<Frame><${raw}>x</${raw}><path d="M0" /></Frame>`, raw, 'Frame', 'SVG');
  }
  /**
   * The other three names the RENDERER scans as raw text. They are not vouchable, so they only reach
   * the guard NESTED under a self-proving root — where `refusesSvg` runs at every depth. Scoped to
   * the vouchable three, the guard let these upgrade into the scan/parse disagreement: the `<b>`
   * relocated out, its sigil stranded as a dead attribute, the binding never committed.
   */
  for (const raw of ['textarea', 'iframe', 'noscript']) {
    await check(`${raw} nested + static element`, `<Frame><g><${raw}><b>x</b></${raw}></g><path d="M0" /></Frame>`, 'g', 'Frame', 'HTML');
    await check(`${raw} nested + text CONTROL`, `<Frame><g><${raw}>x</${raw}></g><path d="M0" /></Frame>`, 'g', 'Frame', 'SVG');
  }
  await check('refused voucher', `<Frame><text>L</text><g><my-card /></g></Frame>`, 'text', 'Frame', 'HTML');
  await check('surviving voucher', `<Frame><text>L</text><g><circle r="1" /></g></Frame>`, 'text', 'Frame', 'SVG');
  /** A component or custom element among the siblings is dispatched on its own and changes nothing
   *  about what the <path> proves; only a refused VOUCHER withdraws the vouch. */
  await check('component sibling', `<Frame><text>L</text><Box>x</Box><path d="M0" /></Frame>`, 'text', 'Frame', 'SVG');
  await check('custom element sibling', `<Frame><text>L</text><my-badge /><path d="M0" /></Frame>`, 'text', 'Frame', 'SVG');
  await check('custom element stays HTML', `<Frame><text>L</text><my-badge /><path d="M0" /></Frame>`, 'my-badge', 'Frame', 'HTML');
  await check('expression sibling only', `<Frame><text>L</text>{1 && 2}</Frame>`, 'text', 'Frame', 'HTML');
  /**
   * An EXPRESSION vouches through its own roots — `{items.map((i) => <path/>)}` beside a `<title>` is
   * how a repeated-shape icon is written. Three states, as everywhere: a root that is not SVG-only
   * disproves, and no roots at all proves nothing. The row above uses `{1 && 2}`, which has no roots,
   * so it passes whether expressions can vouch or not — it pins the third state, not the first.
   */
  await check('expression voucher', `<Frame><title>T</title>{[1].map((i) => <path key={i} d="M0" />)}</Frame>`, 'title', 'Frame', 'SVG');
  await check('mixed expression does not vouch', `<Frame><title>T</title>{1 ? <path d="M0" /> : <div />}</Frame>`, 'title', 'Frame', 'HTML');
  /**
   * ...and the MIRROR: a vouchable name INSIDE an expression is vouched by a sibling outside it.
   * `{labels.map((t) => <text>{t}</text>)}` beside a static `<path>` is how a labelled icon is
   * written, and without this every `<text>` was a 0x0 `HTMLUnknownElement` — silent in production.
   */
  await check('expression vouchee', `<Frame><path d="M0" />{[1].map((i) => <text key={i}>L</text>)}</Frame>`, 'text', 'Frame', 'SVG');
  await check('fragment root inside an expression vouches', `<Frame><title>T</title>{1 ? <><path d="M0" /></> : null}</Frame>`, 'title', 'Frame', 'SVG');
  await check('CONTROL expression alone', `<Frame>{[1].map((i) => <text key={i}>L</text>)}</Frame>`, 'text', 'Frame', 'HTML');
  /**
   * A nested FRAGMENT vouches through its own children — `fragmentProof` answers that question and a
   * fragment is not a namespace boundary. This row asserted HTML while the component path asked only
   * about direct element children, which pinned the SPLIT: all-SVG as a fragment root, divided under
   * a component. Both halves are asserted now, because pinning one of them is what hid it.
   */
  await check('nested fragment vouch', `<Frame><text>L</text><><path d="M0" /></></Frame>`, 'text', 'Frame', 'SVG');
  await check('nested fragment vouch: the shape', `<Frame><text>L</text><><path d="M0" /></></Frame>`, 'path', 'Frame', 'SVG');
  await check('fragment proving nothing', `<Frame><text>L</text><><b>x</b></></Frame>`, 'text', 'Frame', 'HTML');
  /**
   * A fragment must be vouchable BY a sibling as well as vouching FOR one, or the same group answers
   * differently depending on which side the fragment is written on.
   */
  await check('fragment vouched by a sibling', `<Frame><path d="M0" /><><title>L</title></></Frame>`, 'title', 'Frame', 'SVG');
  await check('fragment vouched at depth', `<Frame><path d="M0" /><><><title>L</title></></></Frame>`, 'title', 'Frame', 'SVG');
  /**
   * An ISLAND root keeps its exemption: a component inside a vouched `<title>`'s EXPRESSION is safe,
   * because `childMode` has already compiled it `html`. Restating the refusal conditions at the root
   * instead of asking `refusesSvg` lost this branch.
   */
  await check('island root, expr component', `<Frame><path d="M0" /><title>{<my-card />}</title></Frame>`, 'title', 'Frame', 'SVG');
  await check('island root, the component', `<Frame><path d="M0" /><title>{<my-card />}</title></Frame>`, 'my-card', 'Frame', 'HTML');
  await check('desc island root', `<Frame><path d="M0" /><desc>{<my-card />}</desc></Frame>`, 'desc', 'Frame', 'SVG');
  /**
   * The island rule needs an UPGRADEABLE root to be reached at all. Probed at the top level,
   * `<foreignObject>` is camelCase — in neither set — so the root is refused before
   * `SVG_INTEGRATION_POINTS` is ever consulted, and the row passed with that set emptied. Nesting it
   * under a `<g>` is what puts the island on the path: the `<g>` upgrades, and its island keeps the
   * `<b>` HTML.
   */
  await check('island keeps HTML', `<Frame><g><foreignObject><b>x</b></foreignObject></g><path d="M0" /></Frame>`, 'b', 'Frame', 'HTML');
  await check('island CONTROL: the g', `<Frame><g><foreignObject><b>x</b></foreignObject></g><path d="M0" /></Frame>`, 'g', 'Frame', 'SVG');

  for (const c of CAMEL)
    await check(`camel ${c}+path`, `<Frame><${c} id="c" /><path d="M0" /></Frame>`, c, 'Frame', 'HTML');
  for (const s of SELF) await check(`${s} alone`, `<Frame><${s} /></Frame>`, s, 'Frame', 'SVG');

  console.warn = silence;
    rmSync(dir, { recursive: true, force: true });
    assert.ok(n > 120, `the matrix built ${n} modules, which is too few to mean anything`);
    assert.deepEqual(bad, [], `groups that rendered in the wrong namespace:\n  ${bad.slice(0, 10).join('\n  ')}`);
    console.log(`jsx namespace corpus: ${n} sibling groups compiled, rendered and checked`);
  });
