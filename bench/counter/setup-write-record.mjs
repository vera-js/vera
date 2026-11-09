// threadrace setup form: a fresh plain record written into a store each op (an own key overwritten: one trigger), read back.
export const setup = ({ createStore }) => {
  const s = createStore({ row: null });
  let sink = 0, expected = 0, k = 0;
  return {
    work: (n) => { for (let i = 0; i < n; i++, k++) { s.row = { id: k, label: 'r', on: true }; sink += s.row.id; expected += k; } },
    ok: () => sink === expected,
  };
};
