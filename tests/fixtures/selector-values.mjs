/**
 * **One table for the shim and the engines**: markup, and each attribute selector with the ids every engine answers
 * for it (Chromium, Firefox and WebKit, measured by `tests/browser/selector-values.test.js`, which asserts this same
 * table). `tests/ssr-selector-values.test.mjs` holds the shim to it. jsdom is not the oracle here: it matches an SVG
 * element's `type` case-insensitively, has no `s` flag, and drops a line continuation and an escaped name.
 */
export const MARKUP =
  '<p id="lang" lang="en-US"></p><input id="box" type="checkbox"><p id="dir" dir="RTL"></p><p id="data" data-x="Hello"></p>' +
  '<p id="quote" title="a&quot;b"></p><p id="bracket" title="a]b"></p><p id="back" title="a\\b"></p><p id="one" title="1"></p>' +
  '<p id="nl" title="ab"></p><svg><rect id="svg" type="Checkbox"></rect></svg>';

/**
 * `[selector, the ids every engine answers]`, measured (headless Chromium 159, Firefox 159, WebKit 27.2, 2026-11-22). The
 * `s` flag splits them: Chromium throws a `SyntaxError`, Firefox and WebKit answer — the row holds the answer, and
 * `CHROMIUM_THROWS` names it.
 */
export const ROWS = [
  ["[lang|=EN]", "lang"],
  ["[lang|=\"EN\"]", "lang"],
  ["[type=CHECKBOX]", "box"],
  ["[type=\"CheckBox\"]", "box"],
  ["[dir=rtl]", "dir"],
  ["[type=CHECKBOX s]", ""],
  ["[lang|=EN s]", ""],
  ["[data-x=hello]", ""],
  ["[data-x=hello i]", "data"],
  ["[type=checkbox]", "box"],
  ["[title=\"a\\\"b\"]", "quote"],
  ["[title='a\\'b']", ""],
  ["[title=\"a\\]b\"]", "bracket"],
  ["[title=a\\]b]", "bracket"],
  ["[title=\"a\\\\b\"]", "back"],
  ["[title=\"\\31\"]", "one"],
  ["[title=\"\\31 \"]", "one"],
  ["[title=\\31]", "one"],
  ["[title=\"a\\\nb\"]", "nl"],
  ["[ti\\tle=\"1\"]", "one"],
];
/** The rows Chromium refuses (no `s` flag there yet): it throws where the other two answer. */
export const CHROMIUM_THROWS = new Set(["[type=CHECKBOX s]", "[lang|=EN s]"]);

/** The ids a selector answers over `MARKUP` in `doc`, joined; a refusal is `THREW <name>`. */
export const answer = (doc, selector) => {
  const host = doc.createElement('div');
  host.innerHTML = MARKUP;
  try {
    return [...host.querySelectorAll(selector)].map((element) => element.id).join(',');
  } catch (error) {
    return `THREW ${error.name}`;
  }
};
