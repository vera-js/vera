/**
 * **The SSR diagnostics channel — because the audience is not at the other door.**
 *
 * `renderMotion` returns its `problems` to the caller, which is a server process. An author working
 * on an SSR-ONLY page never hydrates, so the client scanner never runs, so nothing reaches the
 * browser they are actually looking at. Principle 11 puts it as a gap rather than a channel: *where
 * the audience is not present at the door — a warning printed during server rendering, read by a
 * build terminal — say so.* This is the door they are present at.
 *
 * Three properties, and the escaping one is a security property rather than a nicety.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const { renderMotion } = await load('motion/ssr');

/** A page whose motion elements are fine, and one whose value is refused — the refusal is what
 *  gives the channel something to carry. */
const page = (body) => new JSDOM(`<!doctype html><html><head></head><body>${body}</body></html>`);

const CLEAN = '<div data-vd-motion="{ keyframes: { opacity: \'0% 0, 100% 1\' } }">a</div>';
/** `inertia` is a number setting with bounds; a string is refused by the parser, which is a real
 *  problem code rather than one invented for this suite. */
const BROKEN = '<div data-vd-motion="{ keyframes: { opacity: \'0% 0, 100% 1\' }, inertia: \'nope\' }">a</div>';

const scriptIn = (dom) => dom.window.document.querySelector('script[data-vm-diagnostics]');

test('a page with no problems carries no script at all', () => {
  const dom = page(CLEAN);
  const report = renderMotion(dom.window.document, { diagnostics: true });
  assert.equal(report.problems.length, 0,
    'NON-ZERO CONTROL: this fixture must actually be clean, or the assertion below is vacuous');
  assert.equal(scriptIn(dom), null, 'a clean page must pay nothing for a channel it does not need');
});

test('a page with problems carries them to the browser console', () => {
  const dom = page(BROKEN);
  const report = renderMotion(dom.window.document, { diagnostics: true });
  assert.ok(report.problems.length > 0,
    'NON-ZERO CONTROL: the fixture must actually produce a problem, or nothing below is tested');

  const script = scriptIn(dom);
  assert.ok(script, 'the problems the server found never reached the page the author is looking at');
  assert.match(script.textContent, /console\.warn/, 'it must actually log');
  assert.match(script.textContent, /\[vera\] motion:/,
    'every diagnostic this framework prints carries the [vera] prefix, so one filter finds them all');
  for (const { code } of report.problems) {
    assert.ok(script.textContent.includes(code), `the script must name the problem code ${code}`);
  }
});

/**
 * **One grouped emission, never one call per problem.** Principle 11: *a channel that reports once
 * lies about completion.* An author who fixes the first of several and re-renders must see the rest,
 * not discover them one render at a time — so every problem ships in the same script.
 */
test('every problem rides the same script', () => {
  const dom = page(BROKEN + BROKEN.replace('nope', 'also-bad').replace('opacity', 'scale'));
  const report = renderMotion(dom.window.document, { diagnostics: true });
  assert.ok(report.problems.length >= 2,
    `NON-ZERO CONTROL: expected at least two problems, got ${report.problems.length}`);
  assert.equal(dom.window.document.querySelectorAll('script[data-vm-diagnostics]').length, 1,
    'one script, not one per problem');
});

/**
 * **The injection test, and it is the reason this file exists at all.**
 *
 * A problem's arguments are author content — and on a data-driven page, content that came from a
 * database. `textContent` does NOT escape inside a `<script>`: the HTML parser treats it as raw
 * text, so a value containing `</script>` ends the element and everything after it parses as
 * markup. This feeds exactly that through a real diagnostic and re-parses the rendered HTML to see
 * what a browser would actually build.
 */
