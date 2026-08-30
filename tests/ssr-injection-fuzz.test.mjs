/**
 * Can an interpolated value escape its position in the server's markup?
 *
 * Every other property in this suite is about being correct. This one is about being safe: a value is
 * **data**, and no value should be able to become markup, an attribute, a new element or script — in
 * any binding position.
 *
 * ## The oracle is a real parser, not another implementation
 *
 * The emitted markup is parsed with jsdom and the question asked of the *result*: what did the payload
 * become? An element, an `on*` attribute or a `<script>` means it escaped. Text or an attribute value
 * means it did not. That is the only oracle that answers the question actually being asked, because a
 * string comparison cannot tell escaped text from text that never needed escaping.
 *
 * ## Two halves, because either alone can be satisfied by the wrong thing
 *
 * 1. **Nothing escaped.** A serializer that dropped every value would pass this on its own.
 * 2. **Every payload survives as data** — readable as text or as an attribute value. A serializer that
 *    escaped correctly but lost the content would pass the first half and fail a user.
 *
 * A control runs the same payload as genuine markup and asserts the detector *does* fire on it, so a
 * green run cannot mean the detector stopped looking.
 *
 * ## Raw-text elements are a different problem and are included on purpose
 *
 * Inside `<style>`, `<script>`, `<textarea>` and `<title>` the ordinary entity escaping does not
 * apply — only an exact closing tag ends the element. The serializer breaks those with a backslash
 * (`<\/script>`), which keeps the text valid CSS or JavaScript while denying the parser its match, and
 * that is a separate mechanism from the entity path with its own way of being wrong.
 *
 * ## What this file does not reach
 *
 * **CSS hoisted from `static styles`.** That path uses `escapeStyleText` rather than `escapeRawText`,
 * and neutering it leaves everything here green — the values this fuzz interpolates go through a
 * template's `<style>` element, not through the hoisted stylesheet a component class declares.
 *
 * That is a boundary, not a gap: `tests/ssr-escaping.test.mjs` and `tests/styles-cross-copy.test.mjs`
 * both fail on the same mutation, and the second exists precisely because the rule is **duplicated**
 * in `@verajs/styles` — `@verajs/ssr` publishes its source with no dependencies, so the two copies
 * cannot be shared and are asserted to agree instead. Stated here so a green run of this file is not
 * read as covering hoisted CSS.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>');
const D = dom.window.document;

const { html } = await load('core');
const { serializeTemplate } = await import('@verajs/ssr');

/** Payloads that try to leave whatever context they land in. */
const PAYLOADS = [
  '<script>alert(1)</script>',
  '"><script>alert(1)</script>',
  "'><script>alert(1)</script>",
  '</textarea><script>alert(1)</script>',
  '</style><script>alert(1)</script>',
  '</title><script>alert(1)</script>',
  '</script><script>alert(1)</script>',
  '" onload="alert(1)',
  "' onload='alert(1)",
  ' onload=alert(1)',
  '--><script>alert(1)</script><!--',
  '<img src=x onerror=alert(1)>',
  '<svg/onload=alert(1)>',
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  ' <script>alert(1)</script>',
  '</p><script>alert(1)</script><p>',
];

/** Each position, as a function so the call site is stable across renders. */
const POSITIONS = {
  'child text': (v) => html`<p>${v}</p>`,
  'child text, two holes': (v) => html`<p>${v}${v}</p>`,
  'quoted attribute': (v) => html`<p title="${v}">t</p>`,
  'unquoted attribute': (v) => html`<p title=${v}>t</p>`,
  'attribute among others': (v) => html`<p id="a" title=${v} class="b">t</p>`,
  'property binding': (v) => html`<input .value=${v}>`,
  'boolean binding': (v) => html`<input ?disabled=${v}>`,
  'inside <style>': (v) => html`<style>${v}</style>`,
  'inside <title>': (v) => html`<title>${v}</title>`,
  'inside <textarea>': (v) => html`<textarea>${v}</textarea>`,
  'inside <script>': (v) => html`<script>${v}</script>`,
  'an href': (v) => html`<a href=${v}>link</a>`,
  'nested deep': (v) => html`<div><section><p>${v}</p></section></div>`,
};

/** What a real parser makes of the emitted markup. */
const inspect = (markup) => {
  const holder = D.createElement('div');
  holder.innerHTML = markup;
  return {
    scripts: holder.querySelectorAll('script').length,
    handlers: [...holder.querySelectorAll('*')].filter((element) =>
      [...element.attributes].some((attribute) => /^on/i.test(attribute.name))
    ).length,
    injected: holder.querySelectorAll('img, svg, iframe, object, embed').length,
    text: holder.textContent,
    attributeValues: [...holder.querySelectorAll('*')].flatMap((element) =>
      [...element.attributes].map((attribute) => attribute.value)
    ),
  };
};

test('the detector fires when a payload really is markup', () => {
  const control = inspect('<p><script>alert(1)</script><img src=x onerror=alert(1)></p>');
  assert.ok(control.scripts >= 1, 'the control found no script — the detector has stopped looking');
  assert.ok(control.handlers >= 1, 'the control found no event handler');
  assert.ok(control.injected >= 1, 'the control found no injected element');
});

test('no interpolated value escapes its position', () => {
  const escapes = [];
  let cases = 0;

  for (const [position, build] of Object.entries(POSITIONS)) {
    for (const payload of PAYLOADS) {
      cases++;
      let markup;
      try {
        markup = serializeTemplate(build(payload));
      } catch (error) {
        /** Refusing is a safe outcome, but an unexpected one here — record it rather than ignore it. */
        escapes.push(`${position} / ${JSON.stringify(payload)} — the server refused: ${String(error.message).slice(0, 80)}`);
        continue;
      }

      const seen = inspect(markup);
      /** A `<script>` is legitimate in that one position; a *second* one is not. */
      const allowedScripts = position === 'inside <script>' ? 1 : 0;
      if (seen.scripts > allowedScripts || seen.handlers > 0 || seen.injected > 0)
        escapes.push(
          `${position} / ${JSON.stringify(payload)}\n      scripts=${seen.scripts} handlers=${seen.handlers} injected=${seen.injected}\n      markup: ${markup.slice(0, 140)}`
        );
    }
  }

  assert.equal(cases, Object.keys(POSITIONS).length * PAYLOADS.length, 'not every combination ran');
  assert.deepEqual(escapes.slice(0, 8), [], `${escapes.length} of ${cases} values escaped their position:\n\n  ${escapes.slice(0, 8).join('\n\n  ')}`);
});

test('and every payload still arrives as data rather than being dropped', () => {
  /**
   * Without this, a serializer that discarded values would satisfy the test above completely. The
   * payload has to be readable on the other side — as text, or as an attribute value.
   */
  const lost = [];
  const payload = '</textarea></style></title></script><script>alert(1)</script>';

  for (const [position, build] of Object.entries(POSITIONS)) {
    /** A boolean binding takes a truthiness, not a string, so it has nothing to carry through. */
    if (position === 'boolean binding') continue;

    const seen = inspect(serializeTemplate(build(payload)));
    const asText = seen.text.includes('alert(1)');
    const asAttribute = seen.attributeValues.some((value) => value.includes('alert(1)'));
    if (!asText && !asAttribute) lost.push(position);
  }

  assert.deepEqual(lost, [], `these positions dropped the value entirely rather than escaping it: ${lost.join(', ')}`);
});
