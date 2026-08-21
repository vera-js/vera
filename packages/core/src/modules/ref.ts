import { createProxy } from '../services/createProxy.js';

export const ref = <T>(initialValue: T) => {
  return createProxy({ value: initialValue });
};

export const shallowRef = <T>(initialValue: T) => {
  return createProxy({ value: initialValue, _ignore: true });
};
