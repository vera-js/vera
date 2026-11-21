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
  it('PLATFORM: after a user\'s reset a task sees the restored value (a microtask still sees the old on Chromium and WebKit, the new on Firefox); after form.reset() both see the new', async () => {
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
    await until(() => user.task !== undefined, 'the task ran', 2000);
    /** Firefox restores before the checkpoint; Chromium and WebKit after it. The field rests only on the task. */
    const microtask = navigator.userAgent.includes('Firefox/') ? 'start' : 'typed';
    expect(user).to.deep.equal({ microtask, task: 'start' }, 'a user reset: the task sees the restore; the microtask reads per engine');
    input.value = 'typed';
    const script = read();
    f.reset();
    await until(() => script.task !== undefined, 'the task ran', 2000);
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
    await until(() => count.textContent === '0 / 40', 'the count re-read after the restore', 2000);
    f.remove();
  });

  it('after a user\'s failed submit, the first invalid control in tree order is focused and its error shows', async () => {
    const f = form('<input id="ok" value="x"><vera-field><label>Email</label><input required id="email"><small data-vera-part="error" data-when="valueMissing">Enter your email.</small></vera-field><input required id="later"><button>Send</button>');
    f.addEventListener('submit', (event) => event.preventDefault());
    const later = {};
    f.querySelector('#later').addEventListener('invalid', (event) => (later.prevented = event.defaultPrevented));
    await flush();
    f.querySelector('button').focus();
    await sendKeys({ press: 'Enter' });
    await until(() => document.activeElement?.id === 'email', 'focus reached the first invalid control', 2000);
    const error = f.querySelector('[data-vera-part="error"]');
    expect(error.hidden).to.equal(false);
    expect(f.querySelector('#email').getAttribute('aria-invalid')).to.equal('true');
    expect(later.prevented).to.equal(true, 'the field reported the attempt: the later bare control shows no bubble');
    f.remove();
  });

  it('after a user\'s failed submit whose first invalid is a bare control, the browser reports it as native does', async () => {
    const f = form('<input required id="bare"><vera-field><label>Email</label><input required id="email"><small data-vera-part="error" data-when="valueMissing">Enter your email.</small></vera-field><button>Send</button>');
    f.addEventListener('submit', (event) => event.preventDefault());
    const bare = {};
    f.querySelector('#bare').addEventListener('invalid', (event) => (bare.prevented = event.defaultPrevented));
    await flush();
    f.querySelector('button').focus();
    await sendKeys({ press: 'Enter' });
    await until(() => document.activeElement?.id === 'bare', 'focus reached the bare control', 2000);
    expect(bare.prevented).to.equal(false, 'the bare control keeps its native report');
    f.remove();
  });
});
