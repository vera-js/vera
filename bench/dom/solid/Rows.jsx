/**
 * Solid as it is meant to be written, compiled by babel-preset-solid (templates cloned, fine-grained
 * bindings): JSX, <For>, createSelector for selection, a signal per label, `batch` for the update, and
 * cells written by `textContent` — matching Solid's own js-framework-benchmark entry
 * (krausest/js-framework-benchmark frameworks/keyed/solid/src/main.jsx at 5ae24598, checked 2026-10-18),
 * adapted to this harness's row: the same markup as every other implementation here, so no per-row click
 * handlers (the harness calls each operation directly, and no other framework's rows carry one).
 */
import { createSignal, createSelector, For, batch } from 'solid-js';
import { render } from 'solid-js/web';

const toRow = ({ id, label }) => {
  const [text, setText] = createSignal(label);
  return { id, text, setText };
};

export const mountSolid = (host, buildData) => {
  const [rows, setRows] = createSignal([]);
  const [selected, setSelected] = createSignal(-1);
  const isSelected = createSelector(selected);
  const dispose = render(
    () => (
      <table>
        <tbody>
          <For each={rows()}>
            {(row) => (
              <tr class={isSelected(row.id) ? 'selected' : undefined}>
                <td textContent={row.id} />
                <td><a textContent={row.text()} /></td>
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
    create: (n, seed) => { setRows(buildData(n, seed).map(toRow)); },
    append: (n, seed) => { setRows(rows().concat(buildData(n, seed).map(toRow))); },
    updateEvery10th: () => batch(() => { const r = rows(); for (let i = 0; i < r.length; i += 10) r[i].setText((t) => t + ' !!!'); }),
    swap: () => { const next = rows().slice(); if (next.length > 998) { const t = next[1]; next[1] = next[998]; next[998] = t; } setRows(next); },
    select: (i) => { setSelected(rows()[i]?.id ?? -1); },
    remove: (i) => { const next = rows().slice(); next.splice(i, 1); setRows(next); },
    clear: () => { setRows([]); },
    teardown: () => { dispose(); host.remove(); },
  };
};
