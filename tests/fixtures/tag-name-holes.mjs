/**
 * The one table `tests/tag-name-holes.test.mjs` renders on both sides. `refused`: an expression in TAG-name position,
 * refused by the client in development and the server in every build; otherwise neither may refuse. Data only.
 */
export const ROWS = [
  { label: 'a whole tag name: <${x}>', strings: ['<', '>t</b>'], refused: true },
  { label: 'a closing tag name: </${x}>', strings: ['<b>t</', '>'], refused: true },
  { label: 'a partial tag name: <my-${x}>', strings: ['<my-', '>t</my-x>'], refused: true },
  { label: 'a partial closing name: </my-${x}>', strings: ['<my-a>t</my-', '>'], refused: true },
  { label: 'a tag name, then attributes: <${x} class="c">', strings: ['<', ' class="c">t</b>'], refused: true },
  /* ── markup state only: a `<` that opens no tag never makes a tag position ── */
  { label: 'inside a comment: <!-- <${x}> -->', strings: ['<p><!-- <', '> --></p>'], refused: false },
  { label: 'inside a textarea: <textarea><${x}>', strings: ['<textarea><', '></textarea>'], refused: false },
  { label: 'inside a style: a<${x}', strings: ['<style>a<', '</style>'], refused: false },
  { label: 'inside a script: if(a<${x})', strings: ['<script>if(a<', ')</script>'], refused: false },
  { label: 'inside a quoted value: title="a<${x}"', strings: ['<p title="a<', '">t</p>'], refused: false },
  { label: 'a text child after a tag: <p>${x}</p>', strings: ['<p>', '</p>'], refused: false },
];
export const T = (row) => ({ _$litType$: 1, strings: Object.freeze(Object.assign([...row.strings], { raw: [...row.strings] })), values: ['b'] });
