import { createStore, effect } from '@verajs/core';

export const testingChunks = () => {
  const state = createStore({ test: 'testing' });

  effect(() => {
    console.log('TEST STATE CHANGED', state.test);
  });
  return state;
};
