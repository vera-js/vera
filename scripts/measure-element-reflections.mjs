/**
 * Measures which element-specific IDL properties actually reflect to a content attribute, and what
 * each answers when the attribute is absent — on Chromium, Firefox and WebKit.
 *
 * This is what produced the table in `packages/ssr/src/vera/reflections.js`. Run it when an engine
 * changes and `tests/browser/element-reflections.test.js` starts failing:
 *
 *     node scripts/measure-element-reflections.mjs > /tmp/reflections.json
 *
 * A property is only recorded when all three engines agree on every measured cell, and when reading
 * the attribute back gives exactly what was written — which is what excludes the ones that resolve
 * against a document URL, come back from layout, or are clamped. The enumerated states need a second
 * pass with candidate lists; both the criteria and the exclusions are documented in `reflections.js`
 * rather than here, so there is one place to read.
 *
 * Written rather than recalled, because this file's own history says so: `tabIndex` had no default
 * and every element claimed to be in the tab order; `draggable` and `spellcheck` needed separate
 * defaults; every enumerated state here was measured on three engines instead of read off a spec.
 */
import { chromium, firefox, webkit } from 'playwright';

/**
 * **The tag list is this measurement's real boundary, and it was the source of three findings.**
 *
 * A member missing from `reflections.js` looked like a member somebody had skipped. It was not: it was
 * a *tag* nobody measured. `option.text`, `form.action` and `table.width` each traced back to here,
 * and the second half of the list below — `table` through `menu` — exists because of them.
 *
 * Those are mostly the legacy presentational attributes (`align`, `bgColor`, `vAlign`, `compact`):
 * deprecated, still reflected by every engine, and therefore still reaching markup the moment a
 * component assigns one. `template`'s declarative-shadow-DOM booleans are here for a better reason —
 * this package emits that element.
 *
 * A tag with no interface of its own contributes nothing, so adding one costs a measurement rather
 * than a row.
 */
const TAGS = [
  'a','area','audio','base','blockquote','button','canvas','col','colgroup','data','del','details',
  'dialog','embed','fieldset','form','iframe','img','input','ins','label','li','link','map','meta',
  'meter','object','ol','optgroup','option','output','param','progress','q','script','select',
  'slot','source','style','td','textarea','th','time','track','video',
  'table','tr','tbody','thead','tfoot','caption','hr','p','div','ul','dl','pre','template',
  'h1','h2','h3','h4','h5','h6','br','legend','menu',
];

const measure = async (browserType, name) => {
  const browser = await browserType.launch();
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  const data = await page.evaluate((tags) => {
    /** Members shared with every element are generic and already covered; only the extras matter. */
    const generic = new Set();
    for (const proto of [HTMLElement.prototype, Element.prototype, Node.prototype, EventTarget.prototype])
      for (const k of Object.getOwnPropertyNames(proto)) generic.add(k);

    const out = {};
    for (const tag of tags) {
      const el = document.createElement(tag);
      const proto = Object.getPrototypeOf(el);
      if (proto === HTMLElement.prototype) continue;   // no interface of its own
      const rows = [];
      for (const prop of Object.getOwnPropertyNames(proto)) {
        if (generic.has(prop) || prop === 'constructor' || prop.startsWith('on')) continue;
        const d = Object.getOwnPropertyDescriptor(proto, prop);
        if (typeof d?.get !== 'function' || typeof d?.set !== 'function') continue;  // needs both

        const fresh = document.createElement(tag);
        let missing;
        try { missing = fresh[prop]; } catch { continue; }
        const type = typeof missing;
        if (type === 'object' || type === 'function') continue;   // not a scalar reflection

        /** Does setting it write an attribute? Compare the attribute set before and after. */
        const probe = type === 'boolean' ? true : type === 'number' ? 7 : 'zz';
        const before = fresh.getAttributeNames();
        try { fresh[prop] = probe; } catch { continue; }
        const after = fresh.getAttributeNames();
        const added = after.filter((n) => !before.includes(n));
        if (added.length !== 1) continue;              // not a plain one-to-one reflection
        const attribute = added[0];
        const written = fresh.getAttribute(attribute);

        /** And does reading the attribute back drive the property? (rules out write-only oddities) */
        const back = document.createElement(tag);
        back.setAttribute(attribute, written);
        let readsBack;
        try { readsBack = back[prop]; } catch { readsBack = undefined; }

        rows.push({
          prop, attribute, type,
          missing: type === 'number' || type === 'boolean' ? missing : String(missing),
          written,
          readsBack: type === 'number' || type === 'boolean' ? readsBack : String(readsBack),
          drivenByAttribute: readsBack === fresh[prop],
        });
      }
      if (rows.length) out[tag] = rows;
    }
    return out;
  }, TAGS);
  await browser.close();
  return [name, data];
};

const results = Object.fromEntries(
  await Promise.all([measure(chromium, 'chromium'), measure(firefox, 'firefox'), measure(webkit, 'webkit')])
);
console.log(JSON.stringify(results));
