/**
 * The one table `tests/ssr-attribute-parity.test.mjs` renders on both sides. A module rather than JSON so
 * both processes build the SAME values — an object with its own `toString` cannot cross a process
 * boundary as data. Data only: importing this renders nothing.
 */

/** Every position a bound attribute value can take. Each shape is filled with one value per hole. */
export const SHAPES = {
  'unquoted': ['<p title=', '>t</p>'],
  'unquoted, static prefix': ['<p title=pre', '>t</p>'],
  'unquoted, static suffix': ['<p title=', 'suf>t</p>'],
  'unquoted, two holes': ['<p title=', '', '>t</p>'],
  'unquoted, statics between holes': ['<p title=a', 'b', 'c>t</p>'],
  'unquoted, then another attribute': ['<p title=', ' id=x>t</p>'],
  'unquoted prefix, then another attribute': ['<p title=pre', ' id=x>t</p>'],
  'spaced =': ['<p title = ', '>t</p>'],
  'spaced =, quoted': ['<p title = "', '">t</p>'],
  'double-quoted': ['<p title="', '">t</p>'],
  'single-quoted': ["<p title='", "'>t</p>"],
  'double-quoted, static prefix': ['<p title="x', '">t</p>'],
  'double-quoted, two holes': ['<p title="', '', '">t</p>'],
  /** A `"` inside a single-quoted static must not close the double quotes the server writes around it. */
  'single-quoted, static with a double quote': ["<p title='a\"b", "'>t</p>"],
  /** An entity in a STATIC is decoded by the browser in any quoting — it must stay an entity. */
  'double-quoted, static entity': ['<p title="&amp;', '">t</p>'],
  'two bound attributes': ['<p title=', ' lang=', '>t</p>'],
  /**
   * **An unquoted value followed by `/>`**: the slash is the tag's self-close, never part of the value — the client's
   * scanner says so, and a server that took it as value text served `r="5/"` and left the element OPEN, so the next
   * element parsed as its CHILD. The commonest SVG there is (`<circle r=${r}/>`, `<path d=${d}/>`), and an HTML void.
   */
  'unquoted, then /> (svg)': ['<svg><circle r=', '/><rect id="after"/></svg>'],
  'unquoted, then space /> (svg)': ['<svg><circle r=', ' /><rect id="after"/></svg>'],
  'unquoted, static prefix, then /> (svg)': ['<svg><path d=M', '/><rect id="after"/></svg>'],
  'unquoted, then /> on an html void': ['<input value=', '/><b>after</b>'],
};

/** The coercion edges: sole nullish drops the attribute, joined nullish is `''`, `false` is the text "false". */
export const VALUES = [
  'a b',
  null,
  undefined,
  false,
  true,
  0,
  '',
  ' onmouseover=alert(1) x=',
  'q"u\'o&t',
  /** An entity in a VALUE is text: it must come out as the literal `&amp;`, never decoded. */
  '&amp;',
  '<b>',
  ['x', 'y'],
  { toString: () => 'from toString' },
];

/**
 * Shapes whose holes take DIFFERENT values, so the answer shows which one won. Duplicate names are where
 * the two sides differ by construction: the client renames each bound attribute to its own marker, so every
 * binding survives parsing and the last `setAttribute` wins; the parser keeps the FIRST of two written names.
 */
