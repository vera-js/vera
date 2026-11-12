// threadrace setup form: reads of a FROZEN store's keys and nested values, as a config table is read in a render.
export const setup = ({ createStore }) => {
  const s = createStore({ config: Object.freeze({ a: 1, b: 2, nested: Object.freeze({ c: 3 }) }) });
  let sink = 0, done = 0;
  return {
    work: (n) => { for (let k = 0; k < n; k++) { const c = s.config; sink += c.a + c.b + c.nested.c; } done += n; },
    ok: () => done > 0 && sink === done * 6,
  };
};
