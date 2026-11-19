/**
 * **The small tier, `@verajs/lite`**: one tiny core (`define`, `signal`, `html`) and a renderer that patches in
 * place, its templates judged once by the HTML parser. Both builds (`npm test`, `npm run test:prod`). The coded throws
 * are pinned by their CODE, so a throw for another reason (a crash further on) cannot pass a row. Counts are exact, each
 * with its control. Then the subset rule: the same component source rendered by lite and by core shows the same content.
 * Last, RETENTION, in a child process run with `--expose-gc` (the one allowed form, CLAUDE.md): a removed component must
 * leave nothing in a module-level signal, which no count in this process can see (its writes queue a removed reader,
 * whose render skips it: a leak changes nothing observable but memory). Found by a mutant that survived every other row.
 * (`@verajs/core/static`, a second tier writing `innerHTML`, was retired 2026-11-17: lite carries its features.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';
import { FORGED_CASES, readCase } from './fixtures/forged-cases.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
/**
 * A page's microtask queue: an error escaping a callback is reported to the window as an `ErrorEvent`, as a browser
 * reports it, never thrown into Node (whose runner fails the file for it). jsdom's own `queueMicrotask` calls the global
 * one, so it cannot stand in; this wraps Node's.
 */
const nodeMicrotask = globalThis.queueMicrotask;
globalThis.queueMicrotask = (callback) =>
  nodeMicrotask(() => {
    try {
      callback();
    } catch (error) {
      dom.window.dispatchEvent(new dom.window.ErrorEvent('error', { error, message: String(error?.message) }));
    }
  });

const lite = await load('lite');
const { define, html, signal } = lite;
/** Core, its renderer wired: the subset rule's other side (lite renders what core renders, or refuses). */
const core = await load('core');
const { renderer } = await load('renderer');
core.wire([renderer]);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const mount = (tag) => document.body.appendChild(document.createElement(tag));
/** What a connect threw: jsdom reports an error in a reaction on the window, never to the caller. */
const thrownBy = (fn) => {
  let error;
  const listener = (event) => {
    error = event.error;
    event.preventDefault();
  };
  dom.window.addEventListener('error', listener);
  try {
    fn();
  } catch (e) {
    error = e;
  } finally {
    dom.window.removeEventListener('error', listener);
  }
  return error;
};
/** The code a coded throw names, in either build: `(code)` at the end of the development sentence, or the link's tail. */
const codeOf = (error) => /\(([a-z-]+)\)$|\/e\/([a-z-]+)$/.exec(error?.message ?? '')?.slice(1).find(Boolean);
/** Console lines printed while `fn` runs. */
const said = async (fn) => {
  const lines = [];
  const saved = [console.warn, console.error];
  console.warn = console.error = (...args) => lines.push(args.join(' '));
  try {
    await fn();
  } finally {
    [console.warn, console.error] = saved;
  }
  return lines;
};

const tag = (name) => `t-lite-${name}`;

test(`lite: a declared prop renders, escaped; writes in one task coalesce into ONE render`, async () => {
  let renders = 0;
  define({ tag: tag('text'), props: { label: '<b>hi</b>' } }, (host) => () => {
    renders++;
    return html`<p>${host.label}</p>`;
  });
  const el = mount(tag('text'));
  assert.equal(renders, 1, 'CONTROL: the first connect rendered');
  assert.equal(el.querySelector('p').textContent, '<b>hi</b>');
  assert.equal(el.querySelector('b'), null, 'a value is text, never markup');
  const p = el.querySelector('p');
  el.label = 'two';
  el.label = 'three';
  assert.equal(renders, 1, 'nothing rendered synchronously');
  await settle();
  assert.equal(renders, 2, 'two writes, one render');
  assert.equal(el.querySelector('p').textContent, 'three');
  assert.equal(el.querySelector('p') === p, true, 'the same <p>, patched');
  el.label = 'three';
  await settle();
  assert.equal(renders, 2, 'a write of the same value renders nothing');
  el.remove();
});

test(`lite: an observed attribute arrives as its camel prop, one way; null removes a whole attribute`, async () => {
  define({ tag: tag('attr'), attributes: ['data-tone'] }, (host) => () => html`<p class="a ${host.dataTone} b" title=${host.dataTone}>${host.dataTone}</p>`);
  const el = mount(tag('attr'));
  const p = () => el.querySelector('p');
  assert.equal(p().hasAttribute('title'), false, 'null: no title');
  el.setAttribute('data-tone', 'warm');
  await settle();
  assert.equal(p().textContent, 'warm');
  assert.equal(p().getAttribute('class'), 'a warm b', 'a partial value');
  assert.equal(p().getAttribute('title'), 'warm');
  el.dataTone = 'cool';
  await settle();
  assert.equal(el.getAttribute('data-tone'), 'warm', 'a prop write never reflects to the attribute');
  el.removeAttribute('data-tone');
  await settle();
  assert.equal(p().hasAttribute('title'), false, 'removed: title removed');
  el.remove();
});

test('lite: lists grow, shrink and empty, reusing rows by index', async () => {
  define({ tag: tag('list'), props: { items: [1, 2, 3] } }, (host) => () => html`<ul>${host.items.map((i) => html`<li>${i}</li>`)}</ul>`);
  const el = mount(tag('list'));
  const texts = () => [...el.querySelectorAll('li')].map((n) => n.textContent).join();
  assert.equal(texts(), '1,2,3');
  const first = el.querySelector('li');
  el.items = [9, 8];
  await settle();
  assert.equal(texts(), '9,8');
  assert.equal(el.querySelector('li') === first, true, 'the first row reused');
  el.items = [1, 2, 3, 4, 5];
  await settle();
  assert.equal(texts(), '1,2,3,4,5');
  el.items = [];
  await settle();
  assert.equal(el.querySelectorAll('li').length, 0);
  el.remove();
});

test(`lite: switching what a hole shows leaves nothing of the old behind, however deep it changed (a found bug)`, async () => {
  /** Lite's ranges once tracked only the nodes they inserted themselves, so a nested hole's text outlived a switch: "axi1i2". */
  const flag = signal(true);
  define(tag('switch'), () => () => html`<p>${flag.value ? html`${'a'} tail` : html`<b>x</b>`}</p><ul>${flag.value ? [html`${'i1'}!`, html`${'i2'}!`] : []}</ul>`);
  const el = mount(tag('switch'));
  assert.equal(el.textContent, 'a taili1!i2!', 'CONTROL: the first render');
  flag.value = false;
  await settle();
  assert.equal(el.textContent, 'x');
  flag.value = true;
  await settle();
  assert.equal(el.textContent, 'a taili1!i2!', 'and back');
  el.remove();
});

test(`lite: a child given new props by its parent's render draws in the SAME flush, before an awaited write resumes`, async () => {
  /** Found by the bench's verify: each component once rendered in its own microtask, behind code awaiting the write. */
  const n = signal(1);
  define({ tag: 't-lite-child', props: { v: 0 } }, (host) => () => html`<i>${host.v}</i>`);
  define(tag('parent'), () => () => html`<p>${n.value}</p><t-lite-child .v=${n.value}></t-lite-child>`);
  const el = mount(tag('parent'));
  assert.equal(el.textContent, '11', 'CONTROL: parent and child drew');
  n.value = 2;
  await Promise.resolve();
  assert.equal(el.textContent, '22', 'one microtask after the write: both drawn');
  el.remove();
});

