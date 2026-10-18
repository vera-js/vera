<script setup>
/**
 * Vue as its own js-framework-benchmark entry writes it (krausest/js-framework-benchmark frameworks/keyed/vue/src/App.vue,
 * checked 2026-10-18): a compiled template, keyed v-for, and `v-memo` on [label, selected], so a select or an update
 * patches only the rows it changed. Adapted to this harness's markup (no handlers, `selected` rather than `danger`).
 */
import { rows, selected } from './state.js';
</script>

<template>
  <table><tbody><tr v-for="{ id, label } of rows" :key="id" :class="id === selected ? 'selected' : undefined" v-memo="[label, id === selected]"><td>{{ id }}</td><td><a>{{ label }}</a></td><td><a>x</a></td></tr></tbody></table>
</template>
