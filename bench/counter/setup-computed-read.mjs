// threadrace setup form: an UNWATCHED computed read, its source written every 10th op (computed-read.mjs's twin).
export const setup = ({ createStore, computed }) => {
  const s = createStore({ n: 1 });
  const c = computed(() => s.n * 2);
  let sink = 0, k = 0;
  return { work: (n) => { for (let i = 0; i < n; i++, k++) { if (k % 10 === 0) s.n = k; sink += c.value; } }, ok: () => sink > 0 };
};