test(`lite: a render that throws leaves the queue working: the others queued with it still draw`, async () => {
  const n = signal(0);
  define(tag('throws'), () => () => {
    if (n.value === 1) throw new Error('planted');
    return html`<i>${n.value}</i>`;
  });
  define(tag('fine'), () => () => html`<i>${n.value}</i>`);
  const bad = mount(tag('throws'));
  const good = mount(tag('fine'));
  /** The flush runs on the page's microtask queue: the error escapes it and is reported to the window, as uncaught. */
  const escaped = [];
  const listener = (event) => {
    escaped.push(event.error?.message);
    event.preventDefault();
  };
  dom.window.addEventListener('error', listener);
  try {
    n.value = 1;
    await settle();
  } finally {
    dom.window.removeEventListener('error', listener);
  }
  assert.deepEqual(escaped, ['planted'], 'the error is reported, never swallowed');
  assert.equal(good.textContent, '1', 'the component queued after the throwing one drew');
  n.value = 2;
  await settle();
  assert.equal(bad.textContent + good.textContent, '22', 'and the next write draws both');
  bad.remove();
  good.remove();
});

test(`lite: one quote-aware scan places every hole (a peer review's shapes): never injected, never misplaced`, () => {
  /** A `>` or a quote inside an earlier quoted value once made the string tier (retired) escape a later hole as TEXT, past every refusal. */
  const rows = {
    'gt-then-unquoted': [(html) => html`<a title="a > b" href=${'x onclick=alert(1)'}>t</a>`, (el) => !el.querySelector('a').hasAttribute('onclick')],
    apostrophe: [(html) => html`<img alt="Brian's ${'cat'}">`, (el) => el.querySelector('img').alt === "Brian's cat"],
    'less-than-text': [(html) => html`<p>a < b ${'c'}</p>`, (el) => el.querySelector('p').textContent === 'a < b c'],
    'spaced-equals': [(html) => html`<a href = ${'/x'}>t</a>`, (el) => el.querySelector('a').getAttribute('href') === '/x'],
  };
  for (const [name, [draw, ok]] of Object.entries(rows)) {
    define(tag(`scan-${name}`), () => () => draw(html));
    let el;
    assert.equal(thrownBy(() => { el = mount(tag(`scan-${name}`)); }), undefined, `${name} renders`);
    assert.equal(ok(el), true, name);
    el.remove();
  }
  const refused = {
    'handler-after-gt': (html) => html`<a title=">" onclick="${'alert(1)'}">t</a>`,
    'url-after-gt': (html) => html`<a title=">" href="${'javascript:alert(1)'}">t</a>`,
  };
  for (const [name, draw] of Object.entries(refused)) {
    define(tag(`scan-${name}`), () => () => draw(html));
    let el;
    const error = thrownBy(() => { el = mount(tag(`scan-${name}`)); });
    /** Refused, or bound and never written: core's refusals hold for a handler or URL however the scan reads the tag. */
    assert.ok(error !== undefined || (!el.innerHTML.includes('onclick') && !el.innerHTML.includes('javascript')), `${name}: refused or removed`);
    el.remove();
  }
});

test('lite: an unquoted value continues across holes (`a=${x}${y}`), as core reads it', () => {
  define(tag('continues'), () => () => html`<p title=${'a'}${'b'}>x</p>`);
  const el = mount(tag('continues'));
  assert.equal(el.querySelector('p').getAttribute('title'), 'ab');
  el.remove();
});

/**
 * **The client half of a recorded server/client difference** (2026-11-18): `<style>a</style${x}` RENDERS in lite (the
 * closer the value completes is written so it cannot end the element) and in core's production build, where the server
 * — and core in development — refuse it as a tag-name hole (`tests/ssr-raw-text-closers.test.mjs`, the ssr README's
 * known limits). Safe both ways: no element, live or after a round trip.
 */
test('a hole right after a style\'s whole end-tag name: lite renders it inert; core in development refuses it, as the server does (recorded)', async () => {
  const draw = (h) => h`<style>a</style${'><img src=x onerror=zq()>'}</style>`;
  define(tag('style-closer'), () => () => draw(html));
  core.define('p-style-closer', () => () => draw(core.html));
  const [ours, theirs] = [mount(tag('style-closer')), mount('p-style-closer')];
  core.flush();
  await settle();
  assert.ok(ours.querySelector('style'), 'lite: rendered');
  for (const [name, el] of [['lite', ours], ['core', theirs]]) {
    assert.equal(el.querySelector('img'), null, `${name}: no element, live`);
    assert.equal(new JSDOM(`<body>${el.outerHTML}`).window.document.querySelector('img'), null, `${name}: no element after a round trip`);
  }
  if (!isProduction) assert.equal(theirs.querySelector('style'), null, 'core in development: refused, as the server refuses it');
  ours.remove();
  theirs.remove();
});

test('lite: title (HTML and SVG), textarea and style take a value as TEXT, composed with their statics; script and the never-shown elements refuse it (Brian, 2026-11-17)', () => {
  const attack = (t) => `a</${t}><img src=x onerror=zq()>b`;
  const shapes = {
    title: [() => html`<title>${attack('title')}</title>`, 'title', attack('title')],
    'svg-title': [() => html`<svg><title>x ${attack('title')} y</title></svg>`, 'title', `x ${attack('title')} y`],
    textarea: [() => html`<textarea>${'1'} and ${attack('textarea')}</textarea>`, 'textarea', `1 and ${attack('textarea')}`],
    /** A value in a style is written with `</style` as `<\/style` (ssr's form, lossless in CSS): a saved page parsed again keeps it text. */
    style: [() => html`<style>:host{--accent:${attack('style')}}</style>`, 'style', `:host{--accent:${attack('style').replace('</', '<\\/')}}`],
    'svg-style': [() => html`<svg><style>${'v'}</style></svg>`, 'style', 'v'],
    /** `</stylex>` closes nothing: the parser keeps the hole in the author's `<style>`, filled as its text. */
    /** The composed rule escapes `</style` wherever it starts, so the absurd static `</stylex` reads `<\\/stylex` (lossless CSS). */
    'style-end': [() => html`<style>p{}</stylex>${'v'}</style>`, 'style', 'p{}<\\/stylex>v'],
    /** A list is its items' text, nested lists flattened (2026-11-18: the rule every tier and the server follow). */
    list: [() => html`<textarea>${['a', ['b', null], 'c']} and ${'y'}</textarea>`, 'textarea', 'abc and y'],
  };
  for (const [name, [draw, selector, expected]] of Object.entries(shapes)) {
    define(tag(`text-${name}`), () => draw);
    const el = mount(tag(`text-${name}`));
    assert.equal(el.querySelector(selector).textContent, expected, name);
    assert.equal(el.querySelector('img'), null, `${name}: the value never became markup`);
    el.remove();
  }
  /** Refused: script (code), the never-shown elements, a comment, and an ACCIDENTAL style — a `<style/>` slip. */
  const refused = {
    script: () => html`<script>${'zq()'}</script>`, iframe: () => html`<iframe>${'v'}</iframe>`,
    noscript: () => html`<noscript>${'v'}</noscript>`, xmp: () => html`<xmp>${'v'}</xmp>`,
    template: () => html`<template><p>${'v'}</p></template>`, comment: () => html`<!-- ${'v'} -->`,
    'style-slip': () => html`<style/><b>${'v'}</b>`,
  };
  for (const [name, draw] of Object.entries(refused)) {
    define(tag(`text-refused-${name}`), () => draw);
    assert.equal(codeOf(thrownBy(() => mount(tag(`text-refused-${name}`)))), 'tier-hole-position', name);
  }
  /** A template in a text-only element is refused (`template-in-text`), as core and the server refuse it — it showed its text before. */
  define(tag('text-template'), () => () => html`<textarea>${html`<b>${'x'}</b>`} and ${'y'}</textarea>`);
  assert.equal(codeOf(thrownBy(() => mount(tag('text-template')))), 'template-in-text', 'a template in a textarea');
});

