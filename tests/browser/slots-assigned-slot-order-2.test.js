/** `assignedSlot` with two copies on one page — copy 2's light host first. See slots-assigned-slot-two-copies.mjs. */
import { run } from './slots-assigned-slot-two-copies.mjs';

it('two independent copies of slots: each answers assignedSlot for its own nodes, copy 2 installed first', async () => {
  await run(2);
});
