import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import { veraJsx } from './packages/jsx/src/index.js';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const getPackagePath = (packageName) => `packages/${packageName}/src/index.ts`;

/** Generates an object with this format: '@verajs/core': resolve(__dirname, 'core/src/index.ts'), */
const getAllPaths = (namespace, packageNames) =>
  packageNames.reduce((acc, packageName) => {
    acc[`${namespace}/${packageName}`] = resolve(__dirname, getPackagePath(packageName));
    return acc;
  }, {});

const packages = ['autoloader', 'core', 'inserts', 'renderer', 'router', 'shared-types', 'shared-utils'];
const namespace = '@verajs';
const paths = getAllPaths(namespace, packages);
export default defineConfig(() => {
  return {
    plugins: [veraJsx()],
    resolve: {
      alias: paths,
    },
  };
});