test('lite: a self-closed raw-text tag opens raw text, as the parser reads it (a value there would be its text, by accident): refused', () => {
  /** In HTML `<style/>` OPENS raw text (a `/` self-closes only in SVG and MathML): the rest of the template is its text. */
  const shapes = {
    style: () => html`<style/><b>${'v'}</b>`,
    textarea: () => html`<textarea/><b>${'v'}</b>`,
    title: () => html`<title/><b>${'v'}</b>`,
  };
  for (const [name, draw] of Object.entries(shapes)) {
    define(tag(`selfraw-${name}`), () => draw);
    assert.equal(codeOf(thrownBy(() => mount(tag(`selfraw-${name}`)))), 'tier-hole-position', name);
  }
  /** In SVG `<style/>` self-closes: the parser alone judges, so it renders as core. */
  const controls = { 'closed-style': () => html`<style>p{}</style><b>${'v'}</b>`, 'svg-style': () => html`<svg><style/><text>${'v'}</text></svg>` };
  for (const [name, draw] of Object.entries(controls)) {
    define(tag(`selfraw-${name}`), () => draw);
    let el;
    assert.equal(thrownBy(() => { el = mount(tag(`selfraw-${name}`)); }), undefined, `CONTROL: ${name} renders`);
    assert.equal(el.querySelector('b, text').textContent, 'v', name);
    el.remove();
  }
});

test(`lite: the PARSER judges placement — a hole the tree builder drops or moves is refused (tier-hole-position); a reshaped tree that keeps every hole renders as core`, () => {
  /** Shapes a tokenizer cannot see: the scan places each hole correctly, and the tree builder loses it. */
  const dropped = {
    'select-div': (html) => html`<select><div class=${'v'}>x</div></select>`, body: (html) => html`<body class=${'v'}><p>x</p>`,
    html: (html) => html`<html lang=${'v'}><p>x</p>`, 'tr-in-div': (html) => html`<div><tr class=${'v'}><td>x</td></tr></div>`,
    'duplicate-attribute': (html) => html`<p title=${'a'} title=${'b'}>x</p>`, cdata: (html) => html`<svg><![CDATA[${'v'}]]></svg>`,
  };
  for (const [name, draw] of Object.entries(dropped)) {
    define(tag(`parsed-${name}`), () => () => draw(html));
    assert.equal(codeOf(thrownBy(() => mount(tag(`parsed-${name}`)))), 'tier-hole-position', name);
  }
  /**
   * Reshaped but whole (an implied end tag, the adoption agency, nested anchors, an element fostered out of a table,
   * which REORDERS its hole before the table's), text and rows in a table hole (inserted where written, never fostered),
   * and holes around a `<template>` or an obsolete raw-text element (which hold none): rendered as core renders them.
   */
  const kept = {
    li: (html) => html`<ul><li>${'a'}<li>${'b'}</ul>`, 'nested-a': (html) => html`<a><a href=${'/x'}>y</a>`,
    reordered: (html) => html`<table><tbody><tr><td class=${'A'}>x</td></tr><div title=${'B'}>d</div></tbody></table>`,
    adoption: (html) => html`<b><p>${'v'}</b>`, 'p-div': (html) => html`<p><div>${'v'}`,
    'table-text': (html) => html`<table>${'x'}</table>`, 'table-rows': (html) => html`<table>${[1, 2].map((n) => html` <tr><td>${n}</td></tr>`)}</table>`,
    template: (html) => html`<p>${'a'}</p><template><i>t</i></template><b>${'v'}</b>`, xmp: (html) => html`<p>${'a'}</p><xmp>x</xmp><b>${'v'}</b>`,
  };
  for (const [name, draw] of Object.entries(kept)) {
    define(tag(`kept-${name}`), () => () => draw(html));
    core.define(`p-kept-lite-${name}`, () => () => draw(core.html));
    let el;
    const error = thrownBy(() => { el = mount(tag(`kept-${name}`)); });
    assert.equal(error, undefined, name);
    const theirs = mount(`p-kept-lite-${name}`);
    core.flush();
    const shown = (node) => (node.shadowRoot ?? node).innerHTML.replace(/<!--[^]*?-->/g, '');
    assert.equal(shown(el), shown(theirs), `${name}: renders as core`);
    el.remove();
    theirs.remove();
  }
});

test(`lite: each hole must land EXACTLY ONCE, of its kind — an author's own marker text is refused as a duplicate, out of range, or standing in for a lost hole`, () => {
  /** A text hole's marker is the comment `<!--\u0001i-->`, a value hole's `\u0002i\u0002`: an author's own is accounted like any. */
  const shapes = {
    /** An author's comment holding hole 0's marker exactly: hole 0 lands twice. */
    duplicate: (html) => html`<p><!--\u00010-->${'v'}</p>`,
    /** Every hole present, hole 0 twice: only the duplicate rule refuses it (else the author's `class` takes the value). */
    'duplicate-attribute': (html) => html`<p class="\u00020\u0002"></p><p class=${'a'}>x</p>`,
    'out-of-range': (html) => html`<p><!--\u00019-->${'v'}</p>`,
    /** The real hole's element is dropped (`<div>` in `<select>`): the author's marker stands in, as TEXT for a value hole. */
    'wrong-kind': (html) => html`<p><!--\u00010--></p><select><div class=${'v'}>x</div></select>`,
    /** And the other way: a text hole lost in a `<noscript>`, an author's attribute marker standing in for it. */
    'wrong-kind-value': (html) => html`<p title="\u00020\u0002"></p><noscript>${'v'}</noscript>`,
  };
  for (const [name, draw] of Object.entries(shapes)) {
    define(tag(`once-${name}`), () => () => draw(html));
    assert.equal(codeOf(thrownBy(() => mount(tag(`once-${name}`)))), 'tier-hole-position', name);
  }
  define(tag('once-control'), () => () => html`<p>\u0001${'v'}</p>`);
  define(tag('once-control-value'), () => () => html`<p title="\u0002" class=${'c'}>\u0002</p>`);
  const valueControl = mount(tag('once-control-value'));
  assert.equal(valueControl.querySelector('p').className, 'c', 'CONTROL: a lone \\u0002 is content too');
  valueControl.remove();
  let el;
  assert.equal(thrownBy(() => { el = mount(tag('once-control')); }), undefined, 'CONTROL: a lone \\u0001 is content, not a marker');
  assert.equal(el.querySelector('p').textContent, '\u0001v');
  el.remove();
});

