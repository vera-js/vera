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
import '../../packages/components/input/dist/development/vera-input.js';
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

/**
 * The look: a stack, the label in the text color at weight 500, the hint and count muted, the shown error in the danger
 * color; and with input, a shown error's aria-invalid drawn as the input box's danger edge.
 */
describe('vera-field: the look', () => {
  const style = (node) => getComputedStyle(node);
  const mount = async (inner) => {
    const holder = document.createElement('div');
    holder.innerHTML = inner;
    document.body.append(holder);
    flush();
    await Promise.resolve();
    flush();
    return holder;
  };

  it('a stack of its parts; the label at weight 500, the hint muted, the error the danger token (CONTROL: look none leaves the UA label)', async () => {
    const holder = await mount(
      '<div style="--vera-danger: rgb(1, 2, 3); --vera-fg-muted: rgb(4, 5, 6)">' +
        '<vera-field><label>Email</label><input><small data-vera-part="hint">Hint</small><small data-vera-part="error" data-when="server">Taken</small></vera-field>' +
        '<vera-field data-vera-look="none"><label>Email</label><input></vera-field></div>',
    );
    const [on, off] = holder.querySelectorAll('vera-field');
    expect(style(on).display, 'the field stacks its parts (a flex column)').to.equal('flex');
    expect(Number(style(on.querySelector('label')).fontWeight), 'the label at weight 500').to.equal(500);
    expect(style(on.querySelector('[data-vera-part="hint"]')).color, 'the hint is the muted token').to.equal('rgb(4, 5, 6)');
    expect(style(on.querySelector('[data-vera-part="error"]')).color, 'the error is the danger token').to.equal('rgb(1, 2, 3)');
    expect(Number(style(off.querySelector('label')).fontWeight), 'look none: the UA label weight').to.equal(400);
    expect(style(off).display, 'look none: no stack').to.not.equal('flex');
    holder.remove();
  });

  /** The field and input together, not the field's look: the field marks the control aria-invalid, input's box draws it. */
  it("while an error shows, the input's box inside is drawn in the danger color: the field marks it aria-invalid (CONTROL: a field with none shown is not)", async () => {
    const holder = await mount(
      '<div style="--vera-danger: rgb(1, 2, 3)">' +
        '<vera-field><label>Name</label><vera-input><input></vera-input><small data-vera-part="error" data-when="server">Taken</small></vera-field>' +
        '<vera-field><label>Name</label><vera-input><input></vera-input><small data-vera-part="error" hidden>Taken</small></vera-field></div>',
    );
    const [erring, quiet] = holder.querySelectorAll('vera-input');
    expect(holder.querySelector('[data-when="server"]').hidden, 'CONTROL: the server error is shown').to.equal(false);
    await until(() => style(erring).borderTopColor === 'rgb(1, 2, 3)', "the erring field's input box is the danger color", 2000);
    expect(style(quiet).borderTopColor, 'CONTROL: a field with no error shown leaves the box its own border').to.not.equal('rgb(1, 2, 3)');
    holder.remove();
  });
});
