// threadrace setup form: creating a signal and reading it once per op (one small object per op: allocation-light).
export const setup = ({ signal }) => {
  let sink = 0, expected = 0, k = 0;
  const keep = new Array(1024);
  return {
    work: (n) => { for (let i = 0; i < n; i++, k++) { const s = signal(k); keep[k & 1023] = s; sink += s.value; expected += k; } },
    ok: () => sink === expected,
  };
};
