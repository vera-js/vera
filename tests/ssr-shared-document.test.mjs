/**
 * **One document serves every render, so nothing a render writes to it may reach the next** (2026-11-25). The `lang`
 * and attributes of `<html>`, the attributes of `<body>` and the cookie were kept from one render to the next: a cookie
 * one request's component set was what the next request's components read, whether the render that set it finished in
 * time or had timed out and was still running. The served markup did not carry it; the next request's code did.
 *
 * A render's own writes are put back when it ends, as the title and the location are, and a write from work a settled
 * render left running is refused, as a late title is. What the page's module sets at its top stays: it ran once, before
 * any render, and is the process's. Each row reads the writer's own values first (CONTROL), so a write that never
 * happened cannot pass as one that was put back.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToString, renderToStringAsync } from '@verajs/ssr';

const PAGE = new URL('./fixtures/ssr/shared-document-ssr.js', import.meta.url);
const seen = (globalThis.__sharedDocument ??= {});
/** What every render finds: the module's own `lang` and body flag, nothing else; no cookie (`undefined`, as before any write). */
const FOUND = { lang: 'en', flag: null, body: 'shell', hidden: false, cookie: undefined, custom: null };
const settle = (ms) => new Promise((done) => setTimeout(done, ms));
const nextFinds = async () => {
  await renderToString(PAGE, { tag: 'doc-reader-ssr' });
  return seen.reader;
};

test("a render finds the document as the page's module left it", async () => {
  assert.deepEqual(await nextFinds(), FOUND);
});

test("a render's writes to the shared document are put back when it ends", async () => {
  await renderToString(PAGE, { tag: 'doc-writer-ssr' });
  assert.deepEqual(seen.writer, { lang: 'alice', flag: 'alice', body: null, hidden: true, cookie: 'who=alice', custom: null }, 'CONTROL: the writer reads its own writes');
  assert.deepEqual(await nextFinds(), FOUND);
});

test('a timed-out render that writes later writes nothing', async () => {
  const warn = console.warn;
  const warned = [];
  console.warn = (message) => warned.push(String(message));
  try {
    await renderToStringAsync(PAGE, { tag: 'doc-late-ssr', timeout: 20 });
  } finally {
    console.warn = warn;
  }
  assert.ok(warned.some((message) => message.includes('ssr-timeout')), 'CONTROL: the render ran out of time');
  await settle(120);
  assert.equal(seen.lateRan, true, 'CONTROL: the late write ran');
  assert.deepEqual(await nextFinds(), FOUND);
});

test('work a synchronous render leaves on a timer writes nothing', async () => {
  await renderToString(PAGE, { tag: 'doc-timer-ssr' });
  await settle(20);
  assert.equal(seen.timerRan, true, 'CONTROL: the timer ran');
  assert.deepEqual(await nextFinds(), FOUND);
});

test("a <body> a render puts in place is put back when it ends", async () => {
  await renderToString(PAGE, { tag: 'doc-swap-ssr' });
  assert.equal(seen.swapped, 'swap', 'CONTROL: the render read its own body');
  assert.deepEqual(await nextFinds(), FOUND);
});

test("a timed-out render's late <body> is refused", async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    await renderToStringAsync(PAGE, { tag: 'doc-late-swap-ssr', timeout: 20 });
  } finally {
    console.warn = warn;
  }
  await settle(120);
  assert.equal(seen.lateSwapRan, true, 'CONTROL: the late replacement ran');
  assert.deepEqual(await nextFinds(), FOUND);
});

test("a late write to a <body> a render put in place in time reaches nothing the next render reads", async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    await renderToStringAsync(PAGE, { tag: 'doc-swap-then-late-ssr', timeout: 20 });
  } finally {
    console.warn = warn;
  }
  await settle(120);
  assert.equal(seen.orphanWritten, 'orphan', 'CONTROL: the late write reached the body the render put in place');
  assert.deepEqual(await nextFinds(), FOUND);
});
