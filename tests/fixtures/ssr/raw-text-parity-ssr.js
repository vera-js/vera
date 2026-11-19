/**
 * SSR fixture for tests/renderer-raw-text-round-trip.test.mjs: every shape of `raw-text-shapes.mjs` as a CORE component
 * (`rtp-core-<i>`) and a LITE component (`rtp-lite-<i>`) with the very same source, so the server's bytes for each are
 * compared — lite on the server writes through the server's DOM (its text nodes), core through the serializer.
 */
import * as core from '@verajs/core';
import * as lite from '@verajs/lite';
import { SHAPES, literal } from '../raw-text-shapes.mjs';

for (const [i, [, strings, values]] of SHAPES.entries()) {
  const shape = literal(strings);
  core.define(`rtp-core-${i}`, () => () => core.html(shape, ...values));
  const liteShape = literal(strings);
  lite.define(`rtp-lite-${i}`, () => () => lite.html(liteShape, ...values));
}
