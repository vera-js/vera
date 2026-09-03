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
import { spread } from '@verajs/renderer/spread';
import { keyed } from '@verajs/renderer/keyed';
import { useSelect, type SelectOption } from '@verajs/hooks';
import { SELECT_STYLES } from './styles.js';
import { parseLightOptions } from './parse-options.js';

type Internal = {
  select: ReturnType<typeof useSelect> | null;
  /** Values assigned after upgrade but before connect wait here for the controller. Value
   *  entries may be strings — resolvable only once options are known, so resolution waits. */
  pending: { options: SelectOption[]; value: (string | SelectOption)[] };
  internals: ElementInternals | undefined;
  /**
   * Observed attributes mirrored into a store as real values the template reads. The first cut
   * was a `tick` counter read as `void host.tick` — which the production minifier deleted as a
   * useless expression, so attribute changes re-rendered in development and silently never in
   * production. A value the output genuinely uses cannot be eliminated.
   */
  host: { attrs: Record<string, string | null>; formDisabled: boolean };
  /** The debounce timer for the `filter` event. */
  timer: ReturnType<typeof setTimeout> | undefined;
  /** True while the option list came from light-DOM markup — the mutation observer's gate. */
  htmlSourced: boolean;
  /** A slotted trigger opts out of the anchor tier: anchor names are tree-scoped, and whether a
   *  light-DOM anchor is visible to a shadow menu is the open cross-root question (SELECT-V2 §4). */
  slottedTrigger: boolean;
  /** The close-animation timer before hidePopover(). */
  hideTimer: ReturnType<typeof setTimeout> | undefined;
  /** What `selected` attributes declared — form reset restores THIS, not emptiness. */
  defaults: import('@verajs/hooks').SelectOption[];
};

/**
 * The anchor tier: top-layer popover + CSS anchor positioning, feature-detected on the specific
 * things used (never the family name). One tier condition, computed once — the fallback is the
 * existing menu, untouched.
 */
const ANCHOR_TIER =
  typeof CSS !== 'undefined' &&
  typeof CSS.supports === 'function' &&
  CSS.supports('top: anchor(bottom)') &&
  typeof HTMLElement !== 'undefined' &&
  'showPopover' in HTMLElement.prototype;

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
      host: createStore({ attrs: {} as Record<string, string | null>, formDisabled: false }),
      timer: undefined,
      htmlSourced: false,
      slottedTrigger: false,
      hideTimer: undefined,
      defaults: [],
    };
    INTERNAL.set(element, entry);
  }
  return entry;
};

/**
 * Resolve value entries to options: a string finds its option by value — first in the current
 * selection (keeping a cached label the options list no longer carries), then in the options —
 * and an unknown string becomes a placeholder whose label is itself. A full option passes
 * through, adopting its own label into the cache.
 */
const resolveSelection = (
  raw: (string | SelectOption)[],
  options: SelectOption[],
  current: SelectOption[]
): SelectOption[] => {
  /** First occurrence wins: selection identity is the value string, and a duplicate entry is
   *  ambiguity, not intent (measured: value = ['a','a','b'] doubled the selection). */
  const seen = new Set<string>();
  const resolved: SelectOption[] = [];
  for (const entry of raw) {
    const option =
      typeof entry !== 'string'
        ? entry
        : (current.find((candidate) => candidate.value === entry) ??
          options.find((candidate) => candidate.value === entry) ?? { label: entry, value: entry });
    if (seen.has(option.value)) continue;
    seen.add(option.value);
    resolved.push(option);
  }
  return resolved;
};

/** Duplicate values make selection ambiguous by construction — say so, loudly, in development. */
const warnDuplicates = (options: SelectOption[]) => {
  if (!__DEV__) return;
  const seen = new Set<string>();
  for (const option of options) {
    if (seen.has(option.value))
      console.warn(
        `[vera] ui: <vera-select> options contain duplicate value ${JSON.stringify(option.value)} — ` +
          `selection is by value, so these rows will mirror each other.`
      );
    seen.add(option.value);
  }
};

