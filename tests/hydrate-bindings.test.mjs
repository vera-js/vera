/**
 * Every binding kind, server-rendered and then adopted — the matrix `tests/hydrate.test.mjs`
 * samples a corner of.
 *
 * The assertion that matters is **identity**, not output. A hydration mismatch is silent by design:
 * the container is cleared and rendered fresh, so the page looks right and the whole point of
 * server rendering is gone. Every case here captures a node from the server markup and checks that
 * same node is still in the document afterwards.
 *
 * The server half runs in a subprocess because `@verajs/ssr` installs DOM globals that jsdom's
 * would fight over.
 */
import { load } from './dist.mjs';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';

/** name -> the template source, used verbatim on both sides so the call sites cannot drift. */
const CASES = {
  'text': 'html`<p><b id="probe">x</b>${state.text}</p>`',
  'text, several slots': 'html`<p><b id="probe">x</b>${state.text} and ${state.count}</p>`',
  'text: zero': 'html`<p><b id="probe">x</b>${0}</p>`',
  'text: false': 'html`<p><b id="probe">x</b>${false}</p>`',
  'text: null': 'html`<p><b id="probe">x</b>${null}</p>`',
  'attribute, quoted': 'html`<p><b id="probe" title="${state.text}">x</b></p>`',
  'attribute, unquoted': 'html`<p><b id="probe" title=${state.text}>x</b></p>`',
  'attribute, several slots': 'html`<p><b id="probe" class="a ${state.text} c">x</b></p>`',
  'attribute, nullish removes': 'html`<p><b id="probe" title=${null}>x</b></p>`',
  'boolean, true': 'html`<p><b id="probe" ?hidden=${true}>x</b></p>`',
  'boolean, false': 'html`<p><b id="probe" ?hidden=${false}>x</b></p>`',
  'form property .value': 'html`<p><b id="probe">x</b><input .value=${state.text} /></p>`',
  'form property .checked': 'html`<p><b id="probe">x</b><input type="checkbox" .checked=${true} /></p>`',
  'plain property, dropped': 'html`<p><b id="probe" .someProp=${state.text}>x</b></p>`',
  'event binding, dropped': 'html`<p><b id="probe" @click=${() => {}}>x</b></p>`',
  'onClick binding, dropped': 'html`<p><b id="probe" onClick=${() => {}}>x</b></p>`',
  'nested template': 'html`<p><b id="probe">x</b>${html`<em>${state.text}</em>`}</p>`',
  'list': 'html`<ul><li id="probe">x</li>${state.rows.map((row) => html`<li>${row}</li>`)}</ul>`',
  'empty list': 'html`<ul><li id="probe">x</li>${[]}</ul>`',
  'text that looks like an attribute': 'html`<p><b id="probe">x</b>total=${state.count}</p>`',
};

const STATE = "{ text: 'hello & <world>', count: 3, rows: ['a', 'b'] }";

/** One subprocess renders every case, so the cost is paid once. */
const serverScript = `
import { serializeTemplate } from '@verajs/ssr/vera';
const { html } = await import('@verajs/core');
const state = ${STATE};
const out = {};
${Object.entries(CASES).map(([name, tpl]) => `out[${JSON.stringify(name)}] = serializeTemplate(${tpl});`).join('\n')}
process.stdout.write(JSON.stringify(out));
`;
const serverMarkup = JSON.parse(
  execFileSync(process.execPath, ['--input-type=module', '-e', serverScript], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  })
);

const dom = new JSDOM('<div id="root"></div>');
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;
const { render } = await load('renderer/hydrate');
const html = (strings, ...values) => ({ strings, values });
const state = { text: 'hello & <world>', count: 3, rows: ['a', 'b'] };

/** Rebuilt on the client from the same source, via the same tag, so the call sites match. */
const clientTemplates = new Function(
  'html',
  'state',
  `return { ${Object.entries(CASES)
    .map(([name, tpl]) => `${JSON.stringify(name)}: () => ${tpl}`)
    .join(',\n')} };`
)(html, state);

let pass = 0;
const failures = [];

for (const [name, markup] of Object.entries(serverMarkup)) {
  const container = dom.window.document.createElement('div');
  container.innerHTML = markup;
  const probe = container.querySelector('#probe');
  assert.ok(probe, `${name}: the server markup has no probe element — ${markup}`);

  render(clientTemplates[name](), container);

  if (container.querySelector('#probe') === probe) pass++;
  else failures.push(`${name}\n      server: ${markup}\n      client: ${container.innerHTML.replace(/<!--[^>]*-->/g, '')}`);
}

if (failures.length) {
  console.log(`\n  ${failures.length} binding(s) fell back instead of adopting:\n`);
  for (const failure of failures) console.log('    ' + failure + '\n');
}
console.log(`hydration matrix: ${pass}/${Object.keys(CASES).length} bindings adopted`);
if (failures.length) process.exit(1);
