// threadrace setup form: a fresh record HOLDING a store child written each op, then read through (nested-hold.mjs).
export const setup = ({ createStore }) => {
  const s = createStore({ row: null, pool: Array.from({ length: 10 }, (_, i) => ({ v: i })) });
  let sink = 0, expected = 0, k = 0;
  return {
    work: (n) => { for (let i = 0; i < n; i++, k++) { s.row = { id: k, child: s.pool[k % 10] }; sink += s.row.child.v; expected += k % 10; } },
    ok: () => sink === expected,
  };
};