test(`lite: only a tagged template literal is a template — a JSON-shaped template result renders as TEXT (core's rule), in a text hole, a list and a text-only element`, async () => {
  const forged = JSON.parse('{"_$litType$":1,"strings":["<img src=x onerror=zq()>"],"values":[]}');
  const shapes = {
    text: () => html`<p>${forged}</p>`, list: () => html`<p>${[forged, 'x']}</p>`, nested: () => html`<p>${html`<b>${forged}</b>`}</p>`,
    'text-only': () => html`<title>${forged}</title>`,
  };
  await said(async () => {
    for (const [name, draw] of Object.entries(shapes)) {
      define(tag(`forged-${name}`), () => draw);
      const el = mount(tag(`forged-${name}`));
      assert.equal(el.querySelector('img'), null, `${name}: never markup`);
      assert.match(el.textContent, /\[object Object\]/, `${name}: the text any object renders as`);
      el.remove();
    }
  });
});

test(`lite: the first connect renders ONCE, with an observed attribute or a property set before it`, async () => {
  let renders = 0;
  define({ tag: tag('once'), attributes: ['tone'], props: { p: 1 } }, (host) => () => {
    renders++;
    return html`<i>${host.tone}${host.p}</i>`;
  });
  const parsed = document.createElement('div');
  parsed.innerHTML = `<${tag('once')} tone="red"></${tag('once')}>`;
  document.body.append(parsed);
  await settle();
  assert.equal(renders, 1, 'parsed with an attribute');
  const early = document.createElement(tag('once'));
  early.p = 2;
  document.body.append(early);
  await settle();
  assert.equal(renders, 2, 'a property set before connecting: one more, not two');
  assert.equal(early.textContent, '2', 'null draws nothing, as core');
  parsed.remove();
  early.remove();
});

test(`lite: a write during a component's own render queues it again; the second value is drawn`, async () => {
  define({ tag: tag('selfwrite'), props: { n: 1 } }, (host) => () => {
    if (host.n === 1) host.n = 2;
    return html`<i>${host.n}</i>`;
  });
  const el = mount(tag('selfwrite'));
  await settle();
  assert.equal(el.textContent, '2');
  el.remove();
});

test(`lite: three queued, the middle one throws: the other two render exactly once each`, async () => {
  const n = signal(0);
  const counts = { a: 0, b: 0, c: 0 };
  for (const key of ['a', 'b', 'c'])
    define(tag(`three-${key}`), () => () => {
      counts[key]++;
      if (key === 'b' && n.value === 1) throw new Error('planted');
      return html`<i>${n.value}</i>`;
    });
  const els = ['a', 'b', 'c'].map((key) => mount(tag(`three-${key}`)));
  assert.deepEqual(counts, { a: 1, b: 1, c: 1 }, 'CONTROL: each rendered on connect');
  const escaped = [];
  const listener = (event) => {
    escaped.push(event.error?.message);
    event.preventDefault();
  };
  dom.window.addEventListener('error', listener);
  try {
    n.value = 1;
    await settle();
  } finally {
    dom.window.removeEventListener('error', listener);
  }
  assert.deepEqual(escaped, ['planted']);
  assert.deepEqual(counts, { a: 2, b: 2, c: 2 }, 'one more render each, none twice');
  for (const el of els) el.remove();
});

test(`lite: a component holds only the signals its LAST render read (subscriptions pruned at each render)`, async () => {
  /** Accumulating them kept one readers Set per signal ever read: a long-lived shell reading a churning list grew. */
  const current = signal(signal(0));
  define(tag('prune'), () => () => html`<i>${current.value.value}</i>`);
  const el = mount(tag('prune'));
  for (let i = 1; i <= 100; i++) {
    current.value = signal(i);
    await settle();
  }
  assert.equal(el.textContent, '100', 'CONTROL: it followed every new signal');
  assert.equal(el._$l$.size, 2, 'the outer signal and the last inner one, not 101 inner ones');
  el.remove();
});

test(`lite: core's refusals — a script URL, a bound inline handler and srcdoc are never written`, () => {
  define({ tag: tag('refuse'), props: { url: ' javascript:alert(1)', code: 'alert(1)', doc: '<p>x</p>' } }, (host) =>
    () => html`<a href=${host.url} onclick=${host.code}>x</a><iframe srcdoc=${host.doc}></iframe><a class="ok" href=${'https://e.com'}>y</a>`);
  const el = mount(tag('refuse'));
  const [bad, ok] = el.querySelectorAll('a');
  assert.equal(ok.getAttribute('href'), 'https://e.com', 'CONTROL: a safe URL is written');
  assert.equal(bad.hasAttribute('href'), false);
  assert.equal(bad.hasAttribute('onclick'), false);
  assert.equal(el.querySelector('iframe').hasAttribute('srcdoc'), false);
  el.remove();
});

/**
 * **Every refusal is SAID in development, in core's codes and words** (a CODE-PRINCIPLES audit, §11: a refusal
 * nobody is told about reads as a bug). The rows match the code and the words, never the label, so lite and core read the
 * same to an author; production says nothing (its bundle is byte-identical to one without the channel).
 */
test(`lite: each refused binding is said in development with core's code and words; production says nothing`, async () => {
  const lines = await said(() => {
    define({ tag: tag('say-refuse'), props: { url: 'javascript:zq()' } }, (host) =>
      () => html`<a href=${host.url} onclick=${'zq()'}>x</a><iframe srcdoc=${'<p>x</p>'}></iframe><i .__proto__=${{}}></i>`);
    const el = mount(tag('say-refuse'));
    assert.equal(el.querySelector('a').hasAttribute('href'), false, 'CONTROL: the refusals themselves still hold');
    assert.equal(el.querySelector('a').hasAttribute('onclick'), false);
    el.remove();
  });
  if (isProduction) return assert.deepEqual(lines, [], 'production says nothing');
  const rows = {
    'handler-attribute': /binds the `onclick` attribute, which runs its value as code — refused\. Bind a function as an event instead: `@click=\$\{…\}` \(or `onClick=\$\{…\}`\)/,
    'srcdoc-attribute': /binds the `srcdoc` attribute, which renders its value as an HTML document — refused\. .*`\.srcdoc=\$\{…\}`/,
    'proto-binding': /binds `\.__proto__`, which would replace the element's own prototype/,
    'script-url': /`href` was given a javascript: URL — refused, and the attribute removed\./,
  };
  for (const [code, words] of Object.entries(rows)) {
    const line = lines.find((l) => l.includes(`(${code})`));
    assert.ok(line, `${code} is said (lines: ${JSON.stringify(lines)})`);
    assert.match(line, words, `${code} in core's words`);
    assert.match(line, /<(a|iframe|i)>/, `${code} names the element`);
  }
  assert.equal(lines.length, 4, 'one line per refusal, nothing else');
});

test(`lite: two refused bindings in ONE template are BOTH said — the channel does not stop at the first`, { skip: isProduction && 'development diagnostics' }, async () => {
  const lines = await said(() => {
    define(tag('say-two'), () => () => html`<b onmouseover=${'a()'} onfocus=${'b()'}>x</b>`);
    mount(tag('say-two')).remove();
  });
  const handlers = lines.filter((l) => l.includes('(handler-attribute)'));
  assert.equal(handlers.length, 2, JSON.stringify(lines));
  assert.ok(handlers.some((l) => l.includes('`onmouseover`')) && handlers.some((l) => l.includes('`onfocus`')), 'each by its own name');
});

