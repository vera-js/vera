// The same site for both arms: N pages, each a layout + nav + 20 cards with per-page data. Deterministic.
const WORDS = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon'.split(' ');
const word = (k) => WORDS[k % WORDS.length];
export const pages = (n) => Array.from({ length: n }, (_, id) => ({
  id,
  title: `Page ${id}: ${word(id)} & ${word(id * 7)}`,
  links: Array.from({ length: 10 }, (_, k) => ({ href: `/${(id + k + 1) % n}/`, label: `${word(id + k)} ${k}` })),
  cards: Array.from({ length: 20 }, (_, c) => ({
    title: `${word(id + c)} <${c}>`,
    text: Array.from({ length: 16 }, (_, w) => word(id * 3 + c * 5 + w)).join(' '),
    tags: [word(c), word(c + id), word(c * id + 1)],
  })),
}));
