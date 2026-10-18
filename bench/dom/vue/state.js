/** The state the compiled Vue rows read: rows are plain objects in a shallowRef, edited in place as Vue's own benchmark entry does. */
import { ref, shallowRef } from 'vue';
export const rows = shallowRef([]);
export const selected = ref(-1);