export const EXPLICIT = [
  { label: 'duplicate: bound then bound', strings: ['<p title=', ' title=', '>t</p>'], values: ['first', 'second'] },
  { label: 'duplicate: static then bound', strings: ['<p title="s" title=', '>t</p>'], values: ['bound'] },
  { label: 'duplicate: bound then static', strings: ['<p title=', ' title="s">t</p>'], values: ['bound'] },
  { label: 'duplicate: static then QUOTED bound', strings: ['<p title="s" title="', '">t</p>'], values: ['bound'] },
  /** Space around `=` does not stop a sigil being a sigil — the client's scanner reads it, so must the server's. */
  { label: 'spaced sigil: ?hidden = true', strings: ['<p ?hidden = ', '>t</p>'], values: [true] },
  { label: 'spaced sigil: ?hidden = false', strings: ['<p ?hidden = ', '>t</p>'], values: [false] },
  { label: 'spaced event: onClick = fn', strings: ['<p onClick = ', '>t</p>'], values: [() => {}] },
  { label: 'spaced event, quoted: @click = "fn"', strings: ['<p @click = "', '">t</p>'], values: [() => {}] },
  { label: 'joined nullish is empty text: "x${null}"', strings: ['<p title="x', '">t</p>'], values: [null] },
  { label: 'sole false is the text "false"', strings: ['<p title=', '>t</p>'], values: [false] },
  /** Other kinds of binding before the attribute: per-binding compile data is indexed by BINDING, not by attribute. */
  { label: 'a text binding, then an attribute', strings: ['<b>', '</b><p title=pre', '>t</p>'], values: ['bold', 'v'] },
  { label: 'a boolean, then a quoted attribute', strings: ['<p ?hidden=', ' title="', '">t</p>'], values: [false, 'v'] },
  /**
   * A nested `<template>`'s content is inert markup the client never walks: its bindings are ignored on BOTH
   * sides — no value, no marker — while a binding on the `<template>` element itself is an ordinary attribute.
   */
  { label: 'nested template: a child binding', strings: ['<div><template><p>', '</p></template></div>'], values: ['x'] },
  { label: 'nested template: an attribute with statics', strings: ['<div><template><p title="a', 'b" id="k">t</p></template></div>'], values: ['x'] },
  { label: 'nested template: a boolean and a sole attribute', strings: ['<div><template><p ?hidden=', ' lang=', '>t</p></template></div>'], values: [true, 'en'] },
  { label: 'nested template, twice nested', strings: ['<template><template><p title=', '>', '</p></template></template>'], values: ['x', 'y'] },
  { label: 'a binding ON the template element is reached', strings: ['<div><template id=', '><p>t</p></template></div>'], values: ['k'] },
  { label: 'a binding AFTER a nested template closes is reached', strings: ['<div><template><p>t</p></template><p title=', '>', '</p></div>'], values: ['k', 'text'] },
  /**
   * **A sigil is the first character of a name, and the name is ANY name character** — the client's scanner's rule.
   * The server took only a letter after the sigil, so these were served as attributes WITH the sigil (`._private="v"`;
   * `@_tap` printed the handler's SOURCE into the page; `.__proto__`, which both sides refuse, became an attribute) —
   * and it read a sigil character INSIDE a name as a sigil (`data-x.y` lost its `.y`).
   */
  ...[['._private', 'v'], ['.$x', 'v'], ['.9x', 'v'], ['?_flag', true], ['!_live', 'v'], ['@_tap', function secretHandler() { return 42; }], ['.__proto__', { polluted: true }], ['!__proto__', { polluted: true }]].map(
    ([name, value]) => ({ label: `sigil name ${name}`, strings: [`<p ${name}=`, '>t</p>'], values: [value] })
  ),
  { label: 'a sigil character inside a name is part of it: data-x.y', strings: ['<p data-x.y=', '>t</p>'], values: ['v'] },
  { label: 'a sigil character inside a name, quoted: data-x.y', strings: ['<p data-x.y="', '">t</p>'], values: ['v'] },
  /** A template ending inside a value is refused on both sides now — `ssr-template-boundaries.test.mjs`. */
];

export const CASES = [
  ...Object.entries(SHAPES).flatMap(([shape, strings]) =>
    VALUES.map((value) => ({
      label: `${shape} · ${typeof value === 'object' && value !== null && !Array.isArray(value) ? '{toString}' : JSON.stringify(value)}`,
      strings,
      values: Array(strings.length - 1).fill(value),
    }))
  ),
  ...EXPLICIT,
];

export const template = ({ strings, values }) => ({
  _$litType$: 1,
  strings: Object.freeze(Object.assign([...strings], { raw: [...strings] })),
  values,
});
