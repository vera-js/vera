/**
 * SSR fixture: the forged-template corpus (`../forged-cases.mjs`) through `@verajs/ssr`'s serializer (a core component)
 * and through the lite tier on the server's DOM (a lite component) — `tests/lite-ssr.test.mjs`. Light DOM, so the
 * served `<p>` is in the document a test parses (a declarative shadow root parses as an inert `<template>` in jsdom).
 */
import { define as coreDefine, html as coreHtml } from '@verajs/core';
import { define as liteDefine, html as liteHtml } from '@verajs/lite';
import { FORGED_CASES } from '../forged-cases.mjs';

for (const [i, c] of FORGED_CASES.entries()) {
  coreDefine(`ssr-forged-core-${i}`, () => () => coreHtml`<p>${c.make(coreHtml)}</p>`);
  liteDefine(`ssr-forged-lite-${i}`, () => () => liteHtml`<p>${c.make(liteHtml)}</p>`);
}
