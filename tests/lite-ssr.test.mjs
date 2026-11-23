/**
 * **The lite tier on the server** (`@verajs/ssr`): lite components render there. The server's DOM has no `<template>`
 * content, so lite parses into the template element itself and each instance takes its children (found 2026-11-17: a
 * template of more than one top-level node was served wrapped in a stray `<template>`, which a browser parses as inert).
 * The served markup is read back by a real HTML parser (jsdom's), never by a regex alone: what a browser would show is
 * the claim. Its own file because `@verajs/ssr` installs its DOM's globals for the process.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderToString } from '@verajs/ssr';
import { execFileSync } from 'node:child_process';
import { FORGED_CASES, readCase } from './fixtures/forged-cases.mjs';
import { SOURCES, signature } from './fixtures/lite-namespace-sources.mjs';
import { fsPath } from '../scripts/fs-path.mjs';

const FIXTURE = new URL('./fixtures/ssr/lite-ssr.js', import.meta.url);
/** The served markup as a browser's parser reads it: the host element. */
const served = async (tag) => {
  const { html } = await renderToString(FIXTURE, { tag });
  return [html, new JSDOM(`<!doctype html><body>${html}</body>`).window.document.querySelector(tag)];
};

test('lite: renders on the server, escaped', async () => {
  const [, host] = await served('ssr-lite');
  const p = host.querySelector('p');
  assert.equal(p?.title, 'a"b');
  assert.equal(p.textContent, '<x>');
  assert.equal(host.querySelector('x'), null, 'a value is text, never markup');
});

test('lite: every hole kind on the server — a partial attribute, a list, the text of title/textarea/style/a JSON block, a property, a boolean — with no stray <template> around the instance', async () => {
  const [markup, host] = await served('ssr-lite-kinds');
  assert.ok(host.querySelector('ul') !== null, 'CONTROL: the instance was served');
  assert.equal(host.querySelector('template'), null, 'served as its own nodes, never inside an inert <template>');
  assert.equal(host.querySelector('ul').className, 'a b c');
  assert.deepEqual([...host.querySelectorAll('li')].map((li) => li.textContent), ['1', '2']);
  /** Each text-only element's text as the parser reads it back: the value, never a closing tag ending it early. */
  assert.equal(host.querySelector('title').textContent, '</title><i>t');
  assert.equal(host.querySelector('textarea').value, 'v');
  assert.ok(host.querySelector('style').textContent.startsWith('p{--x:'), 'the value stayed in the <style>');
  assert.deepEqual(JSON.parse(host.querySelector('script').textContent), { a: '</script><i>j' }, 'the JSON block decodes to the value');
  assert.equal(host.querySelectorAll('i').length, 0, 'no value became an element');
  assert.equal(host.querySelector('input').value, 'typed');
  assert.equal(host.querySelector('input').disabled, true);
  assert.doesNotMatch(markup, /undefined/);
});

/**
 * A refusal lite throws while a component renders on the server arrives as the server's `ssr-render-threw`, naming the
 * component, with lite's coded error as its cause (as a frame's throw always did): the code is read from the cause.
 */
const refusedAs = (error, tag, code, label) => {
  assert.match(String(error?.message), new RegExp(`<${tag}> threw while rendering.*\\(ssr-render-threw\\)$`), `${label}: named (${error?.message})`);
  assert.match(String(error?.cause?.message), new RegExp(`(?:\\(|/e/)${code}\\)?$`), `${label}: the cause carries the code`);
};

test('lite: on the server a child left in raw text is refused, coded; its value never reaches CSS', async () => {
  let markup = '';
  let error;
  try {
    ({ html: markup } = await renderToString(FIXTURE, { tag: 'ssr-lite-open' }));
  } catch (e) {
    error = e;
  }
  refusedAs(error, 'ssr-lite-open', 'unfinished-tag', 'refused, coded');
  assert.doesNotMatch(markup, /color:red/, 'the value never reached the <style>');
});

