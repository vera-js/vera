/**
 * `innerText` and `isContentEditable`, in the engines that decide them.
 *
 * jsdom implements neither, so the generated differential skips both and the SSR shim had never
 * been compared against anything here. `innerText` is the one of the pair that reaches **markup**:
 * its setter turns line breaks into `<br>`, which `textContent` does not, so the difference is
 * visible on the rendered page rather than only to a component reading a property back.
 */
import { expect } from '@esm-bundle/chai';

it('turns every line break into a <br> when innerText is assigned', () => {
  for (const attach of [false, true]) {
    const element = document.createElement('div');
    if (attach) document.body.appendChild(element);
    element.innerText = 'a\nb';
    expect(element.innerHTML, `attached: ${attach}`).to.equal('a<br>b');
    element.remove();
  }

  /** All three spellings of a break, and each is one `<br>` — `\r\n` is not two. */
  const element = document.createElement('div');
  element.innerText = 'a\r\nb\rc';
  expect(element.innerHTML, 'CRLF, CR and LF').to.equal('a<br>b<br>c');

  /** And the text between the breaks is escaped, not parsed as markup. */
  const escaped = document.createElement('div');
  escaped.innerText = '<b>&</b>';
  expect(escaped.textContent, 'the text survives verbatim').to.equal('<b>&</b>');
  expect(escaped.querySelector('b'), 'and no element was created').to.equal(null);
});

/**
 * The getter is layout-dependent, so it is only pinned here for a **detached** element — which is
 * the case the shim is an analogue of, since nothing it renders is ever in a laid-out document.
 * Detached, every engine falls back to `textContent`, script text included.
 */
it('falls back to textContent for a detached element', () => {
  const element = document.createElement('div');
  element.innerHTML = '<b>x</b><script>y</script>';
  expect(element.innerText).to.equal('xy');
});

/**
 * `isContentEditable` follows the `contentEditable` *state*, so `plaintext-only`, an empty
 * attribute and `TRUE` are all editable — comparing the attribute's text to `'true'` gets all three
 * wrong.
 *
 * **Asserted on an attached element on purpose.** WebKit's answer for a detached one is unstable:
 * it flips depending on whether an attached editable element happens to exist elsewhere in the
 * document, so it is not evidence about the mapping. Attached, all three engines agree.
 */
it('reads isContentEditable from the state', () => {
  const answers = {};
  for (const value of ['true', 'false', 'plaintext-only', 'TRUE', '']) {
    const element = document.createElement('div');
    element.setAttribute('contenteditable', value);
    document.body.appendChild(element);
    answers[value || '(empty)'] = element.isContentEditable;
    element.remove();
  }
  expect(answers).to.deep.equal({
    true: true, false: false, 'plaintext-only': true, TRUE: true, '(empty)': true,
  });
  expect(document.createElement('div').isContentEditable, 'absent').to.equal(false);
});
