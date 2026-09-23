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
 * The wrappers matter as much as the names: `Frame` renders an `<svg>` and `Box` a `<div>`, so the
 * same child must come out SVG in one and HTML in the other. The alone-in-a-Box rows are the
 * controls that keep the exclusions meaningful — without them `<text>hello</text>` becoming a 0x0
 * SVG element would pass.
 */
import { load } from './dist.mjs';
import { JSDOM } from 'jsdom';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
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

  /** Every element that can appear in a sibling group, and what it must become in each wrapper. */
  const VOUCHABLE = ['title', 'text', 'desc', 'tspan', 'a', 'style', 'marker', 'pattern', 'symbol'];
  const SELF = ['path', 'circle', 'rect', 'g', 'use', 'polyline'];
  const CAMEL = ['clipPath', 'linearGradient'];

  const bad = [];
  const check = async (label, body, probe, wrapper, expected) => {
    let view;
    try { view = await compile(body); } catch (e) { bad.push(`${label}: transform/import threw ${e.message.slice(0,50)}`); return; }
    const host = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(host);
    try { renderInto(view(), host); } catch (e) { bad.push(`${label}: render threw ${e.message.slice(0,50)}`); return; }
    const el = [...host.querySelectorAll('*')].find((e) => e.localName.toLowerCase() === probe.toLowerCase());
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
  await check('refused voucher', `<Frame><text>L</text><g><my-card /></g></Frame>`, 'text', 'Frame', 'HTML');
  await check('surviving voucher', `<Frame><text>L</text><g><circle r="1" /></g></Frame>`, 'text', 'Frame', 'SVG');
  /** A component or custom element among the siblings is dispatched on its own and changes nothing
   *  about what the <path> proves; only a refused VOUCHER withdraws the vouch. */
  await check('component sibling', `<Frame><text>L</text><Box>x</Box><path d="M0" /></Frame>`, 'text', 'Frame', 'SVG');
  await check('custom element sibling', `<Frame><text>L</text><my-badge /><path d="M0" /></Frame>`, 'text', 'Frame', 'SVG');
  await check('custom element stays HTML', `<Frame><text>L</text><my-badge /><path d="M0" /></Frame>`, 'my-badge', 'Frame', 'HTML');
  await check('expression sibling only', `<Frame><text>L</text>{1 && 2}</Frame>`, 'text', 'Frame', 'HTML');
  await check('nested fragment vouch', `<Frame><text>L</text><><path d="M0" /></></Frame>`, 'text', 'Frame', 'HTML');
  await check('island keeps HTML', `<Frame><foreignObject><b>x</b></foreignObject><path d="M0" /></Frame>`, 'b', 'Frame', 'HTML');

  for (const c of CAMEL)
    await check(`camel ${c}+path`, `<Frame><${c} id="c" /><path d="M0" /></Frame>`, c, 'Frame', 'HTML');
  for (const s of SELF) await check(`${s} alone`, `<Frame><${s} /></Frame>`, s, 'Frame', 'SVG');

  console.warn = silence;
    rmSync(dir, { recursive: true, force: true });
    assert.ok(n > 120, `the matrix built ${n} modules, which is too few to mean anything`);
    assert.deepEqual(bad, [], `groups that rendered in the wrong namespace:\n  ${bad.slice(0, 10).join('\n  ')}`);
    console.log(`jsx namespace corpus: ${n} sibling groups compiled, rendered and checked`);
  });