test(`lite: a refused script URL is said again when it CHANGES, not on an unchanged re-render (core's rule)`, { skip: isProduction && 'development diagnostics' }, async () => {
  define({ tag: tag('say-url'), props: { url: 'javascript:a()', n: 0 } }, (host) => () => html`<a href=${host.url}>${host.n}</a>`);
  let el;
  const lines = await said(async () => {
    el = mount(tag('say-url'));
    el.n = 1;
    await settle();
    assert.equal(el.querySelector('a').textContent, '1', 'CONTROL: it re-rendered');
    el.url = 'javascript:b()';
    await settle();
  });
  assert.equal(lines.filter((l) => l.includes('(script-url)')).length, 2, `the first value, then the changed one; the unchanged re-render said nothing (${JSON.stringify(lines)})`);
  el.remove();
});

/**
 * **The forged-template rule, lite and the renderer driven by one corpus** (`fixtures/forged-cases.mjs`; ssr and lite on
 * the server read the same cases in `lite-ssr.test.mjs`): every case, as a child value, shows what the rule says
 * in both, so the copies cannot drift apart unseen.
 */
test(`forged templates: lite and @verajs/renderer agree with the rule on every case of the shared corpus`, async () => {
  assert.ok(FORGED_CASES.length >= 6, 'the corpus is loaded, not empty');
  assert.ok(FORGED_CASES.some((c) => c.expected === 'markup') && FORGED_CASES.some((c) => c.expected === 'text'), 'both answers are exercised');
  const read = [];
  await said(async () => {
    for (const [i, c] of FORGED_CASES.entries()) {
      define(tag(`forged-${i}`), () => () => html`<p>${c.make(html)}</p>`);
      core.define(`p-forged-${i}`, () => () => core.html`<p>${c.make(core.html)}</p>`);
      const ours = mount(tag(`forged-${i}`));
      const theirs = mount(`p-forged-${i}`);
      core.flush();
      read.push([c.name, c.expected, readCase(ours.querySelector('p')), readCase((theirs.shadowRoot ?? theirs).querySelector('p'))]);
      ours.remove();
      theirs.remove();
    }
  });
  for (const [name, expected, lite, renderer] of read) {
    assert.equal(lite, expected, `lite: ${name}`);
    assert.equal(renderer, expected, `@verajs/renderer: ${name}`);
  }
});

/**
 * **Lite's `html` and core's are two copies of one tag, held to one shape** (2026-11-18): shared from one module, core's
 * create1k measured +3.5% slower in Chrome, so each package keeps its own (`packages/lite/src/tags.ts`, core's
 * `store/store.ts`). Through ONE call site, both must give the same kind, keep the very strings array, and pass the values.
 */
test(`lite's html and @verajs/core's give the same template result: kind, the strings array itself, the values`, async () => {
  const draw = (tag) => tag`<p class=${'a'}>${2}</p>`;
  const ours = draw(html);
  const theirs = draw(core.html);
  assert.equal(ours._$litType$, 1, 'lite: html is kind 1');
  assert.equal(theirs._$litType$, 1, 'core: html is kind 1');
  assert.equal(ours.strings, theirs.strings, 'one call site gives one strings array, and both tags keep it');
  assert.deepEqual(ours.values, ['a', 2]);
  assert.deepEqual(theirs.values, ['a', 2]);
  assert.deepEqual(Object.keys(ours).sort(), Object.keys(theirs).sort(), 'the same fields, nothing more');
  if (!isProduction) {
    const said = (tag) => { try { tag('<p>x</p>'); } catch (error) { return error.message; } };
    assert.match(said(html), /\(tag-called\)$/, 'lite refuses a string, coded');
    assert.equal(said(html).replace('[vera] html', ''), said(core.html).replace('[vera] html', ''), 'in the same words');
  }
});

test(`lite: a property set before the tag was defined is handed over; defaults are copied per element`, () => {
  const early = document.createElement(tag('early'));
  early.count = 5;
  document.body.append(early);
  define({ tag: tag('early'), props: { count: 0, list: [1], record: { a: 1 } } }, (host) => () => html`<i>${host.count}</i>`);
  assert.equal(early.querySelector('i').textContent, '5');
  const other = mount(tag('early'));
  assert.equal(other.count, 0);
  assert.notEqual(other.list, early.list, 'an array default is copied per element');
  assert.notEqual(other.record, early.record, 'a plain-object default too');
  assert.deepEqual(other.list, [1]);
  early.remove();
  other.remove();
});

test(`lite: an own __proto__ key in props or methods is skipped`, () => {
  const props = JSON.parse('{"__proto__": {"polluted": 1}, "n": 1}');
  const methods = JSON.parse('{"__proto__": {"polluted": 1}}');
  const Class = define({ tag: tag('proto'), props, methods }, () => () => html`x`);
  const el = mount(tag('proto'));
  assert.equal(el.n, 1, 'CONTROL: the ordinary prop is declared');
  assert.equal(el.polluted, undefined);
  assert.equal(Object.getPrototypeOf(Class.prototype), HTMLElement.prototype);
  el.remove();
});

test(`lite: shadow root, methods with this, and the registered class returned`, async () => {
  const Class = define({ tag: tag('shadow'), shadow: 'open', props: { n: 1 }, methods: { bump() { this.n++; } } }, (host) => () => html`<b>${host.n}</b>`);
  assert.equal(customElements.get(tag('shadow')), Class);
  const el = mount(tag('shadow'));
  assert.equal(el.shadowRoot.querySelector('b').textContent, '1');
  assert.equal(el.childNodes.length, 0, 'nothing in the light DOM');
  el.bump();
  await settle();
  assert.equal(el.shadowRoot.querySelector('b').textContent, '2');
  el.remove();
});

test(`lite: a move keeps the setup; a real removal retires it, and the author's disconnectedCallback runs each time`, async () => {
  let setups = 0;
  let disconnects = 0;
  define({ tag: tag('life'), methods: { disconnectedCallback() { disconnects++; } } }, () => {
    setups++;
    return () => html`<i>x</i>`;
  });
  const el = mount(tag('life'));
  const other = document.body.appendChild(document.createElement('div'));
  assert.equal(setups, 1, 'CONTROL: set up once');
  other.append(el);
  await settle();
  assert.equal(setups, 1, 'moved in one task: kept');
  assert.equal(disconnects, 1, 'the author\'s disconnectedCallback ran on the move');
  el.remove();
  await settle();
  document.body.append(el);
  assert.equal(setups, 2, 'removed past a microtask: retired, set up again');
  assert.equal(disconnects, 2);
  el.remove();
  other.remove();
});

test(`lite: a setup returning a value draws it once; nothing or a promise draws nothing`, async () => {
  const lines = await said(async () => {
    define(tag('value'), () => html`<p>once</p>`);
    define(tag('none'), () => {});
    define(tag('async'), async () => () => html`<p>never</p>`);
  });
  assert.equal(lines.length, 0, 'CONTROL: defining says nothing');
  const value = mount(tag('value'));
  assert.equal(value.querySelector('p')?.textContent, 'once');
  const none = document.createElement(tag('none'));
  none.innerHTML = '<span>kept</span>';
  document.body.append(none);
  assert.equal(none.textContent, 'kept', 'no render function: the light DOM is untouched');
  const pending = mount(tag('async'));
  await settle();
  assert.equal(pending.textContent, '', 'an async setup draws nothing');
  for (const el of [value, none, pending]) el.remove();
});

