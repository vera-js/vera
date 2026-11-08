<script setup>
/** `Rows.vue`'s template over Vue's deep `reactive` (2026-10-31, the churn test); see reactive-state.js. */
import { state } from './reactive-state.js';
</script>

<template>
  <table><tbody><tr v-for="{ id, label } of state.rows" :key="id" :class="id === state.selected ? 'selected' : undefined" v-memo="[label, id === state.selected]"><td>{{ id }}</td><td><a>{{ label }}</a></td><td><a>x</a></td></tr></tbody></table>
</template>
