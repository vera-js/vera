import { createStore, useEffect } from '@verajs/core';

export const testingChunks = () => {
  const state = createStore({ test: 'testing' });

  useEffect(() => {
    console.log('TEST STATE CHANGED', state.test);
  });
  return state;
};
