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
import { slotted } from '@verajs/renderer/slots';
import { SELECT_STYLES } from './styles.js';
import { parseLightOptions } from './parse-options.js';

/**
 * A shadow root is its own ID scope; a LIGHT host's ids land in the page document beside everyone
 * else's. Two `<vera-select light>` on one page therefore both wrote `id="listbox"` and `id="opt-0"`,
 * and the second one's `aria-controls`/`aria-activedescendant` resolved to the FIRST one's listbox
 * and options — every light-mode select after the first pointed a screen reader at another widget.
 *
 * So every id this component writes is scoped to the instance that wrote it. One code path: in a
 * shadow root the prefix is redundant and harmless, and having both modes emit the same shape is
 * worth more than the handful of bytes.
 *
 * A counter, not a random value, because these ids have to survive a server render: the markup
 * carries them and the client has to arrive at the same ones. A counter matches whenever the
 * components are instantiated in the same order, which is what hydrating a server-rendered page
 * does. `<vera-select>` is not server-rendered today, so this is design rather than a fix — but it
 * is the reason not to reach for `randomUUID`.
 */
let uidSeq = 0;

type Internal = {
  select: ReturnType<typeof useSelect> | null;
  /** This instance's id prefix — see the note above `uidSeq`. */
  uid: string;
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
      uid: `vs${++uidSeq}`,
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
    /** Single holds ONE through every door: the setter bounds assignments, and this bounds the
     *  mode change itself — multi toggled off with a plural selection kept it (found by fuzz). */
    if (name === 'multi' && value === null && entry.select && entry.select.state.value.length > 1) {
      entry.select.state.value = entry.select.state.value.slice(0, 1);
      entry.select.sync();
      reflectForm(this, entry.select.state.value);
      syncStates(this);
    }
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
   * The native form-control IDL reflections. Every one of these exists on a real <select>, and
   * their absence is a SILENT failure: `element.disabled = true` lands as an inert expando and
   * nothing anywhere reports it. Form libraries and a11y tooling read `.labels`/`.form`/`.name`;
   * ports from native set the booleans. Attributes stay the source of truth - the setters
   * reflect, exactly as the platform's own controls do.
   */
  get name(): string {
    return this.getAttribute('name') ?? '';
  }
  set name(next: string) {
    this.setAttribute('name', next);
  }
  get disabled(): boolean {
    return this.hasAttribute('disabled');
  }
  set disabled(next: boolean) {
    this.toggleAttribute('disabled', next === true);
  }
  get required(): boolean {
    return this.hasAttribute('required');
  }
  set required(next: boolean) {
    this.toggleAttribute('required', next === true);
  }
  get multi(): boolean {
    return this.hasAttribute('multi');
  }
  set multi(next: boolean) {
    this.toggleAttribute('multi', next === true);
  }
  get labels(): NodeList | undefined {
    return internal(this).internals?.labels;
  }
  get form(): HTMLFormElement | null {
    return internal(this).internals?.form ?? null;
  }
  /** 'select-one' / 'select-multiple' - the native <select> vocabulary, so feature detection
   *  written against real selects keeps working. */
  get type(): string {
    return this.hasAttribute('multi') ? 'select-multiple' : 'select-one';
  }

  /**
   * Focus delegates to the effective trigger — slotted if supplied, ours otherwise — in both DOM
   * modes. Native controls focus their UI; without this, element.focus() (including the UA's own
   * call when an associated <label> is clicked) was a no-op on an unfocusable host (measured).
   */
  override focus(options?: FocusOptions) {
    const root = (this as { _root?: ShadowRoot })._root ?? this.shadowRoot ?? this;
    const slottedTrigger = slotted(this, 'trigger').find((node) => node.nodeType === 1) as HTMLElement | undefined;
    const trigger = (slottedTrigger ?? root.querySelector?.('[part="trigger"]')) as HTMLElement | null;
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
    for (const key of ['options', 'value', 'name', 'disabled', 'required', 'multi']) upgradeProperty(this, key);
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
         * HTML authoring is one-shot by construction, so those nodes are ours from here.
         *
         * **Only the ones this parse claimed.** Clearing the host wholesale took everything else
         * the user put there with it — a slotted trigger most of all — so authored options plus a
         * slotted trigger worked in shadow mode and silently lost the trigger in light. Measured on
         * identical markup in both modes, which is the comparison that makes it obvious.
         */
        if (this.hasAttribute('light')) for (const node of parsed.consumed) node.remove();
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
      ids: () => `${entry.uid}-`,
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
      /**
       * **Only the attributes a parse actually reads.** `attributes: true` watched the whole host
       * subtree — which includes the ARIA this component stamps onto a SLOTTED trigger. Stamping
       * woke the observer, the observer re-parsed and re-seeded, re-seeding re-rendered, the render
       * stamped again: an infinite synchronous loop inside one frame, so the page never painted
       * again.
       *
       * It needed all three of authored options, a `selected` among them, and a slotted trigger —
       * each supported, each harmless alone, and the default shadow mode. Without `selected` the
       * re-parse settled on an equal value and stopped; with it, every pass wrote fresh defaults.
       *
       * These are exactly the attributes `parse-options.ts` reads. A filter is the fix rather than
       * an equality check on the result, because the loop should not start: nothing the component
       * writes to its own assigned nodes is a reason to re-read the author's options.
       */
      observer.observe(this, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['selected', 'value', 'label', 'disabled', 'data-group', 'data-description', 'slot'],
      });
      (this as { _cleanups?: Set<() => void> })._cleanups?.add(() => observer.disconnect());
    }
    (this as { _cleanups?: Set<() => void> })._cleanups?.add(() => {
      clearTimeout(entry.hideTimer);
      clearTimeout(entry.timer); // the filter debounce must not fire on a detached element
    });
    const { state, handlers } = select;

    /** Slotted nodes to the controller — plus our own trigger, so close-with-refocus can land.
     *  `slotted()` answers in BOTH modes: shadow via native assignment, light via the wired slots
     *  module's capture map — so this one code path serves every corner. */
    const refresh = () => {
      const assignedTo = (name: string) => slotted(this, name).find((node) => node.nodeType === 1) as Element | undefined;
      const slottedTrigger = assignedTo('trigger');
      entry.slottedTrigger = slottedTrigger !== undefined;
      /**
       * A `[slot="value"]` may sit INSIDE a slotted trigger rather than as a direct host child —
       * the natural authoring shape (`<button slot="trigger"><span slot="value">`). Slot
       * assignment only reaches direct children, so the shadow `<slot name="value">` never gets
       * it; find it in the slotted trigger's subtree so its data-label is still stamped (the demo
       * card renders its label from exactly this, and it silently never updated — measured).
       */
      const slottedValue =
        assignedTo('value') ?? (slottedTrigger?.querySelector?.('[slot="value"]') as Element | undefined) ?? undefined;
      select.attach({
        trigger: slottedTrigger,
        value: slottedValue,
        search: assignedTo('search'),
        fallbackTrigger: root.querySelector?.('[part="trigger"]') ?? undefined,
      });
    };

    /**
     * The search line takes focus when the menu opens. Registered before render(), like every
     * hook — which is exactly why the focus itself is DEFERRED a frame: this effect runs in the
     * flush that opens the menu, before the template commits data-state="open", so the input is
     * still under the closed state's visibility:hidden and a real engine REFUSES the focus.
     * jsdom focuses anything, so only a browser shows it; found by typing into the creatable
     * demo card and watching every keystroke land on the trigger's typeahead instead.
     */
    /**
     * One guaranteed wiring pass after the first render, in BOTH modes.
     *
     * The `@slotchange` bindings below now cover every mode — light-DOM slots dispatch it on the
     * slot element exactly as the platform does — but `slotchange` only ever fires for a slot that
     * HAS an assignment, in a shadow root as much as here. A component given nothing to slot would
     * otherwise never wire at all, so this runs once regardless. Idempotent: `refresh` is
     * re-entrant by design and re-attach is guarded.
     */
    useEffect(() => refresh(), this);

    useEffect(() => {
      if (!state.open) return;
      requestAnimationFrame(() => {
        if (!state.open || !this.isConnected) return;
        const search =
          (slotted(this, 'search').find((node) => node.nodeType === 1) as HTMLElement | undefined) ??
          (searchable() ? (root.querySelector?.('[part="search"]') as HTMLInputElement | null) : null);
        search?.focus?.();
      });
    }, this);

    /** Keyboard travel keeps the active row visible. Guarded: jsdom has no scrollIntoView. */
    useEffect(() => {
      if (state.open && state.active >= 0)
        root.querySelector?.('[part="option"][data-active]')?.scrollIntoView?.({ block: 'nearest' });
    }, this);

    /** One option row. Icons are aria-hidden by contract — the label always says the whole thing. */
    const row = (option: SelectOption, index: number, active: number) => keyed(option.value, html`
      <div
        id=${`${entry.uid}-opt-${index}`}
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
      const activeId =
        count === 0 || active < 0
          ? null
          : `${entry.uid}-opt-${active === rows.length ? 'create' : active}`;
      const labels = state.value.map((option) => option.label).join(', ');
      /**
       * The value span must stay WHITESPACE-TIGHT in the template: static text nodes inside it —
       * even pure indentation — defeat :empty, and :empty is what the placeholder's ::before
       * hangs on. A multi-line span here erased every placeholder on the page (found by Brian's
       * screenshot; engines do not ship Selectors 4's whitespace-tolerant :empty).
       */
      const valueContent =
        attrs()['multi'] != null
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
          : labels;
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
            aria-controls=${`${entry.uid}-listbox`}
            tabindex=${attrs()['disabled'] != null || entry.host.formDisabled ? '-1' : '0'}
            aria-label=${labelOf(this)}
            aria-required=${attrs()['required'] != null ? 'true' : null}
            aria-activedescendant=${state.open ? activeId : null}
            ${spread(select.triggerStamps())}
            @click=${handlers.onTriggerClick}
            @keydown=${handlers.onTriggerKeydown}
          >
            <slot name="value" @slotchange=${refresh}
              ><span part="value" data-placeholder=${attrs()['placeholder'] ?? 'Select…'}>${valueContent}</span></slot
            >
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
            id=${`${entry.uid}-listbox`}
            part="list"
            role="listbox"
            tabindex="-1"
            aria-busy=${String(loading)}
            aria-label=${labelOf(this)}
            aria-multiselectable=${String(attrs()['multi'] != null)}
            @click=${handlers.onListClick}
            @pointermove=${handlers.onListHover}
            @pointerleave=${handlers.onListLeave}
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
                    id=${`${entry.uid}-opt-create`}
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