test(`lite: signals — a module signal re-renders every reader; a retired reader lets go; a reconnect reads again`, async () => {
  const shared = signal(0);
  let renders = 0;
  define(tag('sig'), () => {
    const own = signal('a');
    return () => {
      renders++;
      return html`<b>${shared.value}${own.value}</b>`;
    };
  });
  const a = mount(tag('sig'));
  const b = mount(tag('sig'));
  assert.equal(renders, 2, 'CONTROL: both rendered');
  shared.value = 1;
  await settle();
  assert.equal(renders, 4, 'one write, each reader once');
  assert.equal(a.textContent + b.textContent, '1a1a');
  b.remove();
  await settle();
  shared.value = 2;
  await settle();
  assert.equal(renders, 5, 'only the connected reader');
  assert.equal(b.textContent, '1a', 'the retired one kept its last content');
  document.body.append(b);
  assert.equal(b.textContent, '2a', 'reconnected: set up and rendered again');
  shared.value = 3;
  await settle();
  assert.equal(b.textContent, '3a', 'and subscribed again');
  assert.deepEqual(Object.keys(shared), []);
  assert.equal(JSON.stringify({ shared }), '{"shared":3}');
  assert.equal(Object.prototype.toString.call(shared), '[object Signal]');
  a.remove();
  b.remove();
});

test('lite: @event (this is the element; a listener object too), .prop, !live, ?bool, a case-kept name', async () => {
  let thisWasButton = false;
  let objects = 0;
  define({ tag: tag('bind'), props: { n: 0, typed: '' } }, (host) => () => html`
    <button @click=${function () { thisWasButton = this === el.querySelector('button'); host.n++; }} ?disabled=${host.n > 1} .title=${`n${host.n}`}>${host.n}</button>
    <input !value=${host.typed}><span @ping=${{ handleEvent: () => objects++ }} .textContent=${'set'}></span>`);
  const el = mount(tag('bind'));
  const button = el.querySelector('button');
  const input = el.querySelector('input');
  button.click();
  await settle();
  assert.equal(button.textContent, '1');
  assert.equal(thisWasButton, true, 'this is the element');
  assert.equal(button.title, 'n1');
  assert.equal(button.disabled, false);
  button.click();
  await settle();
  assert.equal(button.disabled, true);
  input.value = 'typed by hand';
  el.n = 5;
  await settle();
  assert.equal(input.value, '', '!value re-asserts the bound value over what was typed');
  el.querySelector('span').dispatchEvent(new Event('ping'));
  assert.equal(objects, 1);
  assert.equal(el.querySelector('span').textContent, 'set');
  assert.equal(el.querySelector('button') === button, true, 'the same nodes throughout');
  el.remove();
});

test('lite: `on` + a capital binds an EVENT, exactly as core maps it — one word, several words, a custom event; a lowercase handler attribute stays refused (Brian, 2026-11-17)', () => {
  /** Each shape on lite and on core: the handler's runs after the event its name maps to, and what is left on the element. */
  const shapes = {
    onClick: (html, fn) => html`<button onClick=${fn}>x</button>`,
    onMouseEnter: (html, fn) => html`<button onMouseEnter=${fn}>x</button>`,
    onKeyDown: (html, fn) => html`<button onKeyDown=${fn}>x</button>`,
    onMyEvent: (html, fn) => html`<button onMyEvent=${fn}>x</button>`,
    /** Not `on` + a capital: an inline handler attribute, refused (never written) on both. */
    onclick: (html) => html`<button onclick=${'zq()'}>x</button>`,
    on1: (html, fn) => html`<button on1=${fn}>x</button>`,
  };
  let tags = 0;
  const outcome = (api, prefix, name, draw) => {
    let runs = 0;
    const t = `${prefix}-on-${tags++}`;
    api.define(t, () => () => draw(api.html, () => runs++));
    const el = mount(t);
    core.flush();
    const button = el.querySelector('button');
    button.dispatchEvent(new Event(name.slice(2).toLowerCase()));
    const result = { runs, attributes: [...button.attributes].map((a) => a.name).sort().join() };
    el.remove();
    return result;
  };
  for (const [name, draw] of Object.entries(shapes)) {
    const ours = outcome(lite, 't-lite', name, draw);
    const theirs = outcome(core, 'p-core', name, draw);
    assert.deepEqual(ours, theirs, `${name}: as core`);
    if (/^on[A-Z]/.test(name)) assert.equal(ours.runs, 1, `CONTROL: ${name} ran its handler`);
  }
  assert.equal(outcome(lite, 't-lite-again', 'onclick', shapes.onclick).attributes, '', 'the lowercase handler is never written');
});

test('lite: a partial value is composed and then checked as core checks it — a handler left out, a URL checked whole; whole ones work', () => {
  const cases = {
    handler: [(html) => html`<a onclick="go(${1})">x</a>`, 'onclick', null],
    url: [(html) => html`<a href="/u/${1}">x</a>`, 'href', '/u/1'],
    composed: [(html) => html`<a href="${'java'}${'script:x'}">x</a>`, 'href', null],
    unquoted: [(html) => html`<a title=a${'b'}>x</a>`, 'title', 'ab'],
  };
  for (const [name, [draw, attribute, expected]] of Object.entries(cases)) {
    define(tag(`partial-${name}`), () => () => draw(html));
    const el = mount(tag(`partial-${name}`));
    assert.equal(el.querySelector('a').getAttribute(attribute), expected, name);
    el.remove();
  }
  define(tag('whole'), () => () => html`<a href=${`/u/${1}`} title=${'a b'}>x</a>`);
  const el = mount(tag('whole'));
  assert.equal(el.querySelector('a').getAttribute('href'), '/u/1', 'CONTROL: a whole URL is written');
  assert.equal(el.querySelector('a').getAttribute('title'), 'a b', 'an unquoted whole value is written');
  el.remove();
});

