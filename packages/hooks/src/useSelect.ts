/**
 * The select behavior — state, keyboard model, ARIA, selection and dismissal, with no markup and
 * no styles. `@verajs/ui`'s `<vera-select>` is one consumer; anyone building their own select UI
 * on this gets the same keyboard contract without re-deriving it subtly wrong.
 *
 * The division of labor is one rule: **the host's template renders and binds the host's own
 * nodes; the controller imperatively syncs nodes the user supplied** (via `attach`, re-called on
 * `slotchange`). Both kinds of trigger run the same handlers — the template binds them, `attach`
 * addEventListener's them — so slotted and default markup cannot drift.
 *
 * Everything here is a `createStore` store, so a host template that reads `select.state` re-renders
 * on exactly the changes it read — no subscription plumbing.
 */
import { createStore, useEffect } from '@verajs/core';
import { useDismiss } from './useDismiss.js';
import type { AssignedParts, LifecycleElement, SelectConfig, SelectOption } from './types.js';

export type SelectController = ReturnType<typeof useSelect>;

export const useSelect = (element: LifecycleElement, config: SelectConfig = {}) => {
  const state = createStore({
    open: false,
    /** Index into `matches`, not into `options` — the keyboard walks what is visible. */
    active: 0,
    search: '',
    options: [] as SelectOption[],
    value: [] as SelectOption[],
  });

  let assigned: AssignedParts = {};
  const multi = () => config.multi?.() === true;
  const disabled = () => config.disabled?.() === true;

  /** matches() is consulted several times per keystroke (rows, count, step, activate, render) —
   *  memoized per (options identity, search, remote) so the filter runs once per real change. */
  let memo: { options: SelectOption[]; search: string; remote: boolean; result: SelectOption[] } | null = null;
  const matches = (): SelectOption[] => {
    const remote = config.remote?.() === true;
    if (memo && memo.options === state.options && memo.search === state.search && memo.remote === remote)
      return memo.result;
    const needle = state.search.trim().toLowerCase();
    const result = remote
      ? [...state.options]
      : needle
        ? state.options.filter((option) => option.label.toLowerCase().includes(needle))
        : [...state.options];
    memo = { options: state.options, search: state.search, remote, result };
    return result;
  };

  /**
   * The one write path for options — active is tracked BY IDENTITY across the change: the
   * highlighted option keeps the highlight if it survives (a remote refresh reordering results
   * must not silently move it), and vanishes to the top if it does not.
   */
  const setOptions = (next: SelectOption[]) => {
    const previous = matches()[state.active];
    state.options = next;
    memo = null;
    if (previous) {
      const index = matches().findIndex((option) => option.value === previous.value);
      state.active = index === -1 ? 0 : index;
    } else {
      state.active = 0;
    }
  };

  /** The create row's label — non-empty only when creatable, searched, and not an existing label. */
  const createLabel = (): string => {
    if (config.creatable?.() !== true) return '';
    const label = state.search.trim();
    if (!label) return '';
    return state.options.some((option) => option.label.toLowerCase() === label.toLowerCase()) ? '' : label;
  };

  /** The keyboard walks matches plus, when offered, the create row at the end. */
  const rowCount = () => matches().length + (createLabel() ? 1 : 0);

  const chosen = (option: SelectOption) => state.value.some((entry) => entry.value === option.value);

  const close = (refocus = true) => {
    if (!state.open) return;
    if (config.canToggle?.('closed') === false) return;
    state.open = false;
    state.search = '';
    state.active = 0;
    dismiss.deactivate();
    syncAssigned();
    config.onToggle?.('closed');
    if (refocus) ((assigned.trigger ?? assigned.fallbackTrigger) as HTMLElement | undefined)?.focus?.();
  };

  const open = () => {
    if (state.open || disabled()) return;
    if (config.canToggle?.('open') === false) return;
    state.open = true;
    dismiss.activate();
    syncAssigned();
    config.onToggle?.('open');
  };

  const dismiss = useDismiss(element, (event) => {
    /** Escape refocuses the trigger (the user is keyboard-driving); an outside press must not steal focus. */
    close(event !== undefined);
  });

  const commit = (value: SelectOption[]) => {
    state.value = value;
    syncAssigned();
    config.onChange?.([...value]);
  };

  const pick = (option: SelectOption | undefined) => {
    if (!option || option.disabled) return;
    if (multi()) {
      commit(chosen(option) ? state.value.filter((entry) => entry.value !== option.value) : [...state.value, option]);
    } else {
      commit([option]);
      close();
    }
  };

  /** Step the active row, skipping disabled options; wraps in both directions. The create row
   *  (index `matches().length`) is walkable and never disabled. */
  const step = (delta: number) => {
    const count = rowCount();
    if (count === 0) return;
    const rows = matches();
    let next = state.active;
    for (let i = 0; i < count; i++) {
      next = (next + delta + count) % count;
      if (next >= rows.length || !rows[next]?.disabled) break;
    }
    state.active = next;
  };

  /** Activate row `index`: a real row picks; the create row hands the label to the host. */
  const activate = (index: number) => {
    const rows = matches();
    if (index === rows.length && createLabel()) config.onCreate?.(createLabel());
    else pick(rows[index]);
  };

  // ── the handlers — bound by the host template on its own nodes, attached here on assigned ones ─

  const onTriggerClick = () => {
    if (disabled()) return;
    if (state.open) close();
    else open();
  };

  /**
   * Typeahead, as the APG select-only combobox prescribes: printable characters accumulate for
   * half a second and the active row jumps to the next enabled label with that prefix, wrapping,
   * starting after the current row so repeated presses of one letter cycle its matches.
   */
  let typed = '';
  let typedAt = 0;
  const typeahead = (character: string) => {
    const now = Date.now();
    typed = (now - typedAt < 500 ? typed : '') + character.toLowerCase();
    typedAt = now;
    if (!state.open) open();
    const rows = matches();
    for (let offset = typed.length > 1 ? 0 : 1; offset <= rows.length; offset++) {
      const index = (state.active + offset) % rows.length;
      const row = rows[index];
      if (row && !row.disabled && row.label.toLowerCase().startsWith(typed)) {
        state.active = index;
        return;
      }
    }
  };

  const onTriggerKeydown = (event: KeyboardEvent) => {
    if (disabled()) return;
    /** The chips pattern: Backspace on the trigger removes the most recent pill in multi mode. */
    if (event.key === 'Backspace' && multi() && state.value.length) {
      event.preventDefault();
      pick(state.value[state.value.length - 1]);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== ' ') {
      event.preventDefault();
      typeahead(event.key);
      return;
    }
    if (state.open) {
      /** No search line means focus stays on the trigger — it must drive the open menu too. */
      onMenuKeydown(event);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
      event.preventDefault();
      open();
    }
  };

  /** One keydown for the open menu — arrows, Enter, Tab. Escape belongs to `useDismiss`. */
  const onMenuKeydown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      step(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      state.active = event.key === 'Home' ? 0 : Math.max(rowCount() - 1, 0);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      activate(state.active);
    } else if (event.key === 'Tab') {
      close(false);
    }
  };

  const onSearchInput = (event: Event) => {
    state.search = (event.target as HTMLInputElement).value;
    state.active = 0;
    config.onSearch?.(state.search);
  };

  /** Delegated: one listener on the list, rows addressed by `data-index` — never per-row handlers. */
  const onListClick = (event: Event) => {
    const row = (event.target as Element).closest?.('[data-index]');
    if (row) activate(Number((row as HTMLElement).dataset['index']));
  };

  const onListHover = (event: Event) => {
    const row = (event.target as Element).closest?.('[data-index]');
    if (!row) return;
    const index = Number((row as HTMLElement).dataset['index']);
    /** A disabled row never takes the highlight — hovering one showed the active tint while
     *  Enter refused, a mixed signal native selects do not send. */
    if (matches()[index]?.disabled) return;
    state.active = index;
  };

  // ── assigned markup ────────────────────────────────────────────────────────────────────────────

  /** The stamp map for the search line — same single-source rule as the trigger's. */
  const searchStamps = (activeId: string | null): Record<string, string> => ({
    'aria-controls': 'listbox',
    'aria-autocomplete': 'list',
    ...(state.open && activeId ? { 'aria-activedescendant': activeId } : {}),
  });

  /**
   * No listeners here, deliberately: a slotted input's input/keydown events retarget through the
   * slot and bubble into the menu's own delegated handlers — the platform already delivers them,
   * and a second listener double-fires (measured: Enter picked, closed, reset the filter, then
   * the bubbled Enter picked again from the unfiltered list). Wiring is ARIA only.
   */
  const wireSearch = (search: Element) => {
    search.setAttribute('aria-controls', 'listbox');
    search.setAttribute('aria-autocomplete', 'list');
  };

  /**
   * Wired-once, tracked per NODE across its whole life — not against the previous assignment.
   * Re-slotting a node away and back (A -> B -> A) passed the "different from last" check and
   * wired A twice; duplicate click listeners toggled twice per click and the menu never opened.
   */
  const wired = new WeakSet<Element>();
  const wireTrigger = (trigger: Element) => {
    if (wired.has(trigger)) return;
    wired.add(trigger);
    trigger.addEventListener('click', onTriggerClick);
    trigger.addEventListener('keydown', onTriggerKeydown as EventListener);
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
  };

  /**
   * Reflect state onto assigned nodes. The host template does this reactively for its own markup;
   * this is the same knowledge applied imperatively to markup we do not render. Runs from the
   * effect below on state changes, and from `attach` directly — a swapped-in node must be stamped
   * now, not on the next state change.
   */
  /**
   * THE STAMP MAP — the single source for every state attribute a trigger carries. The host's
   * template spreads exactly this object onto its own trigger; `syncAssigned` applies the same
   * object imperatively to a slotted one. One definition, two consumers, drift impossible — the
   * previous shape wrote the knowledge twice, the house's most-repeated defect class.
   */
  const triggerStamps = (): Record<string, string> => ({
    'aria-expanded': String(state.open),
    'aria-disabled': String(disabled()),
    'data-state': state.open ? 'open' : 'closed',
  });

  const syncAssigned = () => {
    if (assigned.trigger)
      for (const [name, value] of Object.entries(triggerStamps())) assigned.trigger.setAttribute(name, value);
    /** A slotted value node is stamped, never rewritten: you slot it, you own its children (§5). */
    if (assigned.value)
      assigned.value.setAttribute('data-label', state.value.map((option) => option.label).join(', '));
  };

  /**
   * Hand over the user-supplied nodes (and nothing else — the template owns its own). Re-callable:
   * the host calls it again on `slotchange`, and previously assigned nodes that vanished from the
   * document take their listeners with them.
   */
  const attach = (parts: AssignedParts) => {
    if (parts.trigger && parts.trigger !== assigned.trigger) wireTrigger(parts.trigger);
    if (parts.search && parts.search !== assigned.search) wireSearch(parts.search);
    assigned = { ...parts };
    syncAssigned();
  };

  /**
   * Registered before the host's `render()` — hooks registered after it are ignored. The reads
   * inside `syncAssigned` (open, value) are what subscribe this effect to the store.
   */
  useEffect(syncAssigned, element);

  return {
    state,
    matches,
    createLabel,
    rowCount,
    chosen,
    open,
    close,
    pick,
    activate,
    step,
    attach,
    setOptions,
    triggerStamps,
    searchStamps,
    /** For hosts that write `state` directly (a value property setter): restamp assigned nodes. */
    sync: syncAssigned,
    handlers: { onTriggerClick, onTriggerKeydown, onMenuKeydown, onSearchInput, onListClick, onListHover },
  };
};
