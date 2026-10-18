<svelte:options runes={true} />
<script>
  import { runes } from './runes-state.svelte.js';
</script>

<table><tbody>{#each runes.rows as row (row)}<tr class={runes.selected === row.id ? 'selected' : undefined}><td>{row.id}</td><td><a>{row.label}</a></td><td><a>x</a></td></tr>{/each}</tbody></table>