test('a value that tries to close the script cannot', () => {
  const attack = '</script><img src=x onerror=alert(1)>';
  /**
   * `motion-bad-value` is used deliberately: it ECHOES the offending value. Most refusals do not —
   * `motion-setting-number` names the key and the legal range and never repeats what you wrote — and
   * the first draft of this test used one of those, so the payload never reached the script and the
   * whole case passed without exercising the escaping at all. Measured across seven refusal shapes,
   * four echo author text: an unknown key's NAME, an unknown property's name, a bad keyframe value,
   * and an unknown preset's name. So the injection surface is real, not theoretical.
   */
  const dom = page(`<div data-vd-motion="{ keyframes: { opacity: '${attack}' } }">a</div>`);
  const report = renderMotion(dom.window.document, { diagnostics: true });
  assert.ok(report.problems.length > 0, 'NON-ZERO CONTROL: the hostile value must be reported');
  assert.ok(JSON.stringify(report.problems).includes('onerror'),
    'NON-ZERO CONTROL: the diagnostic must actually CARRY the hostile text, or this tests nothing');

  const html = dom.serialize();
  /** Re-parse as a browser would: the question is what the PARSER builds, not what the string says. */
  const reparsed = new JSDOM(html);
  assert.equal(reparsed.window.document.querySelector('img'), null,
    'the payload escaped the script element and became real markup — this is an XSS sink');
  assert.equal(reparsed.window.document.querySelectorAll('script[data-vm-diagnostics]').length, 1,
    'the diagnostic script must survive intact rather than being cut in half');
  /**
   * Scoped to the SCRIPT, not to the document. The hostile text also appears in the element's own
   * `data-vd-motion` ATTRIBUTE, where it is inert — quoted attribute values do not end elements —
   * and a document-wide search therefore fails on a page that is perfectly safe. The first draft
   * asserted exactly that and went red against correct behaviour.
   */
  const text = reparsed.window.document.querySelector('script[data-vm-diagnostics]').textContent;
  assert.ok(!/<\/script/i.test(text),
    'a literal closing tag inside the script would have ended it at parse time');
  assert.ok(text.includes('\\u003c'), 'the escape must actually be what is carrying the payload');
});

test('the nonce is carried when given, and absent when not', () => {
  const withNonce = page(BROKEN);
  renderMotion(withNonce.window.document, { diagnostics: true, nonce: 'abc123' });
  assert.equal(scriptIn(withNonce).getAttribute('nonce'), 'abc123',
    'without this a strict script-src blocks the channel SILENTLY, which reads exactly like a page ' +
      'with no problems');

  const without = page(BROKEN);
  renderMotion(without.window.document, { diagnostics: true });
  assert.equal(scriptIn(without).hasAttribute('nonce'), false);
});

/**
 * The flag, both directions. `false` must be obeyed even when there is plenty to say — that is the
 * whole point of the option for someone who does not want it — and the default follows NODE_ENV,
 * the convention every JS toolchain already trained people to expect.
 */
test('diagnostics: false is obeyed even when there are problems', () => {
  const dom = page(BROKEN);
  const report = renderMotion(dom.window.document, { diagnostics: false });
  assert.ok(report.problems.length > 0, 'NON-ZERO CONTROL: there must be something to suppress');
  assert.equal(scriptIn(dom), null, 'the opt-out must be absolute');
  assert.ok(report.problems.length > 0, 'and the caller still receives them — only the page is quiet');
});

test('the default follows NODE_ENV', () => {
  const previous = process.env['NODE_ENV'];
  try {
    process.env['NODE_ENV'] = 'production';
    const prod = page(BROKEN);
    renderMotion(prod.window.document);
    assert.equal(scriptIn(prod), null, 'production must not ship diagnostics to visitors');

    process.env['NODE_ENV'] = 'development';
    const dev = page(BROKEN);
    renderMotion(dev.window.document);
    assert.ok(scriptIn(dev), 'development is where the author is, so the default must reach them');

    delete process.env['NODE_ENV'];
    const unset = page(BROKEN);
    renderMotion(unset.window.document);
    assert.ok(scriptIn(unset),
      'an UNSET NODE_ENV counts as development, matching every other JS toolchain — the cost is ' +
        'that a production deploy which never sets it shows warnings, which `diagnostics: false` answers');
  } finally {
    if (previous === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = previous;
  }
});
