/**
 * **<vera-field> in the three engines: what jsdom cannot answer.** A user's reset (trusted input on a reset button)
 * against `form.reset()` from script, which decides why the field re-reads its count a TASK after `reset`; the count
 * re-read after a user's reset; focus after a user's failed submit. Correctness only, headless: never time with it.
 */
import { expect } from '@esm-bundle/chai';
import { sendKeys } from '@web/test-runner-commands';
import { flush, wire } from '../../packages/core/dist/development/vera.js';
import { renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import '../../packages/components/field/dist/development/vera-field.js';
import { until } from './until.js';

wire([renderer]);

const form = (inner) => {
  const element = document.createElement('form');
  element.innerHTML = inner;
  document.body.append(element);
  return element;
};

describe('vera-field', () => {
  it('PLATFORM: after a user\'s reset a microtask still sees the old value and a task the new; after form.reset() both see the new', async () => {
    const f = form('<input value="start"><button type="reset">Reset</button>');
    const input = f.querySelector('input');
    const read = () => {
      const seen = {};
      f.addEventListener(
        'reset',
        () => {
          queueMicrotask(() => (seen.microtask = input.value));
          setTimeout(() => (seen.task = input.value), 0);
        },
        { once: true },
      );
      return seen;
    };
    input.value = 'typed';
    const user = read();
    f.querySelector('button').focus();
    await sendKeys({ press: 'Enter' });
    await until(() => user.task !== undefined, 'the task ran');
    expect(user).to.deep.equal({ microtask: 'typed', task: 'start' }, 'a user reset: the restore comes after the microtask checkpoint');
    input.value = 'typed';
    const script = read();
    f.reset();
    await until(() => script.task !== undefined, 'the task ran');
    expect(script).to.deep.equal({ microtask: 'start', task: 'start' }, 'form.reset(): the checkpoint waits for the script');
    f.remove();
  });

  it('a user\'s reset re-reads the count once the browser has restored the value', async () => {
    const f = form('<vera-field><label>Bio</label><textarea maxlength="40"></textarea><span data-vera-part="count"></span></vera-field><button type="reset">Reset</button>');
    await flush();
    const textarea = f.querySelector('textarea');
    textarea.focus();
    await sendKeys({ type: 'hello' });
    const count = f.querySelector('[data-vera-part="count"]');
    expect(count.textContent).to.equal('5 / 40', 'CONTROL: the count followed real typing');
    f.querySelector('button').focus();
    await sendKeys({ press: 'Enter' });
    await until(() => count.textContent === '0 / 40', 'the count re-read after the restore');
    f.remove();
  });

  it('after a user\'s failed submit, the first invalid control in tree order is focused and its error shows', async () => {
    const f = form('<input id="ok" value="x"><vera-field><label>Email</label><input required id="email"><small data-vera-part="error" data-when="valueMissing">Enter your email.</small></vera-field><input required id="later"><button>Send</button>');
    f.addEventListener('submit', (event) => event.preventDefault());
    await flush();
    f.querySelector('button').focus();
    await sendKeys({ press: 'Enter' });
    await until(() => document.activeElement?.id === 'email', 'focus reached the first invalid control');
    const error = f.querySelector('[data-vera-part="error"]');
    expect(error.hidden).to.equal(false);
    expect(f.querySelector('#email').getAttribute('aria-invalid')).to.equal('true');
    f.remove();
  });
});