/**
 * Custom states — `:state(open)`, `:state(empty)`, `:state(loading)` — the host-level styling
 * hooks the platform grew for exactly this (ElementInternals.states), composing with Tailwind's
 * variant syntax and needing zero attributes. Guarded: engines without CustomStateSet simply
 * skip them; data-state on the parts remains the universal spelling.
 */
const syncStates = (element: VeraSelect) => {
  const entry = internal(element);
  const states = entry.internals?.states as Set<string> | undefined;
  if (!states) return;
  const put = (name: string, on: boolean) => (on ? states.add(name) : states.delete(name));
  put('open', entry.select?.state.open === true);
  put('empty', (entry.select?.state.value.length ?? 0) === 0);
  put('loading', element.hasAttribute('loading'));
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
    const name = element.getAttribute('name');
    if (name) {
      const data = new FormData();
      for (const option of value) data.append(name, option.value);
      internals.setFormValue(data, JSON.stringify(value.map((option) => option.value)));
    } else {
      /** An unnamed native control submits nothing; an empty-key FormData entry is not nothing. */
      internals.setFormValue(null, JSON.stringify(value.map((option) => option.value)));
    }
  } else {
    /** The second argument is explicit restore state — what formStateRestoreCallback receives. */
    internals.setFormValue(value[0]?.value ?? null, JSON.stringify(value.map((option) => option.value)));
  }
  if (internals.setValidity) {
    /** The anchor is what reportValidity() focuses and points the browser's bubble at. */
    const anchor =
      (((element as { _root?: ShadowRoot })._root ?? element.shadowRoot ?? element).querySelector?.(
        '[part="trigger"]'
      ) as HTMLElement | null) ?? undefined;
    if (element.hasAttribute('required') && value.length === 0)
      internals.setValidity(
        { valueMissing: true },
        element.getAttribute('required-message') ?? 'Please select an option.',
        anchor
      );
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
    'disabled',
    'searchable',
    'creatable',
    'remote',
    'loading',
    'required',
    'name',
    'required-message',
    'search-placeholder',
    'empty-message',
    'overflow-message',
    'results-message',
    'loading-message',
    'create-message',
    'remove-message',
    'aria-label',
  ];

  get options(): SelectOption[] {
    const { select, pending } = internal(this);
    return [...(select?.state.options ?? pending.options)];
  }
  set options(next: SelectOption[]) {
    const entry = internal(this);
    entry.htmlSourced = false; // property wins; the markup stops being the source
    const options = Array.isArray(next) ? [...next] : [];
    warnDuplicates(options);
    if (entry.select) entry.select.setOptions(options);
    else entry.pending.options = options;
  }

  /**
   * The value model (SELECT-V2 §2): mode-consistent STRINGS — a string in single mode ('' when
   * empty), a string[] in multi. `selectedOptions` carries the objects, exactly like native
   * <select>. Internally the controller keeps full options: that store IS the label cache, which
   * is how a remote-mode selection keeps its label after the option leaves the filtered list.
   */
  get value(): string | string[] {
    /** Through selectedOptions, so the pre-connect pending world resolves identically (a getter
     *  blind to pending answered '' for a value just assigned - measured). */
    const selected = this.selectedOptions;
    return this.hasAttribute('multi') ? selected.map((option) => option.value) : (selected[0]?.value ?? '');
  }
  set value(next: string | string[] | SelectOption[] | null | undefined) {
    const entry = internal(this);
    const raw: (string | SelectOption)[] =
      next == null || next === '' ? [] : Array.isArray(next) ? [...next] : [next];
    /** Single mode holds ONE: a multi-shaped array in single mode keeps its first entry, the
     *  same invariant every pick path already maintains. */
    const bounded = this.hasAttribute('multi') ? raw : raw.slice(0, 1);
    if (entry.select) {
      entry.select.state.value = resolveSelection(bounded, entry.select.state.options, entry.select.state.value);
      entry.select.sync();
      reflectForm(this, entry.select.state.value);
      syncStates(this);
    } else {
      entry.pending.value = bounded;
    }
  }

  /** The selection as full options — native <select>.selectedOptions, same name, same idea. */
  get selectedOptions(): SelectOption[] {
    const { select, pending } = internal(this);
    if (select) return [...select.state.value];
    return resolveSelection(pending.value, pending.options, []);
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null) {
    const entry = internal(this);
    entry.host.attrs = { ...entry.host.attrs, [name]: value };
    if (name === 'loading') syncStates(this);
    /** A control disabled while its menu is open must not strand the menu (measured: it did). */
    if (name === 'disabled' && value !== null) entry.select?.close(false);
    /**
     * The form reflection is a snapshot: a multi FormData bakes the name at set time, and
     * validity bakes required and its message — so renaming, or toggling required, must
     * re-reflect the current selection (measured: a renamed field submitted under the old name).
     */
    if ((name === 'name' || name === 'required' || name === 'required-message') && entry.select)
      reflectForm(this, entry.select.state.value);
  }

  formResetCallback() {
    /** Reset means DEFAULTS — what `selected` attributes declared — not emptiness (native parity). */
    this.value = [...internal(this).defaults];
  }

  /** Fieldset-inherited and form-level disabling arrives here, not as an attribute. */
  formDisabledCallback(isDisabled: boolean) {
    const entry = internal(this);
    entry.host.formDisabled = isDisabled;
    if (isDisabled) entry.select?.close(false);
  }

  /** Session restore / bfcache hands back the state reflectForm stored (a JSON value list). */
  formStateRestoreCallback(restored: unknown) {
    if (typeof restored !== 'string') return;
    let values: string[];
    try {
      values = JSON.parse(restored) as string[];
    } catch {
      return;
    }
    if (!Array.isArray(values)) return;
    /** Hostile or corrupt restore state: only strings are selection identities. */
    this.value = values.filter((entry): entry is string => typeof entry === 'string');
  }

  /** Native-control validity surface, proxied from internals — element.validity, like an input. */
  get validity(): ValidityState | undefined {
    return internal(this).internals?.validity;
  }
  get validationMessage(): string {
    return internal(this).internals?.validationMessage ?? '';
  }
  get willValidate(): boolean {
    return internal(this).internals?.willValidate ?? false;
  }
  checkValidity(): boolean {
    return internal(this).internals?.checkValidity?.() ?? true;
  }
  reportValidity(): boolean {
    return internal(this).internals?.reportValidity?.() ?? true;
  }

  /**
   * Focus delegates to the effective trigger — slotted if supplied, ours otherwise — in both DOM
   * modes. Native controls focus their UI; without this, element.focus() (including the UA's own
   * call when an associated <label> is clicked) was a no-op on an unfocusable host (measured).
   */
  override focus(options?: FocusOptions) {
    const root = (this as { _root?: ShadowRoot })._root ?? this.shadowRoot ?? this;
    const slotted = (root.querySelector?.('slot[name="trigger"]') as HTMLSlotElement | null)?.assignedElements()[0];
    const trigger = (slotted ?? root.querySelector?.('[part="trigger"]')) as HTMLElement | null;
    if (trigger) trigger.focus(options);
    else super.focus(options);
  }

  /** Programmatic control — the same paths every gesture uses, veto-able via beforetoggle. */
  open() {
    internal(this).select?.open();
  }
  close() {
    internal(this).select?.close(false);
  }

  connectedCallback() {
    for (const key of ['options', 'value']) upgradeProperty(this, key);
    const entry0 = internal(this);
    /**
     * HTML seeds, property wins: light-DOM <option>/<optgroup>/<vera-option> children become the
     * option list only when no property has provided one. `selected` seeds both the value and the
     * reset defaults. Must run before init() — in light mode the first render consumes the
     * children (one-shot authoring, fine for documents; shadow mode keeps them live).
     */
    if (!entry0.select && !entry0.pending.options.length) {
      const parsed = parseLightOptions(this);
      if (parsed) {
        entry0.pending.options = parsed.options;
        entry0.htmlSourced = true;
        entry0.defaults = parsed.selected;
        if (!entry0.pending.value.length) entry0.pending.value = [...parsed.selected];
        warnDuplicates(parsed.options);
        /**
         * Light mode renders into the element but does not clear it — the authored options would
         * remain as stray visible text beside the real UI. Consume them explicitly: light-mode
         * HTML authoring is one-shot by construction, so the subtree is ours from here.
         */
        if (this.hasAttribute('light')) this.replaceChildren();
      }
    }
    init(this, this.hasAttribute('light') ? undefined : { mode: 'open' });
    const root = (this as { _root?: ShadowRoot })._root ?? this.shadowRoot ?? this;
    const entry = internal(this);
    /**
     * Everything seed-shaped below runs only on the controller's FIRST creation. A reconnect
     * re-enters this callback with live state, and re-seeding from pending (long since consumed)
     * wiped options and value to empty, while re-reading the value attribute clobbered a live
     * selection - all three measured before this guard existed.
     */
    const created = !entry.select;

    const attrs = () => entry.host.attrs;
    /** The search line exists for explicit searchers; `creatable` and `remote` both need it. */
    const searchable = () => attrs()['searchable'] != null || attrs()['creatable'] != null || attrs()['remote'] != null;

    /** ToggleEvent where the platform has it (the popover/details vocabulary); a shaped CustomEvent elsewhere. */
    const toggleEvent = (type: string, oldState: string, newState: string, cancelable: boolean) =>
      typeof ToggleEvent !== 'undefined'
        ? new ToggleEvent(type, { oldState, newState, cancelable, bubbles: false })
        : new CustomEvent(type, { detail: { oldState, newState }, cancelable });

    const select = (entry.select ??= useSelect(this, {
      multi: () => this.hasAttribute('multi'),
      disabled: () => this.hasAttribute('disabled') || entry.host.formDisabled,
      creatable: () => this.hasAttribute('creatable'),
      remote: () => this.hasAttribute('remote'),
      canToggle: (next) =>
        this.dispatchEvent(toggleEvent('beforetoggle', next === 'open' ? 'closed' : 'open', next, true)),
      onToggle: (next) => {
        syncStates(this);
        /**
         * The anchor tier promotes the menu to the top layer. Open: show, then the transition
         * plays from @starting-style. Close: the data-state transition plays while still
         * popover-open; the popover hides after it settles (a fixed timer — transitionend never
         * fires under reduced motion). A reopen inside the window cancels the pending hide.
         */
        const menu = root.querySelector?.('[part="menu"]') as
          | (HTMLElement & { showPopover?: () => void; hidePopover?: () => void })
          | null;
        if (ANCHOR_TIER && !entry.slottedTrigger && menu?.hasAttribute('popover')) {
          clearTimeout(entry.hideTimer);
          try {
            if (next === 'open') menu.showPopover?.();
            else
              entry.hideTimer = setTimeout(() => {
                try {
                  menu.hidePopover?.();
                } catch {
                  /* detached or already hidden - the UA force-hid it */
                }
              }, 180);
          } catch {
            /* already in the requested state — nothing to do */
          }
        }
        this.dispatchEvent(toggleEvent('toggle', next === 'open' ? 'closed' : 'open', next, false));
      },
      onChange: (selectedOptions) => {
        reflectForm(this, selectedOptions);
        syncStates(this);
        /** input then change, the platform's order; input carries no detail, exactly like native. */
        this.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        this.dispatchEvent(
          new CustomEvent('change', {
            detail: { value: this.value, selectedOptions: [...selectedOptions] },
            bubbles: true,
            composed: true,
          })
        );
      },
      onCreate: (label) => {
        const detail = { label, option: { label, value: label } as SelectOption };
        /** Cancelable: a host may claim creation (async ids, dedup). Uncanceled, the option joins. */
        if (!this.dispatchEvent(new CustomEvent('create', { detail, bubbles: true, composed: true, cancelable: true })))
          return;
        select.setOptions([...select.state.options, detail.option]);
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
    if (created) {
      select.setOptions(entry.pending.options);
      entry.pending.options = [];
      /**
       * The value attribute is single-mode initial value, native-input style: it applies only
       * when nothing else (property, selected markup) claimed the selection, and it doubles as
       * the reset default when the markup declared none.
       */
      const valueAttribute = this.getAttribute('value');
      if (valueAttribute && !entry.pending.value.length && !entry.defaults.length) {
        entry.pending.value = [valueAttribute];
        entry.defaults = resolveSelection([valueAttribute], select.state.options, []);
      }
      select.state.value = resolveSelection(entry.pending.value, select.state.options, select.state.value);
      entry.pending.value = [];
      reflectForm(this, select.state.value);
    }
    syncStates(this);

    /**
     * Markup stays live in shadow mode — but the observer exists ONLY for markup-sourced selects:
     * a property-driven one (the common JS path) pays zero observer. htmlSourced also gates the
     * callback, so a later property assignment retires an existing observer's effect; it is
     * released for real through the _cleanups contract on disconnect.
     */
    if (entry.htmlSourced && typeof MutationObserver !== 'undefined' && !this.hasAttribute('light')) {
      const observer = new MutationObserver(() => {
        if (!entry.htmlSourced) return;
        const parsed = parseLightOptions(this);
        if (parsed) {
          select.setOptions(parsed.options);
          entry.defaults = parsed.selected;
        }
      });
      observer.observe(this, { childList: true, subtree: true, attributes: true });
      (this as { _cleanups?: Set<() => void> })._cleanups?.add(() => observer.disconnect());
    }
    (this as { _cleanups?: Set<() => void> })._cleanups?.add(() => {
      clearTimeout(entry.hideTimer);
      clearTimeout(entry.timer); // the filter debounce must not fire on a detached element
    });
    const { state, handlers } = select;

    /** Slotted nodes to the controller — plus our own trigger, so close-with-refocus can land. */
    const refresh = () => {
      const assignedTo = (name: string) =>
        (root.querySelector?.(`slot[name="${name}"]`) as HTMLSlotElement | null)?.assignedElements()[0];
      const slottedTrigger = assignedTo('trigger');
      entry.slottedTrigger = slottedTrigger !== undefined;
      select.attach({
        trigger: slottedTrigger,
        value: assignedTo('value'),
        search: assignedTo('search'),
        fallbackTrigger: root.querySelector?.('[part="trigger"]') ?? undefined,
      });
    };

    /** The search line takes focus when the menu opens. Registered before render(), like every hook. */
    useEffect(() => {
      if (!state.open) return;
      const search =
        ((root.querySelector?.('slot[name="search"]') as HTMLSlotElement | null)?.assignedElements()[0] as
          | HTMLElement
          | undefined) ?? (searchable() ? (root.querySelector?.('[part="search"]') as HTMLInputElement | null) : null);
      search?.focus?.();
    }, this);

    /** Keyboard travel keeps the active row visible. Guarded: jsdom has no scrollIntoView. */
    useEffect(() => {
      if (state.open && state.active >= 0)
        root.querySelector?.('[part="option"][data-active]')?.scrollIntoView?.({ block: 'nearest' });
    }, this);

    /** One option row. Icons are aria-hidden by contract — the label always says the whole thing. */
    const row = (option: SelectOption, index: number, active: number) => keyed(option.value, html`
      <div
        id=${`opt-${index}`}
        part="option"
        role="option"
        data-index=${index}
        ?data-active=${index === active}
        aria-selected=${String(select.chosen(option))}
        aria-disabled=${String(option.disabled === true)}
      >
        ${option.iconBefore != null ? html`<span part="option-icon" aria-hidden="true">${option.iconBefore}</span>` : null}
        <span part="option-label">
          ${option.label}${option.description ? html`<span part="option-description">${option.description}</span>` : null}
        </span>
        ${option.iconAfter != null ? html`<span part="option-icon" aria-hidden="true">${option.iconAfter}</span>` : null}
      </div>
    `);

    render(() => {
      const rows = select.matches();
      const creating = select.createLabel();
      const count = rows.length + (creating ? 1 : 0);
      const active = Math.min(state.active, Math.max(count - 1, 0));
      const activeId = count === 0 ? null : active === rows.length ? 'opt-create' : `opt-${active}`;
      const labels = state.value.map((option) => option.label).join(', ');
      const loading = attrs()['loading'] != null;
      const overflow = attrs()['overflow-message'] ?? null;
      /**
       * Consecutive options sharing a `group` render inside one labelled role="group" — a real
       * group (never a heading faked as an option), invisible to the keyboard model because rows
       * keep their flat data-index and ids. The visible heading is aria-hidden; the group's
       * aria-label is what announces.
       */
      const segments: { group: string | null; rows: { option: SelectOption; index: number }[] }[] = [];
      rows.forEach((option, index) => {
        const group = option.group ?? null;
        const last = segments[segments.length - 1];
        if (last && last.group === group) last.rows.push({ option, index });
        else segments.push({ group, rows: [{ option, index }] });
      });
      const loadingMessage = attrs()['loading-message'] ?? 'Loading…';
      const status = !state.open
        ? ''
        : loading
          ? loadingMessage
          : searchable()
            ? (attrs()['results-message'] ?? '{count} options').replace('{count}', String(count))
            : '';
      return html`
        <slot name="trigger" @slotchange=${refresh}>
          <div
            part="trigger"
            role="combobox"
            aria-haspopup="listbox"
            aria-controls="listbox"
            tabindex=${attrs()['disabled'] != null || entry.host.formDisabled ? '-1' : '0'}
            aria-label=${labelOf(this)}
            aria-required=${attrs()['required'] != null ? 'true' : null}
            aria-activedescendant=${state.open ? activeId : null}
            ${spread(select.triggerStamps())}
            @click=${handlers.onTriggerClick}
            @keydown=${handlers.onTriggerKeydown}
          >
            <slot name="value" @slotchange=${refresh}>
              <span part="value" data-placeholder=${attrs()['placeholder'] ?? 'Select…'}>
                ${attrs()['multi'] != null
                  ? state.value.map(
                      (option) => html`
                        <span part="pill">
                          ${option.label}
                          <button
                            part="pill-remove"
                            type="button"
                            aria-label=${(attrs()['remove-message'] ?? 'Remove {label}').replace('{label}', option.label)}
                            @click=${(event: Event) => {
                              event.stopPropagation();
                              select.pick(option);
                            }}
                          >
                            ✕
                          </button>
                        </span>
                      `
                    )
                  : labels}
              </span>
            </slot>
          </div>
        </slot>
        <div
          part="menu"
          popover=${ANCHOR_TIER && !entry.slottedTrigger ? 'manual' : null}
          data-state=${state.open ? 'open' : 'closed'}
          @keydown=${handlers.onMenuKeydown}
          @input=${handlers.onSearchInput}
        >
          <slot name="search" @slotchange=${refresh}>
            <input
              part="search"
              type="text"
              ?hidden=${!searchable()}
              placeholder=${attrs()['search-placeholder'] ?? 'Search…'}
              aria-label=${attrs()['search-placeholder'] ?? 'Search…'}
              autocomplete="off"
              ${spread(select.searchStamps(state.open ? activeId : null))}
              .value=${state.search}
            />
          </slot>
          <div
            id="listbox"
            part="list"
            role="listbox"
            aria-busy=${String(loading)}
            aria-label=${labelOf(this)}
            aria-multiselectable=${String(attrs()['multi'] != null)}
            @click=${handlers.onListClick}
            @pointerover=${handlers.onListHover}
          >
            ${segments.map((segment) =>
              segment.group === null
                ? segment.rows.map((entry) => row(entry.option, entry.index, active))
                : html`
                    <div part="group" role="group" aria-label=${segment.group}>
                      <span part="group-label" aria-hidden="true">${segment.group}</span>
                      ${segment.rows.map((entry) => row(entry.option, entry.index, active))}
                    </div>
                  `
            )}
            ${creating
              ? html`
                  <div
                    id="opt-create"
                    part="option"
                    role="option"
                    data-index=${rows.length}
                    data-create
                    ?data-active=${active === rows.length}
                    aria-selected="false"
                  >
                    ${(attrs()['create-message'] ?? 'Create “{label}”').replace('{label}', creating)}
                  </div>
                `
              : null}
          </div>
          <span part="status" role="status">${status}</span>
          <slot name="empty">
            <p part="empty" data-state=${count > 0 ? 'hidden' : 'visible'}>
              ${loading ? loadingMessage : (attrs()['empty-message'] ?? 'No options')}
            </p>
          </slot>
          <p part="overflow" data-state=${overflow ? 'visible' : 'hidden'}>${overflow ?? ''}</p>
        </div>
      `;
    });
  }
}
