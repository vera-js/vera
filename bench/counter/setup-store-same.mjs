// threadrace setup form: three writes that change nothing (the store's "no change" path) and one that does, per op.
export const setup = ({ createStore }) => {
  const s = createStore({ a: 1, b: 'x', c: true, n: 0 });
  let sink = 0, expected = 0, k = 0;
  return {
    work: (n) => { for (let i = 0; i < n; i++, k++) { s.a = 1; s.b = 'x'; s.c = true; s.n = k; sink += s.n; expected += k; } },
    ok: () => sink === expected && s.a === 1 && s.b === 'x' && s.c === true,
  };
};
