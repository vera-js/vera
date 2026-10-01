/**
 * The table for `ssr-foreign-raw-text.test.mjs`: every element the browser reads as raw text, in every context that
 * changes how it parses, against every hole shape. Built as template objects so the table can be generated — each
 * `strings` array is its own call site, exactly as a distinct `html` literal would be.
 */
const tpl = (strings, values, type = 1) => {
  const array = Object.freeze(Object.assign([...strings], { raw: Object.freeze([...strings]) }));
  return { ['_$litType$']: type, strings: array, values };
};

export const TAGS = ['style', 'script', 'textarea', 'title', 'iframe', 'noscript', 'xmp', 'noembed', 'noframes', 'plaintext'];

/** Closes everything the value might be inside, then injects — the payload a raw-text misreading lets through. */
const CLOSERS = [...TAGS, 'svg', 'math', 'foreignObject', 'mtext', 'template'].map((t) => `</${t}>`).join('');
const PWN = '<img id=pwn src=x onerror=1>';

/** Where a hole sits relative to the raw-text element `t`: its content, an attribute of it, a URL inside it, or a raw-text element inside it. */
export const HOLES = {
  text: (t) => [[`<${t}>`, `</${t}>`], CLOSERS + PWN],
  quoted: (t) => [[`<${t} title="`, `"></${t}>`], `"' onerror=1 x="><${'img'} id=pwn src=x onerror=1>`],
  unquoted: (t) => [[`<${t} title=`, `></${t}>`], ` onerror=1 x>${PWN}`],
  url: (t) => [[`<${t}><a href="`, `">x</a></${t}>`], 'javascript:alert(1)'],
  styleInside: (t) => [[`<${t}><style>`, `</style></${t}>`], CLOSERS + PWN],
};

/** How each context wraps a hole's template: the statics around it, or a nesting, or the template's own type. */
export const CONTEXTS = {
  html: (s, v) => tpl(s, [v]),
  svg: (s, v) => wrap('<svg>', '</svg>', s, v),
  math: (s, v) => wrap('<math>', '</math>', s, v),
  foreignObject: (s, v) => wrap('<svg><foreignObject>', '</foreignObject></svg>', s, v),
  mtext: (s, v) => wrap('<math><mtext>', '</mtext></math>', s, v),
  /** Case and whitespace variants of the same start and end tags. */
  SVG: (s, v) => wrap('<SVG>', '</SVG >', s, v),
  Svg: (s, v) => wrap('<Svg\n>', '</svg\n>', s, v),
  /** An unquoted attribute value ended by the tag's own `>`. */
  svgUnquoted: (s, v) => wrap('<svg width=10>', '</svg>', s, v),
  svgTemplate: (s, v) => tpl(s, [v], 2),
  mathmlTemplate: (s, v) => tpl(s, [v], 3),
  /** A template rendered into a parent's foreign position — directly, in an array, and through `hold`'s wrapper. */
  nested: (s, v) => tpl(['<svg>', '</svg>'], [tpl(s, [v])]),
  nestedArray: (s, v) => tpl(['<svg>', '</svg>'], [[tpl(s, [v])]]),
  nestedHold: (s, v) => tpl(['<math>', '</math>'], [{ $h: tpl(s, [v]) }]),
};

const wrap = (before, after, [first, last], v) => tpl([before + first, last + after], [v]);

/**
 * The page shell a caller splices an `svg`/`mathml` template's output into — which the server never sees. A foreign
 * template rendered standalone is headed for foreign content, so its output is ALSO parsed inside one.
 */
const SHELLS = { svgTemplate: ['<svg>', '</svg>'], mathmlTemplate: ['<math>', '</math>'] };

export const ROWS = [];
for (const tag of TAGS)
  for (const [context, build] of Object.entries(CONTEXTS))
    for (const [hole, shape] of Object.entries(HOLES)) {
      const [strings, value] = shape(tag);
      ROWS.push({ label: `${context} × <${tag}> × ${hole}`, template: () => build(strings, value), shell: SHELLS[context] });
    }

/**
 * Correctness, not safety: foreign depth has to come BACK down, or every `<style>` after an `<svg>` is escaped into
 * a selector that matches nothing. Each row's output must contain `expect` exactly.
 */
export const EXACT = [
  { label: 'after </svg>', template: () => tpl(['<svg></svg><style>', '</style>'], ['.a > .b']), expect: '<style>.a > .b</style>' },
  { label: 'after </math>', template: () => tpl(['<math></math><style>', '</style>'], ['.a > .b']), expect: '<style>.a > .b</style>' },
  { label: 'after a self-closed <svg/>', template: () => tpl(['<svg/><style>', '</style>'], ['.a > .b']), expect: '<style>.a > .b</style>' },
  { label: 'after </SVG >', template: () => tpl(['<SVG></SVG ><style>', '</style>'], ['.a > .b']), expect: '<style>.a > .b</style>' },
  { label: 'a plain <style>', template: () => tpl(['<style>', '</style>'], ['.a > .b']), expect: '<style>.a > .b</style>' },
  { label: 'textarea after </svg>', template: () => tpl(['<svg></svg><textarea>', '</textarea>'], ['a&b']), expect: '<textarea>a&#38;b</textarea>' },
];
