// threadrace setup form: a store list swap plus 50 row reads per op (the counter's `swap`).
export const setup = ({ createStore }) => {
  const rows = []; for (let i = 0; i < 1000; i++) rows.push({ id: i, label: 'r' + i });
  const s = createStore({ rows });
  let sink = 0;
  return {
    work: (n) => { for (let k = 0; k < n; k++) { const l = s.rows; const a = l[1], b = l[998]; l[1] = b; l[998] = a; for (let i = 0; i < 50; i++) sink += l[i].id; } },
    ok: () => s.rows.length === 1000 && sink > 0,
  };
};
