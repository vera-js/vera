// threadrace setup form: a nested read of a NEW object each time, so every read misses the proxy cache and goes
// through handlerFor (the type door) and wrap. ok() checks every read returned what was written.
export const setup = ({ createStore }) => {
  const s = createStore({ o: null });
  let sink = 0, expected = 0, k = 0;
  return {
    work: (n) => { for (let i = 0; i < n; i++, k++) { s.o = { a: k, b: { c: k } }; sink += s.o.a + s.o.b.c; expected += 2 * k; } },
    ok: () => sink === expected,
  };
};
