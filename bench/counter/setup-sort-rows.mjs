// threadrace setup form: a store array of 100 row objects that a sync effect reads, sorted by a field one way and back.
export const setup = ({ createStore, effect }) => {
  const s = createStore({ rows: Array.from({ length: 100 }, (_, i) => ({ id: i, rank: (i * 37) % 100 })) });
  const rows = s.rows;
  let runs = 0, done = 0, sink = 0;
  effect(() => { sink += rows[0].id + rows.length; runs++; }, { owner: {}, timing: 'sync' }).run();
  return {
    work: (n) => { for (let k = 0; k < n; k++) { rows.sort((a, b) => a.rank - b.rank); rows.sort((a, b) => b.id - a.id); } done += n; },
    ok: () => runs > done && rows.length === 100 && sink > 0,
  };
};
