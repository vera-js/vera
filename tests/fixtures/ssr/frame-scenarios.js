/** Shared by the jsdom run and the shim run: three frame-id scenarios, each logging into `log`. */
export const scenarios = (raf, caf, log) => {
  /** 1. Stale cancel: A has run; canceling A's id must not cancel B, scheduled after. */
  const first = raf(() => {
    log.push('a');
    raf(() => log.push('b'));
    caf(first);
  });
  /** 2. Same-frame cancel: x cancels y, both queued for the same frame — y must not run. */
  let y = 0;
  raf(() => {
    log.push('x');
    caf(y);
  });
  y = raf(() => log.push('y'));
  /** 3. Ids are unique across frames: one taken now, one inside a later frame. */
  const early = raf(() => {
    const late = raf(() => {});
    log.push(late !== early && late !== first && late !== y ? 'unique' : `REUSED ${late}`);
  });
};
