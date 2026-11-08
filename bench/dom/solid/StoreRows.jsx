/**
 * Solid's own deep store, for the churn test (2026-10-31): the same compiled rows as `Rows.jsx`, with `createStore` from `solid-js/store` in place of a signal per label, so each row is a store proxy made on
 * its first read. Solid's store keeps that proxy on a field of the raw object, where a WeakMap cache keeps it in a table. Not its benchmark entry: this measures what its store costs, not its best form.
 */
import { createSelector, For } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { render } from 'solid-js/web';

export const mountSolidStore = (host, buildData) => {
  const [state, setState] = createStore({ rows: [], selected: -1 });
  const isSelected = createSelector(() => state.selected);
  const dispose = render(
    () => (
      <table>
        <tbody>
          <For each={state.rows}>
            {(row) => (
              <tr class={isSelected(row.id) ? 'selected' : undefined}>
                <td textContent={row.id} />
                <td><a textContent={row.label} /></td>
                <td><a>x</a></td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    ),
    host
  );
  return {
    create: (n, seed) => { setState('rows', buildData(n, seed)); },
    append: (n, seed) => { setState('rows', (rows) => [...rows, ...buildData(n, seed)]); },
    updateEvery10th: () => { setState('rows', (_, i) => i % 10 === 0, 'label', (label) => label + ' !!!'); },
    swap: () => { setState(produce((s) => { if (s.rows.length > 998) { const t = s.rows[1]; s.rows[1] = s.rows[998]; s.rows[998] = t; } })); },
    select: (i) => { setState('selected', state.rows[i]?.id ?? -1); },
    remove: (i) => { setState('rows', (rows) => rows.filter((_, j) => j !== i)); },
    clear: () => { setState('rows', []); },
    teardown: () => { dispose(); host.remove(); },
  };
};
