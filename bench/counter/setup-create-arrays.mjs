// threadrace setup form: a store over a grid of 10 fresh arrays, every row read once, per op (each array meets the
// store's door: a cache miss and a handler decision per array). create-arrays.mjs's counter twin.
export const setup = ({ createStore }) => {
  let sink = 0, k = 0;
  return {
    work: (n) => {
      for (let i = 0; i < n; i++, k++) {
        const s = createStore({ grid: [[k], [1], [2], [3], [4], [5], [6], [7], [8], [9]] });
        for (let r = 0; r < 10; r++) sink += s.grid[r][0];
      }
    },
    ok: () => sink > 0,
  };
};
