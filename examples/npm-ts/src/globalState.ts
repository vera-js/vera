import { createStore } from '@verajs/core';

export const globalState = createStore({
  hello: 'hello',
  goodbye: 'success',
  showGoodbye: false,
});
