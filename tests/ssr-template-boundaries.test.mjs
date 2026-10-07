/**
 * **A template is self-contained on the server: whatever it leaves open cannot reach its parent.**
 *
 * The server concatenates what the client parses separately, so a child's END STATE leaked into its parent. The client parses every template on its own and closes whatever
 *    it left open at its end; the server concatenated, so `${html`<svg>`}`, `${html`<!--`}`, `${html`<style>`}` or
 *    `${html`<textarea>`}` changed how the browser read the PARENT's next markup, and a raw-text value there became
 *    elements. The end now closes what the template opened; a template ending inside a tag is refused (the client
 *    drops that tag), and so is a template inside a text-only element — the one place a child's markup could close
 *    its parent's element.
 *
 * Every row is served in its own process and PARSED by jsdom, with scripting off and on.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { JSDOM, VirtualConsole } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const serverScript = `
import { serializeTemplate } from '@verajs/ssr';
import { html, svg } from '@verajs/core';
import { html as tagHtml, tag } from '@verajs/renderer/tag';
const pwn = '</style></script></textarea></title>--></svg></math></noscript></template><img id=pwn src=x onerror=1>';
const quoted = '"><img id=pwn src=x onerror=1>';
/** Each parent sink a leaked state could reach: raw text, a quoted attribute, a URL. */
const sinks = (child) => ({
  style: html\`<div>\${child}<style>\${pwn}</style></div>\`,
  script: html\`<div>\${child}<script>\${pwn}</script></div>\`,
  attribute: html\`<div>\${child}<b title="\${quoted}">x</b></div>\`,
  url: html\`<div>\${child}<a href="\${'javascript:alert(1)'}">x</a></div>\`,
});
const children = {
  svg: html\`<svg>\`,
  math: html\`<math>\`,
  noscript: html\`<noscript>\`,
  noscriptSlash: html\`<noscript/>\`,
  template: html\`<template>\`,
  comment: html\`<!--\`,
  style: html\`<style>\`,
  script: html\`<script>\`,
  textarea: html\`<textarea>\`,
  title: html\`<title>\`,
  xmp: html\`<xmp>\`,
  svgInArray: [html\`<svg>\`],
  svgInIterable: new Set([html\`<svg>\`]),
  svgInHold: { $h: html\`<svg>\` },
  twoDeep: html\`<svg>\${html\`<math>\`}\`,
  svgThenStyle: html\`<svg><style>\`,
};
const run = (make) => { try { return { out: serializeTemplate(make()) }; } catch (error) { return { error: error.message }; } };
const rows = {};
for (const [name, child] of Object.entries(children))
  for (const [sink, template] of Object.entries(sinks(child))) rows[name + ' → ' + sink] = run(() => template);
const refused = {
  endsInTag: run(() => html\`<div>\${html\`<b title="x"\`}</div>\`),
  endsInValue: run(() => html\`<div>\${html\`<b title="\`}</div>\`),
  templateInTextarea: run(() => html\`<textarea>\${html\`</textarea>\`}</textarea>\`),
  templateInTitle: run(() => html\`<title>\${[html\`</title>\`]}</title>\`),
};
const allowed = {
  lessThan: run(() => html\`<p>\${html\`1 < 2\`}<style>\${'.a > .b'}</style></p>\`),
  textareaString: run(() => html\`<textarea>\${'a < b'}</textarea>\`),
  textareaNumber: run(() => html\`<textarea>\${42}</textarea>\`),
  textareaArray: run(() => html\`<textarea>\${['a', 'b']}</textarea>\`),
  tagEntry: run(() => tagHtml\`<\${tag\`h1\`}>\${'x'}</\${tag\`h1\`}>\`),
  closedSvg: run(() => html\`<div>\${html\`<svg></svg>\`}<style>\${'.a > .b'}</style></div>\`),
};
process.stdout.write(JSON.stringify({ rows, refused, allowed }));
`;
const served = JSON.parse(
  execFileSync(process.execPath, ['--conditions', 'development', '--input-type=module', '-e', serverScript], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  })
);

const injected = (markup, options) => {
  const { document } = new JSDOM(`<!doctype html><body>${markup}`, options).window;
  const found = [];
  if (document.getElementById('pwn')) found.push('#pwn');
  for (const element of document.querySelectorAll('*'))
    for (const { name, value } of element.attributes) {
      if (/^on/i.test(name)) found.push(`${element.localName}[${name}]`);
      if (['href', 'src', 'xlink:href'].includes(name) && /^\s*javascript:/i.test(value)) found.push(`${element.localName}[${name}]`);
    }
  return found;
};
const PARSES = [{}, { runScripts: 'dangerously', virtualConsole: new VirtualConsole() }];
const clean = (table) => {
  const wrong = [];
  for (const [label, { out, error }] of Object.entries(table)) {
    if (out === undefined) wrong.push(`${label}: threw ${error}`);
    else for (const options of PARSES) for (const found of injected(out, options)) wrong.push(`${label} (${options.runScripts ? 'scripting on' : 'scripting off'}): ${found}\n      ${out}`);
  }
  return wrong;
};

test('a child that leaves state open cannot change how its parent parses', () => {
  assert.ok(Object.keys(served.rows).length >= 60);
  const wrong = clean(served.rows);
  assert.deepEqual(wrong, [], `\n  ${wrong.join('\n  ')}`);
});

test('the end closes what the template opened, innermost first — the client’s own end-of-input rule', () => {
  assert.match(served.rows['svg → style'].out, /^<div><svg><\/svg><style>/);
  assert.match(served.rows['twoDeep → style'].out, /^<div><svg><math><\/math><\/svg><style>/);
  assert.match(served.rows['svgThenStyle → style'].out, /^<div><svg><style><\/svg><style>/);
  assert.match(served.rows['comment → style'].out, /^<div><!----><style>/);
  assert.match(served.rows['noscriptSlash → style'].out, /^<div><noscript\/><\/noscript><style>/, '`<noscript/>` opens a noscript');
});

test('the refusals: a template ending inside a tag, a template in a text-only element', () => {
  for (const [label, { error }] of Object.entries(served.refused)) assert.match(error ?? 'served', /^ssr: /, label);
});

test('what stays allowed: a bare `<`, strings, numbers and arrays of strings in a textarea, the tag entry, closed svg', () => {
  const { lessThan, textareaString, textareaNumber, textareaArray, tagEntry, closedSvg } = served.allowed;
  assert.equal(lessThan.out, '<p>1 < 2<style>.a > .b</style></p>');
  /** Each `\n` after a bound textarea's start tag is the one the parser takes — see ssr-leading-newline. */
  assert.equal(textareaString.out, '<textarea>\na &#60; b</textarea>');
  assert.equal(textareaNumber.out, '<textarea>\n42</textarea>');
  assert.equal(textareaArray.out, '<textarea>\nab</textarea>');
  assert.equal(tagEntry.out, '<h1>x</h1>');
  assert.equal(closedSvg.out, '<div><svg></svg><style>.a > .b</style></div>', 'a closed svg adds nothing');
});

test('the client refuses a template ending inside a tag, in development — one rule on both sides', async () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment'])
    globalThis[key] = dom.window[key];
  const { html } = await load('core');
  const { renderInto } = await load('renderer');
  const render = (template) => {
    try {
      renderInto(template, document.createElement('div'));
      return 'rendered';
    } catch (error) {
      return error.message;
    }
  };
  const ends = [html`<b title="${'x'}`, html`<b title=${'x'}`, html`<b title="x"`, html`<p>${'x'}</p><b`];
  for (const template of ends) {
    if (isProduction) assert.equal(render(template), 'rendered', 'production pays nothing');
    else assert.match(render(template), /cannot end inside a tag/);
  }
  for (const template of [html`<p>${'a'} < b</p>`, html`<p>${'x'}</p><!--`, html`<style>${'.a{}'}`, html`<b>${'x'}`])
    assert.equal(render(template), 'rendered', 'a bare <, an open comment, raw text, an open element: not refused');
});