test('lite: a shadow component is served as a declarative shadow root', async () => {
  const [markup] = await served('ssr-lite-shadow');
  /** jsdom parses a served declarative shadow root as a plain <template> (CLAUDE.md): read its content. */
  const template = new JSDOM(`<!doctype html><body>${markup}</body>`).window.document.querySelector('ssr-lite-shadow > template');
  assert.equal(template?.getAttribute('shadowrootmode'), 'open');
  assert.equal(template.content.querySelector('b')?.textContent, 'in');
});

/**
 * **The forged-template rule on the server, from the shared corpus** (`fixtures/forged-cases.mjs`; lite and the renderer
 * read the same cases in `lite.test.mjs`): ssr's twin (`isLiteral`) and lite on the server's DOM each show what the
 * rule says for every case, read back by a real parser.
 */
test('forged templates: ssr and lite on the server agree with the rule on every case of the shared corpus', async () => {
  assert.ok(FORGED_CASES.length >= 6, 'the corpus is loaded, not empty');
  const FORGED = new URL('./fixtures/ssr/forged-cases-ssr.js', import.meta.url);
  const { warn } = console;
  console.warn = () => {};
  try {
    for (const [i, c] of FORGED_CASES.entries())
      for (const side of ['core', 'lite']) {
        const tag = `ssr-forged-${side}-${i}`;
        const { html } = await renderToString(FORGED, { tag });
        const host = new JSDOM(`<!doctype html><body>${html}</body>`).window.document.querySelector(tag);
        assert.ok(host?.querySelector('p'), `CONTROL: ${tag} was served with its <p> (${html})`);
        assert.equal(readCase(host.querySelector('p')), c.expected, `${side === 'core' ? '@verajs/ssr' : 'lite on the server'}: ${c.name}`);
      }
  } finally {
    console.warn = warn;
  }
});

/**
 * **svg and mathml on the server, by differential** (2026-11-18; the shim is audited by differential test, never by
 * reading, CLAUDE.md): every source of the shared corpus served by lite on the server's DOM, as written, and read back by
 * a real parser, against the same source rendered by lite in jsdom (a child process: this one holds the server's
 * globals). Per element: tag, namespace, attributes; and the text. The server's DOM parses SVG and MathML content (its
 * self-closing tags, case-adjusted names, integration points) and DECLINES what it does not reproduce — an HTML element
 * written in foreign content, which a real parser moves out of it: there lite refuses the template, coded (the next row),
 * never renders it differently. One source differs by nature (`ROOTLESS`): an `svg` fragment rendered into an HTML parent
 * is SVG on the client, and served as markup with no `<svg>` around it a browser parses it as HTML — markup cannot carry a
 * namespace without its root, for core's server as for lite's. It compares the namespace aside.
 */
const clientSide = () => JSON.parse(execFileSync(process.execPath, [...process.execArgv, fsPath(new URL('./fixtures/lite-namespaces-client.mjs', import.meta.url))], { encoding: 'utf8' }));
const NS_FIXTURE = new URL('./fixtures/ssr/lite-namespaces-ssr.js', import.meta.url);
const ROOTLESS = new Set(['a top-level svg fragment']);
const BREAKOUT = new Set(['html breaking out of svg content']);
/** What a server render threw, if anything (the declined shapes' refusal is the point). */
const serve = async (tag) => {
  const { warn } = console;
  console.warn = () => {};
  try {
    return { html: (await renderToString(NS_FIXTURE, { tag })).html };
  } catch (error) {
    return { error };
  } finally {
    console.warn = warn;
  }
};

