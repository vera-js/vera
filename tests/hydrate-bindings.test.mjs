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

  /**
   * Single quotes are legal everywhere double quotes are, and the client supports them because it
   * hands markup to the platform's parser. The server only knew `"`, so a `.value='${…}'` set a
   * property in the browser and emitted a literal attribute named `.value` on the server.
   */
  "single-quoted attribute": "html`<p><b id=\"probe\" title='${state.text}'>x</b></p>`",
  "single-quoted form property": "html`<p><b id=\"probe\">x</b><input .value='${state.text}' /></p>`",
  "single-quoted boolean, true": "html`<p><b id=\"probe\" ?hidden='${true}'>x</b></p>`",
  "single-quoted boolean, false": "html`<p><b id=\"probe\" ?hidden='${false}'>x</b></p>`",
  "single-quoted event": "html`<p><b id=\"probe\" @click='${() => {}}'>x</b></p>`",
  "single-quoted onClick": "html`<p><b id=\"probe\" onClick='${() => {}}'>x</b></p>`",

  /**
   * Value kinds the server used to drop entirely. Whether any of these is a sensible thing to
   * interpolate is beside the point — the two sides disagreeing is a silent hydration mismatch,
   * and matching junk beats differing junk.
   */
  'text: a Date': 'html`<p><b id="probe">x</b>${new Date(0)}</p>`',
  'text: an object with toString': 'html`<p><b id="probe">x</b>${{ toString: () => "T" }}</p>`',
  'text: a plain object': 'html`<p><b id="probe">x</b>${{ a: 1 }}</p>`',
  'text: a Set': 'html`<p><b id="probe">x</b>${new Set([1, 2])}</p>`',
  'text: a Map': 'html`<p><b id="probe">x</b>${new Map([[1, 2]])}</p>`',
  /** A colon is legal in an attribute name — `xml:lang`, `xlink:href`. */
  'attribute with a colon': 'html`<p><b id="probe" xml:lang=${state.text}>x</b></p>`',
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
const { renderInto } = await load('renderer/hydrate');
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

/**
 * Identity is necessary but not sufficient: adoption succeeds whenever the *statics* line up, so a
 * value the two sides disagree about slips through. `title=${null}` did exactly that — the server
 * wrote `title=""` where the client removes the attribute, and this matrix passed it for months of
 * this session because the surrounding markup matched. These check the resolved values too.
 */
const VALUES = {
  'attribute, nullish removes': (container) =>
    !container.querySelector('#probe').hasAttribute('title') || 'title survived a nullish value',
  'text: false': (container) => container.textContent.includes('false') || 'false did not render',
  'text: zero': (container) => container.textContent.includes('0') || '0 did not render',
  'text: null': (container) => container.textContent === 'x' || 'null rendered something',
  'boolean, true': (container) => container.querySelector('#probe').hasAttribute('hidden') || 'not hidden',
  'boolean, false': (container) => !container.querySelector('#probe').hasAttribute('hidden') || 'hidden anyway',
  'text: an object with toString': (c) => c.textContent.includes('T') || 'toString ignored',
  'text: a plain object': (c) => c.textContent.includes('[object Object]') || 'not stringified',
  'text: a Set': (c) => c.textContent.includes('12') || 'set not iterated',
  'text: a Map': (c) => c.textContent.includes('12') || 'map not iterated',
  'attribute with a colon': (c) =>
    c.querySelector('#probe').getAttribute('xml:lang') === 'hello & <world>' || 'colon attribute wrong',
};

for (const [name, markup] of Object.entries(serverMarkup)) {
  const container = dom.window.document.createElement('div');
  container.innerHTML = markup;
  const probe = container.querySelector('#probe');
  assert.ok(probe, `${name}: the server markup has no probe element — ${markup}`);

  renderInto(clientTemplates[name](), container);

  if (container.querySelector('#probe') !== probe) {
    failures.push(`${name}\n      server: ${markup}\n      client: ${container.innerHTML.replace(/<!--[^>]*-->/g, '')}`);
    continue;
  }
  const value = VALUES[name]?.(container);
  if (value !== undefined && value !== true) failures.push(`${name}: adopted but ${value}\n      server: ${markup}`);
  else pass++;
}

/**
 * Same input, same bytes — a server that answers differently on the second request cannot be
 * cached, and a difference here is a hydration mismatch waiting for the right traffic.
 */
{
  const repeat = JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', serverScript], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
    })
  );
  for (const [name, markup] of Object.entries(serverMarkup)) {
    if (repeat[name] !== markup) failures.push(`${name}: not deterministic\n      once: ${markup}\n      again: ${repeat[name]}`);
  }
}

if (failures.length) {
  console.log(`\n  ${failures.length} binding(s) fell back instead of adopting:\n`);
  for (const failure of failures) console.log('    ' + failure + '\n');
}
console.log(`hydration matrix: ${pass}/${Object.keys(CASES).length} bindings adopted`);
if (failures.length) process.exit(1);
