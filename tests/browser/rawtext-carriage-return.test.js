/**
 * Why a carriage return cannot survive a server round trip **inside `<style>` or `<script>`**, when
 * it survives everywhere else.
 *
 * Pass 86 established the general rule and fixed it: the input-stream preprocessor collapses CR and
 * CRLF to a single LF *before* tokenization, and character references are resolved *after*, so
 * `&#13;` carries a CR through. That fix landed on the escaper for text and attributes.
 *
 * RAWTEXT is the branch it could not reach. A browser does not decode a character reference inside
 * `<style>` or `<script>` — that is what makes them RAWTEXT — so the escaped form is not an escape
 * there, it is the literal six characters. The preprocessor still runs. There is therefore **no
 * spelling of a CR** that survives in those two elements, which is why `@verajs/ssr`'s README lists
 * it beside NUL and the lone surrogate rather than claiming a fix.
 *
 * Asserted against the engines because both halves are the platform's decision, and `CLAUDE.md` is
 * explicit that jsdom is never the oracle for one.
 */
import { expect } from '@esm-bundle/chai';

const parse = (markup) => {
  const host = document.createElement('div');
  host.innerHTML = markup;
  return host;
};

it('the preprocessor collapses a CR inside RAWTEXT, as it does everywhere', () => {
  for (const tag of ['style', 'script']) {
    expect(parse(`<${tag}>a\rb</${tag}>`).querySelector(tag).textContent, `${tag}: bare CR`).to.equal('a\nb');
    expect(parse(`<${tag}>a\r\nb</${tag}>`).querySelector(tag).textContent, `${tag}: CRLF`).to.equal('a\nb');
  }
});

it('and a character reference is NOT decoded there, so the escape used elsewhere is not available', () => {
  for (const tag of ['style', 'script']) {
    const text = parse(`<${tag}>a&#13;b</${tag}>`).querySelector(tag).textContent;
    expect(text, `${tag}: a reference inside RAWTEXT is literal text`).to.equal('a&#13;b');
    expect(text, `${tag}: it must not decode to a CR`).to.not.equal('a\rb');
  }
});

/**
 * The contrast that makes it a divergence rather than a curiosity: RCDATA *does* decode references,
 * which is why `<title>` and `<textarea>` keep ordinary escaping and round-trip a CR correctly.
 */
it('RCDATA does decode a character reference, which is why those elements round-trip', () => {
  for (const tag of ['title', 'textarea']) {
    expect(parse(`<${tag}>a&#13;b</${tag}>`).querySelector(tag).textContent, `${tag}`).to.equal('a\rb');
  }
});
