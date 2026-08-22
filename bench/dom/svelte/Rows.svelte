<script>
  import { store } from './state.svelte.js';
</script>

<!--
  Markup must match every other implementation byte for byte:
    <tr class="{selected}"><td>{id}</td><td><a>{label}</a></td><td><a>x</a></td></tr>
  `undefined` rather than '' on the unselected branch, so the class attribute is absent rather
  than empty — React and Preact omit it, and an empty attribute would be a different DOM.
-->
<table><tbody>{#each store.rows as row (row.id)}<tr class={store.selected === row.id ? 'selected' : undefined}><td>{row.id}</td><td><a>{row.label}</a></td><td><a>x</a></td></tr>{/each}</tbody></table>
