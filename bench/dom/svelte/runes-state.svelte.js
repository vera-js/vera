/**
 * Svelte as its own js-framework-benchmark entry writes it (frameworks/keyed/svelte/src/Main.svelte, checked 2026-10-18):
 * runes, `$state.raw` for the rows and the selection, and a `$state.raw` label per row, edited in place. Without both
 * runes mode and `$state.raw`, a swap or a remove re-ran every row (measured: 1000 label reads vs 0).
 */
export class Row {
  id;
  label = $state.raw('');
  constructor(id, label) { this.id = id; this.label = label; }
}
class Store {
  rows = $state.raw([]);
  selected = $state.raw(-1);
}
export const runes = new Store();