test('lite: a property binding (.prop) sets the property, as core does — markup, text, a value, an array for a child component; a script URL refused', async () => {
  const shapes = {
    markup: [() => html`<div .innerHTML=${'<b>trusted</b>'}></div>`, (el) => el.querySelector('div > b')?.textContent, 'trusted'],
    text: [() => html`<div .textContent=${'<b>t</b>'}></div>`, (el) => el.querySelector('div').textContent, '<b>t</b>'],
    value: [() => html`<input .value=${'typed'}>`, (el) => el.querySelector('input').value, 'typed'],
    'script-url': [() => html`<a .href=${'javascript:zq()'}>x</a>`, (el) => el.querySelector('a').getAttribute('href'), null],
    partial: [() => html`<p .title="a ${'b'} c">p</p>`, (el) => el.querySelector('p').title, 'a b c'],
    'no-attribute': [() => html`<p .title=${'t'}>p</p>`, (el) => el.querySelector('p').getAttribute('.title'), null],
    /** Content set through `.innerHTML` is the author's, never walked for holes: a marker-shaped comment in it is content. */
    'markup-replaces-children': [() => html`<div .innerHTML=${'<i>m</i>'}>static child</div>`, (el) => el.querySelector('div').innerHTML, '<i>m</i>'],
    'markup-not-walked': [() => html`<div .innerHTML=${'<!--\u00011-->'}></div><p>${'v'}</p>`, (el) => el.querySelector('p').textContent, 'v'],
  };
  for (const [name, [draw, read, expected]] of Object.entries(shapes)) {
    define(tag(`prop-${name}`), () => draw);
    const el = mount(tag(`prop-${name}`));
    assert.equal(read(el), expected, name);
    el.remove();
  }
  /** A hole inside an element whose content `.innerHTML` replaces would be lost: refused. */
  define(tag('prop-inner-hole'), () => () => html`<div .innerHTML=${'<i>m</i>'}><p>${'lost'}</p></div>`);
  assert.equal(codeOf(thrownBy(() => mount(tag('prop-inner-hole')))), 'tier-hole-position', 'a hole under .innerHTML');
  /** Composition: a child component takes an ARRAY through `.items` (attributes carry only strings). */
  define({ tag: 't-lite-prop-child', props: { items: [] } }, (host) => () => html`<ul>${host.items.map((item) => html`<li>${item}</li>`)}</ul>`);
  define(tag('prop-pass'), () => () => html`<t-lite-prop-child .items=${['one', 'two']}></t-lite-prop-child>`);
  const el = mount(tag('prop-pass'));
  await settle();
  assert.deepEqual([...el.querySelectorAll('li')].map((li) => li.textContent), ['one', 'two'], 'an array handed to a child component');
  el.remove();
});

test("lite: a sigil binding's name is bound as WRITTEN (case kept), and only when it is the name the parser read (the name backstop)", () => {
  define(tag('name-kept'), () => () => html`<p .textContent=${'kept'} .className=${'c'}></p>`);
  const el = mount(tag('name-kept'));
  assert.equal(el.querySelector('p').textContent + el.querySelector('p').className, 'keptc', 'CONTROL: case-kept names bind');
  el.remove();
  /**
   * The parser lowercases ASCII only; the backstop compares with `toLowerCase`, so a non-ASCII capital in a sigil's name
   * reads as a different name and is refused: an over-refusal, safe, recorded (core binds it).
   */
  define(tag('name-unicode'), () => () => html`<p .Ärger=${'v'}></p>`);
  assert.equal(codeOf(thrownBy(() => mount(tag('name-unicode')))), 'tier-hole-position', 'non-ASCII capital');
});

test('lite: a script takes a value only as a JSON data block (its type ends in json, read as the server reads it); any other script hole is refused', () => {
  const value = '{"a":"</script><img src=x onerror=zq()>"}';
  const blocks = {
    json: () => html`<script type="application/json">${value}</script>`,
    'ld+json': () => html`<script type="application/ld+json">${value}</script>`,
    'parameter (inert)': () => html`<script type="text/javascript; x=json">${value}</script>`,
  };
  /** Two holes in one block: the second hole belongs to the same opening tag as the first. */
  define(tag('json-two-holes'), () => () => html`<script type="application/json">{"a":${'1'},"b":${'2'}}</script>`);
  const two = mount(tag('json-two-holes'));
  assert.equal(two.querySelector('script').textContent, '{"a":1,"b":2}', 'both holes of one block');
  two.remove();
  for (const [name, draw] of Object.entries(blocks)) {
    define(tag(`json-${name.replace(/[^a-z]/g, '')}`), () => draw);
    const el = mount(tag(`json-${name.replace(/[^a-z]/g, '')}`));
    /** Every `<` as `\u003c`: the block parses back to the value exactly, and a saved page parsed again keeps it data. */
    const text = el.querySelector('script').textContent;
    assert.equal(text.includes('<'), false, `${name}: no \`<\` left`);
    assert.equal(text, value.replace(/</g, '\\u003c'), name);
    assert.deepEqual(JSON.parse(text), JSON.parse(value), `${name}: lossless`);
    assert.equal(el.querySelector('img'), null, `${name}: never markup`);
    el.remove();
  }
  const refused = {
    plain: () => html`<script>${'zq()'}</script>`, module: () => html`<script type="module">${'zq()'}</script>`,
    'fake start tag in script text': () => html`<script>var s = "<script type=application/json>"; f(${'x'})</script>`,
    'quoted-gt then reference': () => html`<script data-x=">" type="application&#47;json">${'1'}</script>`,
    'single-quoted reference': () => html`<script type='application&#47;json'>${'1'}</script>`,
    empty: () => html`<script type="">${'zq()'}</script>`, 'decoded &#59;': () => html`<script type="text/javascript&#59;">${'zq()'}</script>`,
    'type hole': () => html`<script type=${'application/json'}>${'1'}</script>`,
    'reference &#47;': () => html`<script type="application&#47;json">${'1'}</script>`,
    /** A JSON block carrying a binding of its own (2026-11-18): it could change the type after it was judged. */
    'bool type bound (?type)': () => html`<script type="application/json" ?type=${false}>${'zq()'}</script>`,
    'prop type bound (.type)': () => html`<script type="application/json" .type=${'text/javascript'}>${'zq()'}</script>`,
    'live type bound (!type)': () => html`<script type="application/json" !type=${'text/javascript'}>${'zq()'}</script>`,
    'a partial type': () => html`<script type="application/${'ld+'}json">${'1'}</script>`,
  };
  for (const [name, draw] of Object.entries(refused)) {
    define(tag(`json-refused-${name.replace(/[^a-z]/g, '')}`), () => draw);
    assert.equal(codeOf(thrownBy(() => mount(tag(`json-refused-${name.replace(/[^a-z]/g, '')}`)))), 'tier-hole-position', name);
  }
});

test('lite: a nested template inserts its own nodes: one left open cannot change how its parent reads on — the next value is text, never code', () => {
  const open = {
    style: html`<style>`, script: html`<script>`, comment: html`<!--`, table: html`<table>`, select: html`<select>`,
    template: html`<template>`, svg: html`<svg>`, p: html`<p>a`,
  };
  for (const [name, child] of Object.entries(open)) {
    define(tag(`open-${name}`), () => () => html`<div>${child}${'b{color:red}'}</div>`);
    let el;
    const error = thrownBy(() => { el = mount(tag(`open-${name}`)); });
    /** A child ending inside raw text, a comment or a `<template>` swallows its own end marker: refused, unfinished. */
    if (error !== undefined) assert.equal(codeOf(error), 'unfinished-tag', name);
    else {
      const own = [...el.querySelector('div').childNodes].filter((node) => node.nodeType === 3).map((node) => node.data);
      assert.deepEqual(own, ['b{color:red}'], `${name}: the value is the parent's own text, outside the child`);
    }
    assert.equal([...el.querySelectorAll('style, script')].some((code) => code.textContent.includes('color')), false, `${name}: never code`);
    el.remove();
  }
  /** A child's hole under `<textarea>` in SVG: a text-only element in any namespace, filled as its TEXT (never parsed). */
  define(tag('open-svg-textarea'), () => () => html`<select>${html`<svg><textarea>${'<b>v</b>'}</textarea></svg>`}</select>`);
  const svgTextarea = mount(tag('open-svg-textarea'));
  assert.equal(svgTextarea.querySelector('textarea')?.textContent, '<b>v</b>', 'svg textarea: the value is text');
  assert.equal(svgTextarea.querySelector('b'), null, 'svg textarea: never markup');
  svgTextarea.remove();
  define(tag('open-control'), () => () => html`<div>${html`<style>p{}</style><p>a</p>`}${'v'}</div>`);
  const el = mount(tag('open-control'));
  assert.equal(el.querySelector('div').textContent, 'p{}av', 'CONTROL: a closed child composes');
  el.remove();
});

