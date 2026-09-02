/**
 * `<vera-select>` — the styled select over `@verajs/hooks`' `useSelect`.
 *
 * The division of labor: this file owns markup, styles, slots, form association and events; the
 * controller owns state, the keyboard model, ARIA and dismissal. The template renders and binds
 * **our** nodes reactively; nodes the user slots in are handed to `controller.attach`, which wires
 * them imperatively — both kinds run the same handlers, so default and supplied markup cannot
 * drift.
 *
 * Modes: shadow root by default; the `light` attribute (read at connect — a root cannot be
 * un-attached) renders the same template into the element, where the same stylesheet is hoisted
 * per tag by `@verajs/styles`. Slots in light DOM are inert wrappers that display their fallback,
 * so the template is identical in both.
 *
 * Per-instance state lives in a module WeakMap rather than class fields: the shared lint rule
 * bans instance fields on custom elements (a field initializer runs at upgrade and clobbers any
 * property assigned before it), and `declare` cannot carry the values these need.
 */
import { createStore, html, init, render, useEffect } from '@verajs/core';
import { useSelect, type SelectOption } from '@verajs/hooks';
import { SELECT_STYLES } from './styles.js';

type Internal = {
  select: ReturnType<typeof useSelect> | null;
  /** Values assigned after upgrade but before connect wait here for the controller. */
  pending: { options: SelectOption[]; value: SelectOption[] };
  internals: ElementInternals | undefined;
  /** Attribute reads in the template subscribe through this; attributeChangedCallback bumps it. */
  host: { tick: number };
};

const INTERNAL = new WeakMap<VeraSelect, Internal>();

/** Lazily created: a property setter may run after upgrade but before connectedCallback. */
const internal = (element: VeraSelect): Internal => {
  let entry = INTERNAL.get(element);
  if (!entry) {
    let internals: ElementInternals | undefined;
    try {
      internals = element.attachInternals?.();
    } catch {
      /* no form association on this engine — the component still works, forms just cannot see it */
    }
    entry = { select: null, pending: { options: [], value: [] }, internals, host: createStore({ tick: 0 }) };
    INTERNAL.set(element, entry);
  }
  return entry;
};

/** Pre-upgrade property assignments land as own properties that shadow the accessors — re-route. */
const upgradeProperty = (element: HTMLElement, key: string) => {
  if (Object.hasOwn(element, key)) {
    const assigned = (element as unknown as Record<string, unknown>)[key];
    delete (element as unknown as Record<string, unknown>)[key];
    (element as unknown as Record<string, unknown>)[key] = assigned;
  }
};

/** Form participation, where the platform provides it. Multi submits repeated entries. */
const reflectForm = (element: VeraSelect, value: SelectOption[]) => {
  const { internals } = internal(element);
  if (!internals?.setFormValue) return;
  if (element.hasAttribute('multi')) {
    const data = new FormData();
    const name = element.getAttribute('name') ?? '';
    for (const option of value) data.append(name, option.value);
    internals.setFormValue(data);
  } else {
    internals.setFormValue(value[0]?.value ?? null);
  }
};

export class VeraSelect extends HTMLElement {
  static styles = SELECT_STYLES;
  static formAssociated = true;
  static observedAttributes = ['multi', 'placeholder'];

  get options(): SelectOption[] {
    const { select, pending } = internal(this);
    return [...(select?.state.options ?? pending.options)];
  }
  set options(next: SelectOption[]) {
    const entry = internal(this);
    const options = Array.isArray(next) ? [...next] : [];
    if (entry.select) entry.select.state.options = options;
    else entry.pending.options = options;
  }

  get value(): SelectOption[] {
    const { select, pending } = internal(this);
    return [...(select?.state.value ?? pending.value)];
  }
  set value(next: SelectOption[]) {
    const entry = internal(this);
    const value = Array.isArray(next) ? [...next] : [];
    if (entry.select) {
      entry.select.state.value = value;
      entry.select.sync();
    } else {
      entry.pending.value = value;
    }
    reflectForm(this, value);
  }

  attributeChangedCallback() {
    internal(this).host.tick++;
  }

  formResetCallback() {
    this.value = [];
  }

  connectedCallback() {
    for (const key of ['options', 'value']) upgradeProperty(this, key);
    init(this, this.hasAttribute('light') ? undefined : { mode: 'open' });
    const root = (this as { _root?: ShadowRoot })._root ?? this.shadowRoot ?? this;
    const entry = internal(this);

    const select = (entry.select ??= useSelect(this, {
      multi: () => this.hasAttribute('multi'),
      onChange: (value) => {
        reflectForm(this, value);
        this.dispatchEvent(new CustomEvent('change', { detail: { value }, bubbles: true, composed: true }));
      },
    }));
    select.state.options = entry.pending.options;
    select.state.value = entry.pending.value;
    const { state, handlers } = select;

    /** Slotted nodes go to the controller; re-read whenever an assignment changes. */
    const refresh = () => {
      const assignedTo = (name: string) =>
        (root.querySelector?.(`slot[name="${name}"]`) as HTMLSlotElement | null)?.assignedElements()[0];
      select.attach({ trigger: assignedTo('trigger'), value: assignedTo('value') });
    };

    /** The search line takes focus when the menu opens. Registered before render(), like every hook. */
    useEffect(() => {
      if (state.open) (root.querySelector?.('[part="search"]') as HTMLInputElement | null)?.focus();
    }, this);

    render(() => {
      void entry.host.tick; // subscribe to observed-attribute changes
      const rows = select.matches();
      const active = Math.min(state.active, Math.max(rows.length - 1, 0));
      const labels = state.value.map((option) => option.label).join(', ');
      return html`
        <slot name="trigger" @slotchange=${refresh}>
          <button
            part="trigger"
            type="button"
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded=${String(state.open)}
            data-state=${state.open ? 'open' : 'closed'}
            @click=${handlers.onTriggerClick}
            @keydown=${handlers.onTriggerKeydown}
          >
            <slot name="value" @slotchange=${refresh}>
              <span part="value" data-placeholder=${this.getAttribute('placeholder') ?? 'Select…'}>${labels}</span>
            </slot>
          </button>
        </slot>
        <div part="menu" data-state=${state.open ? 'open' : 'closed'} @keydown=${handlers.onMenuKeydown}>
          <input
            part="search"
            type="text"
            aria-label="Filter options"
            .value=${state.search}
            @input=${handlers.onSearchInput}
          />
          <ul
            part="list"
            role="listbox"
            aria-multiselectable=${String(this.hasAttribute('multi'))}
            @click=${handlers.onListClick}
            @pointerover=${handlers.onListHover}
          >
            ${rows.map(
              (option, index) => html`
                <li
                  part="option"
                  role="option"
                  data-index=${index}
                  ?data-active=${index === active}
                  aria-selected=${String(select.chosen(option))}
                  aria-disabled=${String(option.disabled === true)}
                >
                  ${option.label}
                </li>
              `
            )}
          </ul>
          <p part="empty" data-state=${rows.length ? 'hidden' : 'visible'}>No options</p>
        </div>
      `;
    });
  }
}
