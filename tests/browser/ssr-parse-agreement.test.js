/**
 * **Where the server's reading of markup must be the browser's** (2026-11-23), in each engine, on markup the real server
 * produced (`scripts/build-hydration-fixture.mjs`, `--check`ed in the gate). Each shape is one where the two readings
 * differed and the difference ran code: a `<` inside a quoted static value let a bound value escape its quotes; an HTML
 * `<style>` appended to an `<svg>` was served as raw text the browser reads as markup; a script's double-escaped text
 * ran past the first `</script>` while the server ended it there; and a quote or a leading `=` is part of an attribute
 * name, so `<script x"type="application/json">` has no `type`. The node suites check the server's side against jsdom;
 * these rows hold the engines to the rule the server now follows.
 */
import { expect } from '@esm-bundle/chai';
import { PARSE_AGREEMENT } from './fixtures/hello-ssr.html.js';

/** The markup parsed by this engine, as a page's parser builds it (no script runs). */
const parsed = (markup) => {
  const holder = document.createElement('div');
  holder.setHTMLUnsafe(markup);
  return holder;
};

it('a bound value after a static value holding `<` stays inside its quotes', () => {
  const input = parsed(PARSE_AGREEMENT.quotedLt).querySelector('input');
  expect(input, 'CONTROL: the input was served').to.not.equal(null);
  expect(input.hasAttribute('onclick')).to.equal(false, PARSE_AGREEMENT.quotedLt);
  expect(input.getAttribute('title')).to.equal('a <i value=1');
  expect(input.getAttribute('value')).to.equal('x onclick=window.ssrQuotedLtRan=1 y');
});

/**
 * A `<` in a static unquoted value or name has no escape, so the server keeps where the tag starts: a bound `id` then
 * replaces the static one, as the client's `setAttribute` does. By the last `<`, the static `id=a` was served first.
 */
it('a bound name written again replaces the earlier write past a `<` in an unquoted value or a name', () => {
  for (const [key, name, value] of [['unquotedLt', 'title', 'x<c'], ['nameLt', 'x<c', '1']]) {
    const b = parsed(PARSE_AGREEMENT[key]).querySelector('b');
    expect(b, `CONTROL: the element was served (${key})`).to.not.equal(null);
    expect(b.getAttribute(name)).to.equal(value, PARSE_AGREEMENT[key]);
    expect(b.id).to.equal('B', PARSE_AGREEMENT[key]);
  }
});

it('an HTML style appended to an svg is served as text the svg reads as text: no element from it', () => {
  const holder = parsed(PARSE_AGREEMENT.svgStyle);
  const style = holder.querySelector('svg style');
  expect(style, 'CONTROL: the style was served inside the svg').to.not.equal(null);
  /** Anywhere: an `<img>` read as markup there breaks out of the svg altogether. */
  expect(holder.querySelector('img')).to.equal(null, PARSE_AGREEMENT.svgStyle);
  expect(style.textContent).to.equal('<img src=x onerror="window.ssrSvgStyleRan = 1">');
});

it("a double-escaped script runs on past its first </script>, and the server's parser reads it so", () => {
  const holder = parsed(PARSE_AGREEMENT.doubleEscaped);
  const scripts = holder.querySelectorAll('script');
  expect(scripts.length).to.equal(1, 'one script: the inner </script> ended nothing');
  expect(scripts[0].textContent).to.include('window.ssrDoubleEscaped = 1', 'the line after it is script text');
  expect(holder.querySelector('p')?.textContent).to.equal('after', 'CONTROL: the script ended at its second </script>');
  expect(PARSE_AGREEMENT.doubleEscapedScripts).to.equal(scripts.length, "the server's parser counts the same scripts");
  expect(PARSE_AGREEMENT.doubleEscapedText).to.equal(scripts[0].textContent, "and reads the same text");
});

it('a quote or a leading = is part of an attribute name: such a script has no type', () => {
  for (const [markup, name] of [
    ['<script x"type="application/json"></script>', 'x"type'],
    ['<script =type="application/json"></script>', '=type'],
  ]) {
    const script = parsed(markup).querySelector('script');
    expect(script.getAttributeNames()).to.deep.equal([name], markup);
    expect(script.hasAttribute('type')).to.equal(false, markup);
  }
  /** CONTROL: a quote inside an earlier name leaves a later `type` alone. */
  expect(parsed(`<script a'b type='application/json'></script>`).querySelector('script').type).to.equal('application/json');
});
