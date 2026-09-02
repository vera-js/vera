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

  const matches = (): SelectOption[] => {
    const needle = state.search.trim().toLowerCase();
    return needle ? state.options.filter((option) => option.label.toLowerCase().includes(needle)) : [...state.options];
  };

  const chosen = (option: SelectOption) => state.value.some((entry) => entry.value === option.value);

  const close = (refocus = true) => {
    if (!state.open) return;
    state.open = false;
    state.search = '';
    state.active = 0;
    dismiss.deactivate();
    syncAssigned();
    if (refocus) (assigned.trigger as HTMLElement | undefined)?.focus?.();
  };

  const open = () => {
    if (state.open) return;
    state.open = true;
    dismiss.activate();
    syncAssigned();
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

  /** Step the active row, skipping disabled options; wraps in both directions. */
  const step = (delta: number) => {
    const rows = matches();
    if (rows.length === 0) return;
    let next = state.active;
    for (let i = 0; i < rows.length; i++) {
      next = (next + delta + rows.length) % rows.length;
      if (!rows[next]?.disabled) break;
    }
    state.active = next;
  };

  // ── the handlers — bound by the host template on its own nodes, attached here on assigned ones ─

  const onTriggerClick = () => (state.open ? close() : open());

  const onTriggerKeydown = (event: KeyboardEvent) => {
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
    } else if (event.key === 'Enter') {
      event.preventDefault();
      pick(matches()[state.active]);
    } else if (event.key === 'Tab') {
      close(false);
    }
  };

  const onSearchInput = (event: Event) => {
    state.search = (event.target as HTMLInputElement).value;
    state.active = 0;
  };

  /** Delegated: one listener on the list, rows addressed by `data-index` — never per-row handlers. */
  const onListClick = (event: Event) => {
    const row = (event.target as Element).closest?.('[data-index]');
    if (row) pick(matches()[Number((row as HTMLElement).dataset['index'])]);
  };

  const onListHover = (event: Event) => {
    const row = (event.target as Element).closest?.('[data-index]');
    if (row) state.active = Number((row as HTMLElement).dataset['index']);
  };

  // ── assigned markup ────────────────────────────────────────────────────────────────────────────

  const wireTrigger = (trigger: Element) => {
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
  const syncAssigned = () => {
    if (assigned.trigger) {
      assigned.trigger.setAttribute('aria-expanded', String(state.open));
      assigned.trigger.setAttribute('data-state', state.open ? 'open' : 'closed');
    }
    if (assigned.value) assigned.value.textContent = state.value.map((option) => option.label).join(', ');
  };

  /**
   * Hand over the user-supplied nodes (and nothing else — the template owns its own). Re-callable:
   * the host calls it again on `slotchange`, and previously assigned nodes that vanished from the
   * document take their listeners with them.
   */
  const attach = (parts: AssignedParts) => {
    if (parts.trigger && parts.trigger !== assigned.trigger) wireTrigger(parts.trigger);
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
    chosen,
    open,
    close,
    pick,
    step,
    attach,
    /** For hosts that write `state` directly (a value property setter): restamp assigned nodes. */
    sync: syncAssigned,
    handlers: { onTriggerClick, onTriggerKeydown, onMenuKeydown, onSearchInput, onListClick, onListHover },
  };
};
