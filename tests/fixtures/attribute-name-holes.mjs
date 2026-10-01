/**
 * The one table `tests/attribute-name-holes.test.mjs` renders on BOTH sides — a module, so each process builds its
 * own values (a ref is a function, which cannot cross a process boundary). `refused`: the template must be refused
 * by the client renderer AND the server; otherwise neither may refuse it. Data only.
 */
const ref = () => () => {};
export const ROWS = [
  /* ── an expression in an attribute NAME: refused ── */
  { label: 'a whole name: <b ${n}="x">', strings: ['<b ', '="x">t</b>'], values: () => ['title'], refused: true },
  { label: 'a name prefix: data-${k}="1"', strings: ['<p data-', '="1">t</p>'], values: () => ['k'], refused: true },
  { label: 'a name prefix, no value: data-${k}', strings: ['<p data-', '>t</p>'], values: () => ['k'], refused: true },
  { label: 'a name suffix: ${k}-x="1"', strings: ['<p ', '-x="1">t</p>'], values: () => ['k'], refused: true },
  { label: 'inside a name: a${k}b="1"', strings: ['<p a', 'b="1">t</p>'], values: () => ['k'], refused: true },
  { label: 'single-quoted value: data-${k}=\'v\'', strings: ['<p data-', "='v'>t</p>"], values: () => ['k'], refused: true },
  { label: 'a bound value too: data-${k}=${v}', strings: ['<p data-', '=', '>t</p>'], values: () => ['k', 'v'], refused: true },
  { label: 'glued after a closed quote: a="1"${x}b="2"', strings: ['<p a="1"', 'b="2">t</p>'], values: () => ['x'], refused: true },
  { label: 'a bare sigil: ?${x}', strings: ['<p ?', '>t</p>'], values: () => ['hidden'], refused: true },
  { label: 'on a custom element: <my-el data-${k}="1">', strings: ['<my-el data-', '="1">t</my-el>'], values: () => ['k'], refused: true },
  { label: 'a ref, then a name: ${ref}${n}="x"', strings: ['<b ', '', '="x">t</b>'], values: () => [ref(), 'title'], refused: true },
  /* ── controls: legitimate holes in a tag, never refused ── */
  { label: 'a bare ref', strings: ['<b ', '>t</b>'], values: () => [ref()], refused: false },
  { label: 'a ref before an attribute', strings: ['<b ', ' class="c">t</b>'], values: () => [ref()], refused: false },
  { label: 'a ref, spaced self-close', strings: ['<input ', ' />'], values: () => [ref()], refused: false },
  { label: 'a ref, self-close', strings: ['<input ', '/>'], values: () => [ref()], refused: false },
  { label: 'two adjacent refs', strings: ['<b ', '', '>t</b>'], values: () => [ref(), ref()], refused: false },
  { label: 'a ref after a closed quote, spaced', strings: ['<p a="x" ', '>t</p>'], values: () => [ref()], refused: false },
  { label: 'a ref after an unquoted static', strings: ['<p title=x ', '>t</p>'], values: () => [ref()], refused: false },
  { label: 'an unquoted continuation: title=${a}${b}', strings: ['<p title=', '', '>t</p>'], values: () => ['a', 'b'], refused: false },
  { label: 'a sigil value: &=${ref}', strings: ['<p &=', '>t</p>'], values: () => [ref()], refused: false },
  { label: 'a hole in a comment', strings: ['<p><!-- data-', ' --></p>'], values: () => ['k'], refused: false },
  { label: 'a hole in raw text', strings: ['<textarea>data-', '="1"</textarea>'], values: () => ['k'], refused: false },
  { label: 'an attribute value', strings: ['<p title=', '>t</p>'], values: () => ['v'], refused: false },
  /** The TAG name is the tag entry's (`@verajs/renderer/tag`), never this rule's — whole or partial. */
  { label: 'a tag-name hole: <${t}>', strings: ['<', '>t</b>'], values: () => ['b'], refused: false },
  { label: 'a partial tag-name hole: <my-${t}>', strings: ['<my-', '>t</my-x>'], values: () => ['x'], refused: false },
];
export const T = (row) => ({ _$litType$: 1, strings: Object.freeze(Object.assign([...row.strings], { raw: [...row.strings] })), values: row.values() });
