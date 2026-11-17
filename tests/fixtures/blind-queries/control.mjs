/**
 * The blind-query instrument's POSITIVE CONTROL (`scripts/blind-queries.mjs` runs it first): one blind query (the
 * `<img>` sits inside a declarative shadow root's `<template>`) that MUST be recorded, and one query that sees its target
 * (not recorded). If the control records anything else, the instrument is broken and the step fails.
 */
import { JSDOM } from 'jsdom';

const doc = new JSDOM('<!doctype html><body><x-c><template shadowrootmode="open"><img id="inside"></template></x-c><p id="outside"></p></body>').window.document;
doc.querySelectorAll('img');
doc.querySelector('#outside');
