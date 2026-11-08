// threadrace setup form: a signal read by a sync effect; each op is one write (the effect re-runs) and 10 plain reads.
export const setup = ({ signal, effect }) => {
  const s = signal(0);
  let sink = 0, expected = 0, runs = 0, done = 0, k = 0;
  effect(() => { sink += s.value; runs++; }, { owner: {}, timing: 'sync' }).run();
  return {
    work: (n) => { for (let j = 0; j < n; j++) { s.value = ++k; for (let i = 0; i < 10; i++) sink += s.value; expected += 11 * k; } done += n; },
    /** Every write re-ran the effect once, and every read (the effect's and the 10 plain ones) saw the written value. */
    ok: () => runs === done + 1 && sink === expected,
  };
};