test('svg/mathml: lite served from the server, as written, shows element by element what lite renders in the browser', async () => {
  const client = clientSide();
  assert.equal(Object.keys(client).length, Object.keys(SOURCES).length, 'CONTROL: the client rendered every source');
  let foreign = 0;
  let compared = 0;
  for (const [i, name] of Object.keys(SOURCES).entries()) {
    if (BREAKOUT.has(name)) continue;
    const tag = `ssr-ns-${i}`;
    const { html, error } = await serve(tag);
    assert.equal(error, undefined, `${name}: served (${error?.message?.slice(-40)})`);
    const host = new JSDOM(`<!doctype html><body>${html}</body>`).window.document.querySelector(tag);
    assert.ok(host !== null && client[name].rows.length > 0, `CONTROL: ${name} was served (${html}) and rendered on the client`);
    foreign += client[name].rows.filter((row) => !row.startsWith('http://www.w3.org/1999/xhtml')).length;
    compared++;
    if (ROOTLESS.has(name)) {
      const unspaced = (rows) => rows.map((row) => row.split(' ').slice(1).join(' '));
      assert.deepEqual(unspaced(signature(host).rows), unspaced(client[name].rows), `${name}: the same elements, the namespace aside`);
      continue;
    }
    assert.deepEqual(signature(host), client[name], name);
  }
  assert.equal(compared, Object.keys(SOURCES).length - BREAKOUT.size, 'every source but the declined one was compared');
  assert.ok(foreign >= 15, `CONTROL: the corpus made foreign elements (${foreign})`);
});

/** **A decline refuses, coded, and never renders differently** (an HTML element in SVG content: a browser moves it out). */
test('svg/mathml: an HTML element written in svg content is refused on the server, coded (declined, never misrendered)', async () => {
  for (const [i, name] of Object.keys(SOURCES).entries()) {
    if (!BREAKOUT.has(name)) continue;
    const { error } = await serve(`ssr-ns-${i}`);
    refusedAs(error, `ssr-ns-${i}`, 'tier-hole-position', `${name}: refused, coded`);
  }
});

/**
 * **Values in SVG and MathML on the server, both paths** (2026-11-18): an SVG `<style>` or a `<style>` in MathML is not
 * raw text to a browser (its content is markup), so a value there is TEXT — before, the server's DOM wrote it with
 * raw-text escaping and a value ended the element and injected (measured on lite; core's serializer was already safe).
 * Lite refuses a hole in an SVG or MathML `<script>` (a value there would run as code). Core's renderer and its server
 * both write a script hole's value, in any namespace — core's own rule, not this item's, so its script rows are not here.
 * Read back by a real parser: no element carries the handler.
 */
for (const side of ['lite', 'core'])
  test(`svg/mathml values on the server (${side}): style and title hold text, never markup${side === 'lite' ? '; a script hole is refused' : ''}`, async () => {
    for (const name of ['svg-style', 'svg-title', 'math-style']) {
      const tag = `ssr-${side}-${name}`;
      const { html, error } = await serve(tag);
      assert.equal(error, undefined, `${name}: served`);
      const doc = new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
      assert.ok(doc.querySelector(tag)?.querySelector(name.endsWith('title') ? 'title' : 'style'), `CONTROL: ${name}'s element was served (${html})`);
      assert.equal([...doc.querySelectorAll('*')].some((el) => el.hasAttribute('onerror')), false, `${name}: nothing injected (${html})`);
    }
    /** A prefixed attribute is kept by its qualified name, and that name reaches the URL check (`xlink:href` is a URL sink). */
    {
      const tag = `ssr-${side}-svg-xlink`;
      const { html, error } = await serve(tag);
      assert.equal(error, undefined, 'svg-xlink: served');
      const links = [...new JSDOM(`<!doctype html><body>${html}</body>`).window.document.querySelector(tag).querySelectorAll('a')];
      assert.equal(links.length, 2, `CONTROL: both links served (${html})`);
      assert.equal(links[1].getAttribute('xlink:href'), '#ok', 'CONTROL: a safe xlink:href is written');
      assert.equal(links[0].hasAttribute('xlink:href'), false, `the javascript: xlink:href is removed (${html})`);
    }
    if (side === 'lite')
      for (const name of ['svg-script', 'math-script']) {
        const { html, error } = await serve(`ssr-${side}-${name}`);
        assert.ok(error !== undefined, `${name}: refused (${html})`);
        refusedAs(error, `ssr-${side}-${name}`, 'tier-hole-position', `${name}: refused, coded`);
      }
  });
