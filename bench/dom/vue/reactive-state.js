/** Vue's own deep `reactive`, for the churn test (2026-10-31): each row is a reactive proxy made on its first read, kept in Vue's WeakMap. Not its benchmark entry, which holds plain rows in a shallowRef. */
import { reactive } from 'vue';
export const state = reactive({ rows: [], selected: -1 });
