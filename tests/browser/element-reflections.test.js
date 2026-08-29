/**
 * The element-specific reflection table, checked against the engine running it.
 *
 * `packages/ssr/src/vera/reflections.js` says which properties each tag has, which attribute each
 * one reflects, and what it answers when that attribute is absent. It was measured from Chromium,
 * Firefox and WebKit rather than written from memory — this suite is what keeps that true as the
 * engines change, in the same way `dom-surface.test.js` keeps the generic surface honest.
 *
 * A failure here is usually not a bug. It is an engine adding a property, changing an enumerated
 * state, or starting to agree with the other two about one this table had to take a majority on.
 * Re-run `scripts/measure-element-reflections.mjs` and update the table.
 *
 * **Asymmetric, deliberately.** A property this engine reflects and the table does not have is a
 * gap in what the server DOM can render, and fails. A property the table has and this engine does
 * not is another engine's — the table is the intersection across three, and the omissions are
 * listed at the bottom of `reflections.js` with the measurement that produced each one.
 */
import { expect } from '@esm-bundle/chai';
import { ELEMENT_REFLECTIONS } from '../../packages/ssr/src/vera/reflections.js';

/** Named in `reflections.js` as measured-and-excluded, each with the reason it cannot be answered
 * on a server: resolved against a document URL, read back from layout, clamped, or present in one
 * engine only. Repeated here so this suite does not re-report them as gaps. */
const EXCLUDED = new Set([
  'base.href', 'form.action', 'button.formAction', 'input.formAction',
  'input.width', 'input.height',
  'meter.value', 'meter.low', 'meter.high', 'meter.optimum', 'progress.value',
  'button.command',
  'a.attributionSourceId', 'a.attributionDestination', 'a.attributionSourceNonce',
  'area.hreflang', 'area.type', 'canvas.mozOpaque',
  'iframe.csp', 'iframe.credentialless', 'iframe.allowPaymentRequest',
  'input.incremental', 'input.alpha', 'input.colorSpace', 'input.switch',
  'video.playsInline', 'video.autoPictureInPicture', 'video.webkitWirelessVideoPlaybackDisabled',
  /**
   * Chromium's advertising and storage proposals, which no other engine implements and none of
   * which a server render has any use for. Measured here rather than headless: these appear only on
   * a real origin, so the run that built the table (an `about:blank` page) never saw them — which is
   * exactly the drift this suite exists to catch, and it caught it on its first run.
   */
  'a.attributionSrc', 'area.attributionSrc', 'img.attributionSrc', 'script.attributionSrc',
  'iframe.adAuctionHeaders', 'iframe.browsingTopics', 'iframe.privateToken',
  'iframe.sharedStorageWritable', 'img.browsingTopics', 'img.sharedStorageWritable',
  'script.browsingTopics',
]);

/** The six the table takes a majority on, because the engines disagree and an enumerated state
 * cannot reach the markup — the attribute is stored verbatim either way. */
const MAJORITY = new Set([
  'input.type', 'link.as', 'img.loading', 'iframe.loading',
  'button.popoverTargetAction', 'input.popoverTargetAction',
]);

/** The members every element shares. Those are the generic table's business, not this one's. */
const generic = new Set();
for (const proto of [HTMLElement.prototype, Element.prototype, Node.prototype, EventTarget.prototype])
  for (const name of Object.getOwnPropertyNames(proto)) generic.add(name);

/**
 * Does this engine reflect `tag.property`, and to which attribute? Measured the same way the table
 * was built: read it with the attribute absent, assign a probe, see which attribute appeared.
 */
const measure = (tag, property) => {
  const element = document.createElement(tag);
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), property);
  if (typeof descriptor?.get !== 'function' || typeof descriptor?.set !== 'function') return null;
  let missing;
  try { missing = element[property]; } catch { return null; }
  const type = typeof missing;
  if (type === 'object' || type === 'function') return null;
  const before = element.getAttributeNames();
  /** `data:,` rather than a word: a probe assigned to `src` is *fetched*, and a run full of 404s is
   * a run where a real one is easy to miss. */
  try { element[property] = type === 'boolean' ? true : type === 'number' ? 7 : 'data:,'; } catch { return null; }
  const added = element.getAttributeNames().filter((name) => !before.includes(name));
  if (added.length !== 1) return null;
  return { attribute: added[0], type, missing, written: element.getAttribute(added[0]) };
};

for (const [tag, properties] of Object.entries(ELEMENT_REFLECTIONS)) {
  it(`<${tag}> reflects what this engine reflects`, () => {
    const element = document.createElement(tag);
    const proto = Object.getPrototypeOf(element);
    if (proto === HTMLElement.prototype) return;   // this engine gives the tag no interface

    /** Every property the table claims still exists here and still reflects the same attribute. */
    for (const [property, entry] of Object.entries(properties)) {
      const found = measure(tag, property);
      if (found === null) continue;                // another engine's, or gone from this one
      expect(found.attribute, `${tag}.${property} reflects a different attribute here`).to.equal(entry[1]);
      if (!MAJORITY.has(`${tag}.${property}`) && entry[0] !== 'enum')
        expect(found.missing, `${tag}.${property} with the attribute absent`).to.equal(
          entry[0] === 'presence' ? (entry[2] ?? false) : entry[0] === 'number' ? entry[2] : ''
        );
    }

    /** And nothing this engine reflects is missing from the table. */
    const gaps = [];
    for (const property of Object.getOwnPropertyNames(proto)) {
      if (generic.has(property) || property === 'constructor' || property.startsWith('on')) continue;
      if (properties[property] !== undefined) continue;
      if (EXCLUDED.has(`${tag}.${property}`)) continue;
      if (measure(tag, property) !== null) gaps.push(property);
    }
    expect(gaps, `<${tag}> reflects these and the table does not list them`).to.deep.equal([]);
  });
}
