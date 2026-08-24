/**
 * The five defects the SSR audit found, each pinned. Four are about a *server* — a thing that
 * handles more than one request, which is the condition none of them survived.
 *
 * This import installs the server environment and MUST come before anything that pulls in
 * `@verajs/core`.
 */
import { renderToString, serializeTemplate } from '@verajs/ssr/vera';
import assert from 'node:assert/strict';

const { html } = await import('@verajs/core');
const fixture = (name) => new URL(`./fixtures/ssr/${name}`, import.meta.url);

/* ── concurrent requests ──────────────────────────────────────────────────────────────────────
 * The entry tag used to be found by snapshotting the registry, awaiting the import, and diffing.
 * Two renders overlapping — the normal condition for a server — both saw both modules' new
 * registrations, and both picked the last. A request for one component was answered with another's
 * markup. Measured before the fix: both of these returned `race-b-ssr`.
 */
{
  const [a, b] = await Promise.all([
    renderToString(fixture('race-a-ssr.js')),
    renderToString(fixture('race-b-ssr.js')),
  ]);
  assert.ok(a.html.startsWith('<race-a-ssr>'), `concurrent request A got: ${a.html.slice(0, 40)}`);
  assert.ok(b.html.startsWith('<race-b-ssr>'), `concurrent request B got: ${b.html.slice(0, 40)}`);
}

/** A module that defines an element but exports nothing has to be told, not guessed at. */
{
  await assert.rejects(
    () => renderToString(fixture('attrs-parent-ssr.js'), { tag: 'no-such-tag' }),
    /no custom element definition found/,
    'an unknown tag is refused rather than substituted'
  );
}

/* ── styles belong to the page that rendered them ─────────────────────────────────────────────
 * `hoistedStyles` was a flat array that no render ever scoped, so response two carried response
 * one's CSS and response fifty carried everyone's — every page shipping the whole design system,
 * and disclosing which components live on pages the visitor never asked for.
 */
{
  const first = await renderToString(fixture('styled-a-ssr.js'));
  assert.match(first.styles, /styled-a-ssr/, 'its own styles are present');

  const second = await renderToString(fixture('styled-b-ssr.js'));
  assert.match(second.styles, /styled-b-ssr/, 'its own styles are present');
  assert.doesNotMatch(second.styles, /styled-a-ssr/, 'and not the previous request’s');

  const third = await renderToString(fixture('styled-a-ssr.js'));
  assert.match(third.styles, /styled-a-ssr/, 'a repeat render still carries its styles');
  assert.doesNotMatch(third.styles, /styled-b-ssr/, 'and still only its own');
}

/* ── attributes survive the round trip ────────────────────────────────────────────────────────
 * Nested components are found by scanning the markup this module just wrote, so their attribute
 * values arrive escaped. Handing that straight to `setAttribute` gave the child `Tom &#38; Jerry`
 * and re-escaping produced `&#38;#38;` — entity codes on the page, and a mismatch against whatever
 * the client computes on hydration.
 */
{
  const { html: markup } = await renderToString(fixture('attrs-parent-ssr.js'));

  assert.ok(!/&#38;#/.test(markup), `double-escaped output: ${markup}`);
  assert.match(markup, /<p>Tom &#38; Jerry &#60;b&#62;&#34;quoted&#34;<\/p>/,
    'the child rendered exactly what the parent passed, escaped once');

  /** Single-quoted, unquoted and valueless statics all parse; none invent extra attributes. */
  assert.match(markup, /<b>single\|unquoted\|<\/b>/, `attribute forms mis-parsed: ${markup}`);
}

/* ── a slot is classified by where it is, not by what precedes it ─────────────────────────────
 * `PLAIN_ATTRIBUTE_TAIL` and the sigil test ran on any static ending the right way, wherever it
 * sat. Text ending in `total=` was written as an unquoted attribute, so the server produced
 * `<p>total="5"</p>` where the client — which hands markup to the platform's parser — produced
 * `<p>total=5</p>`.
 */
{
  assert.equal(serializeTemplate(html`<p>total=${5}</p>`), '<p>total=5</p>');
  assert.equal(serializeTemplate(html`<p>Ratio a=${1} b=${2}</p>`), '<p>Ratio a=1 b=2</p>');
  assert.equal(serializeTemplate(html`<p>set ?open=${1} and .value=${2}</p>`),
    '<p>set ?open=1 and .value=2</p>', 'sigils in text are text');

  /** And every genuine binding kind still resolves, including one spanning several slots. */
  assert.equal(serializeTemplate(html`<p class=${'x'}>t</p>`), '<p class="x">t</p>');
  assert.equal(serializeTemplate(html`<p class="a ${'b'} c" id=${'i'}>t</p>`), '<p class="a b c" id="i">t</p>');
  assert.equal(serializeTemplate(html`<p ?hidden=${true}>t</p>`), '<p hidden="">t</p>');
  assert.equal(serializeTemplate(html`<p ?hidden=${false}>t</p>`), '<p>t</p>');
  assert.equal(serializeTemplate(html`<input .value=${'v'} />`), '<input value="v" />');
  assert.equal(serializeTemplate(html`<button @click=${() => {}}>b</button>`), '<button>b</button>');
  assert.equal(serializeTemplate(html`<p class=${'x'}>total=${5}</p>`), '<p class="x">total=5</p>',
    'the tag closing puts the next slot back in text');
}

console.log('ssr request isolation ok — concurrency, per-page styles, attribute round trip, slot position');
