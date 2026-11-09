// threadrace setup form: a splice and a push on a 1000-item store array that a sync effect reads at a few indices.
export const setup = ({ createStore, effect }) => {
  const s = createStore({ list: Array.from({ length: 1000 }, (_, i) => i) });
  const list = s.list;
  let runs = 0, done = 0, sink = 0;
  effect(() => { sink += list[0] + list[500] + list.length; runs++; }, { owner: {}, timing: 'sync' }).run();
  return {
    work: (n) => { for (let k = 0; k < n; k++) { list.splice(400, 1); list.push(k); } done += n; },
    ok: () => runs > done && list.length === 1000 && sink > 0,
  };
};
