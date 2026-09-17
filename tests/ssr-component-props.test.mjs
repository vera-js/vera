/**
 * SSR delivery of component props — the server half of the reception contract.
 *
 * A parent's property bindings on a REGISTERED component tag are delivered to the instance the
 * nested-component scan renders, by identity and before its lifecycle — the same mechanism
 * `renderToString`'s own `props` option always used, completed for nesting. The serialized markup
 * itself never changes: no property becomes an attribute, and the instance marker that crosses
 * the string boundary is removed before the page is returned.
 *
 * The expectations here are the SAME strings the client suites pin for these shapes
 * (`tests/component-props.test.mjs`) — that agreement, not any single assertion, is the
 * hydration contract: both halves render the same content from the same data.
 */
import { renderToString } from '@verajs/ssr';
import assert from 'node:assert/strict';

const fixture = new URL('./fixtures/ssr/component-props-ssr.js', import.meta.url);
const { html: markup } = await renderToString(fixture);
const rows = [...markup.matchAll(/<p>\s*([^<]*?)\s*<\/p>/g)].map(([, text]) => text.replace(/\s+/g, ' '));

assert.deepEqual(
  rows,
  [
    'written · 7 · written · true',
    'spread · no-value · spread · no-live',
    'alpha · no-value · no-attr · no-live',
    'beta · no-value · no-attr · no-live',
  ],
  'written .prop, !prop, props()/spread, and each list row render from the delivered values — by identity, per instance'
);

assert.ok(
  markup.includes('<props-unloaded></props-unloaded>'),
  'an UNREGISTERED dashed tag passes through untouched — the property stays the client’s to apply, and the binding leaves no residue'
);

assert.ok(
  !/vera-ssr-/.test(markup),
  'the instance marker never reaches the page — claimed markers are removed by the render, unclaimed ones by the sweep'
);

assert.ok(
  !/value="7"|item=/.test(markup),
  'no delivered property leaks into markup — `.value` on a component is that component’s prop, never the form-state mirror'
);

/** The same page twice is the same bytes — delivery must not introduce render-order state. */
const again = await renderToString(fixture);
assert.equal(again.html, markup, 'deterministic across renders');

/**
 * A getter-only property refuses with a named error, exactly as `renderToString`'s own `props`
 * option refuses — naming the tag and the property, not `Cannot set property x of #<Class>`.
 */
await assert.rejects(
  renderToString(new URL('./fixtures/ssr/component-props-readonly-ssr.js', import.meta.url)),
  /refused the bound property `\.locked`/,
  'a throwing setter is reported against the tag and property'
);
