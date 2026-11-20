/**
 * One DOM's answers for tests/hook-labelled-ssr.test.mjs: the same labelled() calls against jsdom or against
 * @verajs/ssr's DOM shim, printed as JSON (each element's attributes, and the diagnostic codes said). Run in its own
 * process per DOM, because the shim installs globals:
 *   node [--conditions development] tests/fixtures/labelled-dom-cases.mjs jsdom|shim
 */
import { load } from '../dist.mjs';

const which = process.argv[2];

let make;
if (which === 'jsdom') {
  const { JSDOM } = await import('jsdom');
  make = () => {
    const dom = new JSDOM('<!doctype html><body></body>');
    for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Element', 'ShadowRoot']) globalThis[key] = dom.window[key];
    return dom.window.document;
  };
} else {
  await import('../../packages/ssr/dist/vera/index.js');
  make = () => {
    for (const child of [...document.body.childNodes]) child.remove();
    return document;
  };
}
const { labelled } = await load('vera-hooks/labelled');
const said = [];
/** Only each warning's code: the prose is development's, and both DOMs must say the same codes. */
console.warn = (...args) => said.push(String(args[0]).match(/labelled-[a-z-]+/)?.[0] ?? String(args[0]));

const el = (doc, name, attrs = {}) => {
  const node = doc.createElement(name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};
const snap = (nodes) => nodes.map((n) => `${n.localName}${[...n.attributes].map((a) => ` ${a.name}="${a.value}"`).sort().join('')}`);

const CASES = {
  'label for, hint, error shown': (doc) => {
    const [label, input, hint, error] = [el(doc, 'label'), el(doc, 'input'), el(doc, 'p'), el(doc, 'p')];
    label.append(doc.createTextNode('Name'));
    doc.body.append(label, input, hint, error);
    labelled(input, { host: doc.body, label, hint, errors: [error] }).show(error);
    return [label, input, hint, error];
  },
  'non-labelable target': (doc) => {
    const [label, box] = [el(doc, 'label'), el(doc, 'div', { role: 'combobox', tabindex: '0' })];
    doc.body.append(label, box);
    labelled(box, { host: doc.body, label });
    return [label, box];
  },
  'author id skipped': (doc) => {
    const n = (globalThis[Symbol.for('vera.uid')]?.n ?? 0) + 1;
    const [label, input, other] = [el(doc, 'label'), el(doc, 'input'), el(doc, 'span', { id: `vu${n}` })];
    doc.body.append(label, input, other);
    labelled(input, { host: doc.body, label });
    return [label, input];
  },
  'label and control in one shadow root': (doc) => {
    const host = el(doc, 'div');
    doc.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    const [label, input] = [el(doc, 'label'), el(doc, 'input')];
    root.append(label, input);
    labelled(input, { host, label });
    return [label, input];
  },
  'label outside, control in a shadow root': (doc) => {
    const host = el(doc, 'div');
    const label = el(doc, 'label');
    doc.body.append(label, host);
    const root = host.attachShadow({ mode: 'open' });
    const input = el(doc, 'input', { 'aria-label': 'x' });
    root.append(input);
    labelled(input, { host, label });
    return [label, input];
  },
  'wrapping label names the control': (doc) => {
    const label = el(doc, 'label');
    const input = el(doc, 'input');
    const hint = el(doc, 'p');
    label.append(doc.createTextNode('A'), input);
    doc.body.append(label, hint);
    labelled(input, { host: doc.body, hint });
    return [label, input, hint];
  },
};

/** `twice`: the first case rendered as two consecutive server renders of one page, for the determinism row. */
if (process.argv[3] === 'twice') {
  const [run] = Object.values(CASES);
  process.stdout.write(JSON.stringify([snap(run(make())), snap(run(make()))]));
  process.exit(0);
}

const out = {};
for (const [name, run] of Object.entries(CASES)) {
  said.length = 0;
  const doc = make();
  try {
    out[name] = { attrs: snap(run(doc)), said: [...said] };
  } catch (error) {
    out[name] = { threw: String(error && error.message) };
  }
}
process.stdout.write(JSON.stringify(out, null, 1));
