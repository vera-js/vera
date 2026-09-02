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
 * The accessible name is resolved from the host's `aria-label`, else from an associated
 * `<label for>` through `ElementInternals.labels` — reflected onto the trigger, because the
 * boundary means a label outside cannot reference a node inside. wp-omni's select accepted an
 * aria-label and dropped it for a year; the test for this is the regression test that lesson
 * demands.
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
  /**
   * Observed attributes mirrored into a store as real values the template reads. The first cut
   * was a `tick` counter read as `void host.tick` — which the production minifier deleted as a
   * useless expression, so attribute changes re-rendered in development and silently never in
   * production. A value the output genuinely uses cannot be eliminated.
   */
  host: { attrs: Record<string, string | null> };
  /** The debounce timer for the `filter` event. */
  timer: ReturnType<typeof setTimeout> | undefined;
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
    entry = {
      select: null,
      pending: { options: [], value: [] },
      internals,
      host: createStore({ attrs: {} as Record<string, string | null> }),
      timer: undefined,
    };
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
  if (internals.setValidity) {
    if (element.hasAttribute('required') && value.length === 0)
      internals.setValidity({ valueMissing: true }, 'Please select an option.');
    else internals.setValidity({});
  }
};

/**
 * The accessible name: the host's own `aria-label` wins; else the text of an associated
 * `<label for>` (reachable only through internals — the boundary blocks aria-labelledby).
 */
const labelOf = (element: VeraSelect): string | null => {
  const own = internal(element).host.attrs['aria-label'];
  if (own) return own;
  const label = internal(element).internals?.labels?.[0];
  return label?.textContent?.trim() || null;
};

export class VeraSelect extends HTMLElement {
  static styles = SELECT_STYLES;
  static formAssociated = true;
  static observedAttributes = [
    'multi',
    'placeholder',
    'searchable',
    'creatable',
    'remote',
    'loading',
    'required',
    'search-placeholder',
    'empty-message',
    'overflow-message',
    'aria-label',
  ];

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

  attributeChangedCallback(name: string, _old: string | null, value: string | null) {
    const { host } = internal(this);
    host.attrs = { ...host.attrs, [name]: value };
  }

  formResetCallback() {
    this.value = [];
  }

  connectedCallback() {
    for (const key of ['options', 'value']) upgradeProperty(this, key);
    init(this, this.hasAttribute('light') ? undefined : { mode: 'open' });
    const root = (this as { _root?: ShadowRoot })._root ?? this.shadowRoot ?? this;
    const entry = internal(this);

    const attrs = () => entry.host.attrs;
    /** The search line exists for explicit searchers; `creatable` and `remote` both need it. */
    const searchable = () => attrs()['searchable'] != null || attrs()['creatable'] != null || attrs()['remote'] != null;

    const select = (entry.select ??= useSelect(this, {
      multi: () => this.hasAttribute('multi'),
      creatable: () => this.hasAttribute('creatable'),
      remote: () => this.hasAttribute('remote'),
      onChange: (value) => {
        reflectForm(this, value);
        this.dispatchEvent(new CustomEvent('change', { detail: { value }, bubbles: true, composed: true }));
      },
      onCreate: (label) => {
        const detail = { label, option: { label, value: label } as SelectOption };
        /** Cancelable: a host may claim creation (async ids, dedup). Uncanceled, the option joins. */
        if (!this.dispatchEvent(new CustomEvent('create', { detail, bubbles: true, composed: true, cancelable: true })))
          return;
        select.state.options = [...select.state.options, detail.option];
        select.state.search = '';
        select.pick(detail.option);
      },
      onSearch: (query) => {
        /** The remote seam: a debounced `filter` event — the host fetches and sets `.options`. */
        clearTimeout(entry.timer);
        const wait = Number(this.getAttribute('debounce') ?? (this.hasAttribute('remote') ? 250 : 0));
        entry.timer = setTimeout(() => {
          this.dispatchEvent(new CustomEvent('filter', { detail: { query }, bubbles: true, composed: true }));
        }, wait);
      },
    }));
    select.state.options = entry.pending.options;
    select.state.value = entry.pending.value;
    reflectForm(this, select.state.value);
    const { state, handlers } = select;

    /** Slotted nodes to the controller — plus our own trigger, so close-with-refocus can land. */
    const refresh = () => {
      const assignedTo = (name: string) =>
        (root.querySelector?.(`slot[name="${name}"]`) as HTMLSlotElement | null)?.assignedElements()[0];
      select.attach({
        trigger: assignedTo('trigger'),
        value: assignedTo('value'),
        fallbackTrigger: root.querySelector?.('[part="trigger"]') ?? undefined,
      });
    };

    /** The search line takes focus when the menu opens. Registered before render(), like every hook. */
    useEffect(() => {
      if (state.open && searchable()) (root.querySelector?.('[part="search"]') as HTMLInputElement | null)?.focus();
    }, this);

    render(() => {
      const rows = select.matches();
      const creating = select.createLabel();
      const count = rows.length + (creating ? 1 : 0);
      const active = Math.min(state.active, Math.max(count - 1, 0));
      const activeId = count === 0 ? null : active === rows.length ? 'opt-create' : `opt-${active}`;
      const labels = state.value.map((option) => option.label).join(', ');
      const loading = attrs()['loading'] != null;
      const overflow = attrs()['overflow-message'] ?? null;
      return html`
        <slot name="trigger" @slotchange=${refresh}>
          <button
            part="trigger"
            type="button"
            role="combobox"
            aria-haspopup="listbox"
            aria-controls="listbox"
            aria-label=${labelOf(this)}
            aria-expanded=${String(state.open)}
            aria-activedescendant=${state.open ? activeId : null}
            data-state=${state.open ? 'open' : 'closed'}
            @click=${handlers.onTriggerClick}
            @keydown=${handlers.onTriggerKeydown}
          >
            <slot name="value" @slotchange=${refresh}>
              <span part="value" data-placeholder=${attrs()['placeholder'] ?? 'Select…'}>${labels}</span>
            </slot>
          </button>
        </slot>
        <div part="menu" data-state=${state.open ? 'open' : 'closed'} @keydown=${handlers.onMenuKeydown}>
          <input
            part="search"
            type="text"
            ?hidden=${!searchable()}
            placeholder=${attrs()['search-placeholder'] ?? 'Search…'}
            aria-label=${attrs()['search-placeholder'] ?? 'Search…'}
            aria-controls="listbox"
            aria-activedescendant=${state.open ? activeId : null}
            autocomplete="off"
            .value=${state.search}
            @input=${handlers.onSearchInput}
          />
          <ul
            id="listbox"
            part="list"
            role="listbox"
            aria-multiselectable=${String(attrs()['multi'] != null)}
            @click=${handlers.onListClick}
            @pointerover=${handlers.onListHover}
          >
            ${rows.map(
              (option, index) => html`
                <li
                  id=${`opt-${index}`}
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
            ${creating
              ? html`
                  <li
                    id="opt-create"
                    part="option"
                    role="option"
                    data-index=${rows.length}
                    data-create
                    ?data-active=${active === rows.length}
                    aria-selected="false"
                  >
                    Create “${creating}”
                  </li>
                `
              : null}
          </ul>
          <p part="empty" data-state=${count > 0 ? 'hidden' : 'visible'}>
            ${loading ? 'Loading…' : (attrs()['empty-message'] ?? 'No options')}
          </p>
          <p part="overflow" data-state=${overflow ? 'visible' : 'hidden'}>${overflow ?? ''}</p>
        </div>
      `;
    });
  }
}