test(`lite: development names what only core has (tier-needs-core); production says nothing`, { skip: isProduction && 'development diagnostics' }, async () => {
  const lines = await said(async () => {
    define({ tag: tag('core-option'), persist: 2 }, () => () => html`x`);
    signal(0, { deep: true });
    define(tag('core-object'), () => () => html`<p>${{ a: 1 }}</p>`);
    mount(tag('core-object')).remove();
  });
  assert.equal(lines.length, 3, lines.join('\n'));
  for (const line of lines) assert.match(line, /^\[vera\] lite: .*\(tier-needs-core\)$/);
});

/**
 * **An unquoted value followed by `/>` keeps its slash out** (2026-11-18): the parser reads an unquoted value up to the
 * `>`, slash included, so `<input value=${v}/>` gave `value="v/"` — and `<circle r=${r}/>`, SVG's everyday form, `r="5/"`.
 * Core's renderer writes a space there; lite does too. `expected` is what the author means, the parser's reading where
 * nothing is ambiguous. One case differs from core, recorded: two holes in one unquoted value (`title=${a}${b}/>`) —
 * core's scan adds the space after an attribute's FIRST hole only, so it keeps the slash there.
 */
const SLASH_CASES = [
  ['a hole', (h) => h`<p title=${'a'}/>`, 'a', true],
  ['statics, then a hole', (h) => h`<p title=x${'a'}/>`, 'xa', true],
  ['a slash inside the value', (h) => h`<p title=${'a'}/x>`, 'a/x', true],
  ['two holes', (h) => h`<p title=${'a'}${'b'}/>`, 'ab', false],
  ['a slash then a space', (h) => h`<p title=${'a'}/ >`, 'a/', true],
  ['a space before the slash', (h) => h`<p title=${'a'} />`, 'a', true],
  ['two slashes', (h) => h`<p title=${'a'}//>`, 'a//', true],
  ['a quoted value', (h) => h`<p title="${'a'}/>">`, 'a/>', true],
];
test('lite: an unquoted value directly before `/>` does not take the slash (core\'s rule, every hole)', async () => {
  for (const [i, [name, draw, expected, same]] of SLASH_CASES.entries()) {
    define(tag(`slash-${i}`), () => () => draw(html));
    core.define(`p-slash-${i}`, () => () => draw(core.html));
    const [ours, theirs] = [mount(tag(`slash-${i}`)), mount(`p-slash-${i}`)];
    core.flush();
    await settle();
    assert.ok(theirs.querySelector('p'), `CONTROL: core rendered ${name}`);
    assert.equal(ours.querySelector('p')?.getAttribute('title'), expected, `lite: ${name}`);
    if (same) assert.equal(theirs.querySelector('p').getAttribute('title'), expected, `core: ${name}`);
    else assert.equal(theirs.querySelector('p').getAttribute('title'), `${expected}/`, `core: ${name} (the recorded difference)`);
    ours.remove();
    theirs.remove();
  }
});

/**
 * **The subset rule**: one component SOURCE, rendered by lite and by core, shows the same content (comments aside: each
 * renderer anchors its ranges its own way). Core needs its renderer wired; lite needs nothing.
 */
const content = (root) => root.innerHTML.replace(/<!--[\s\S]*?-->/g, '');
const SOURCES = {
  counter: ({ html, signal }) => () => {
    const n = signal(2);
    return () => html`<p class="c ${n.value > 1 ? 'big' : 'small'}" title=${n.value}>${n.value} <b>${[1, 2].map((i) => html`<i>${i * n.value}</i>`)}</b></p>`;
  },
  card: ({ html }) => (host) => () => html`<h3>${host.heading}</h3>${host.dataTone == null ? null : html`<em>${host.dataTone}</em>`}<a href=${host.link}>go</a>`,
};
for (const [name, source] of Object.entries(SOURCES))
  test(`subset: ${name} renders the same on lite and on core`, async () => {
    const options = (prefix) => ({ tag: `${prefix}-sub-${name}`, props: { heading: 'H', link: 'javascript:x' }, attributes: ['data-tone'] });
    define(options('t'), source(lite));
    core.define(options('p'), source(core));
    const [t, p] = [document.createElement(`t-sub-${name}`), document.createElement(`p-sub-${name}`)];
    for (const el of [t, p]) {
      el.setAttribute('data-tone', 'warm');
      document.body.append(el);
    }
    core.flush();
    await settle();
    assert.ok(content(p).length > 10, `CONTROL: core rendered (${content(p)})`);
    assert.equal(content(t), content(p));
    for (const el of [t, p]) el.remove();
  });

/**
 * The child: 10 live readers of a module-level signal kept throughout (the RETAINED control: alive, and still redrawn by
 * a write), 500 more created and removed in batches of 100 (each retired a microtask after removal), a plain object
 * WeakRef'd inline (the DROPPED control: must die, or gc is not running). Then lite's component instances counted
 * with `v8.queryObjects` over the registered class: exactly the 10 live ones, or removed components were kept.
 */
const retention = () => JSON.parse(execFileSync(process.execPath, [...(isProduction ? [] : ['--conditions', 'development']), '--expose-gc', '--no-warnings', '--input-type=module', '-e', `
  import { JSDOM } from 'jsdom';
  import v8 from 'node:v8';
  const dom = new JSDOM('<!doctype html><body></body>');
  for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event'])
    globalThis[k] = dom.window[k];
  const { load } = await import('./tests/dist.mjs');
  const { define, html, signal } = await load('lite');
  const shared = signal('x');
  const Class = define('g-tier', () => () => html\`<i>\${shared.value}</i>\`);
  const settle = () => new Promise((r) => setImmediate(r));
  const gc = async () => { for (let i = 0; i < 4; i++) { global.gc(); await settle(); } };
  const churn = document.createElement('div'), keep = document.createElement('div');
  document.body.append(churn, keep);
  for (let i = 0; i < 10; i++) keep.append(document.createElement('g-tier'));
  const dropped = new WeakRef({ plain: true });
  for (let batch = 0; batch < 5; batch++) {
    for (let i = 0; i < 100; i++) churn.append(document.createElement('g-tier'));
    await settle();
    churn.replaceChildren();
    await settle();
  }
  shared.value = 'y';
  await settle();
  await gc();
  process.stdout.write(JSON.stringify({ alive: v8.queryObjects(Class, { format: 'count' }), droppedDied: dropped.deref() === undefined, keptRedrawn: [...keep.children].filter((el) => el.textContent === 'y').length }));
`], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' }));

test('lite: a removed component leaves nothing in a module signal (gc, both controls)', () => {
  const { alive, droppedDied, keptRedrawn } = retention();
  assert.equal(droppedDied, true, 'DROPPED control: a plain object died, so gc ran');
  assert.equal(keptRedrawn, 10, 'RETAINED control: the 10 live readers are subscribed and redrawn');
  assert.equal(alive, 10, 'exactly the 10 live components; none of the 500 removed');
});
