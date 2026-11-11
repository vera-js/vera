// threadrace setup form: a computed made and read once per op (computed-create.mjs's twin).
export const setup = ({ createStore, computed }) => {
  const s = createStore({ n: 3 });
  let sink = 0, k = 0;
  return { work: (n) => { for (let i = 0; i < n; i++, k++) { const c = computed(() => s.n + k); sink += c.value; } }, ok: () => sink > 0 };
};
