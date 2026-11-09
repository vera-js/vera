// threadrace setup form: a 100-row list replaced by a reordered copy of its own proxies, every row read (array-replace.mjs).
export const setup = ({ createStore }) => {
  const s = createStore({ rows: Array.from({ length: 100 }, (_, i) => ({ id: i })) });
  let sink = 0;
  return {
    work: (n) => {
      for (let k = 0; k < n; k++) {
        const rows = s.rows;
        const next = [rows[99]];
        for (let i = 0; i < 99; i++) next.push(rows[i]);
        s.rows = next;
        const now = s.rows;
        for (let i = 0; i < 100; i++) sink += now[i].id;
      }
    },
    ok: () => sink % 4950 === 0 && sink > 0,
  };
};
