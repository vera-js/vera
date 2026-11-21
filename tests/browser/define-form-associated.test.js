/**
 * **`define({ tag, formAssociated: true }, setup)` makes a form-associated element, in a real engine** (only an engine
 * says what a form does with it): the form lists it, submits the value its internals set, and calls its form callbacks
 * (given as `methods`) on reset and on a disabled fieldset. A component defined without the option is not
 * form-associated, the CONTROL that the option, not `define`, did it.
 */
import { expect } from '@esm-bundle/chai';
import { html, wire, define } from '../../packages/core/dist/development/vera.js';
import { renderer } from '../../packages/renderer/dist/development/vera-renderer.js';

wire([renderer]);

/** One `ElementInternals` per element: `attachInternals()` may be called once, and a setup runs on every connect. */
const internalsOf = new WeakMap();
const internals = (el) => {
  if (!internalsOf.has(el)) internalsOf.set(el, el.attachInternals());
  return internalsOf.get(el);
};
const calls = [];

const Field = define(
  {
    tag: 'x-form-field',
    formAssociated: true,
    methods: {
      formResetCallback() {
        calls.push('reset');
        internals(this).setFormValue('');
      },
      formDisabledCallback(disabled) {
        calls.push(`disabled:${disabled}`);
      },
    },
  },
  (host) => {
    internals(host).setFormValue('chosen');
    return () => html`<span>field</span>`;
  }
);
const Plain = define('x-form-plain', () => () => html`<span>plain</span>`);

describe('define({ formAssociated: true })', () => {
  it('sets the static on that class only (CONTROL: a define without it is not form-associated)', () => {
    expect(Field.formAssociated).to.equal(true);
    expect(Plain.formAssociated).to.equal(undefined);
  });

  it('a form lists it, submits its value, and calls its form callbacks on reset and on a disabled fieldset', async () => {
    const form = document.createElement('form');
    form.innerHTML = '<fieldset><x-form-field name="pick"></x-form-field><x-form-plain name="nope"></x-form-plain></fieldset>';
    document.body.append(form);
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const field = form.querySelector('x-form-field');
    expect([...form.elements].includes(field), 'the form lists it').to.equal(true);
    expect([...form.elements].some((el) => el.localName === 'x-form-plain'), 'CONTROL: the plain one is not listed').to.equal(false);
    expect(new FormData(form).get('pick')).to.equal('chosen');
    form.reset();
    expect(calls.includes('reset')).to.equal(true);
    expect(new FormData(form).get('pick')).to.equal('');
    form.querySelector('fieldset').disabled = true;
    expect(calls.includes('disabled:true')).to.equal(true);
    form.remove();
  });

  it('removed and re-added, the setup runs again and the element keeps its one internals', async () => {
    const form = document.createElement('form');
    const field = document.createElement('x-form-field');
    field.setAttribute('name', 'again');
    form.append(field);
    document.body.append(form);
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    field.remove();
    form.append(field);
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    expect(new FormData(form).get('again')).to.equal('chosen');
    form.remove();
  });
});
