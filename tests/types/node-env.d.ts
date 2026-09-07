/**
 * Loads `@types/node` into the ROOT type-check program (`tsconfig.json`:
 * examples + tests/types + every package's sources under one roof), which
 * `packages/cms`'s node entries need for `node:fs`/`node:path`/`node:process`.
 *
 * A reference file rather than `"types": ["node"]` in the root config on
 * purpose: package tsconfigs EXTEND the root, and inheriting node's globals
 * would hand every browser-only package a valid `process` — masking exactly
 * the class of mistake the per-package configs exist to catch. This file is
 * included only by the root program, so the scope is exact.
 *
 * (Until the motion retirement, 2026-09-06, a motion file carried this
 * reference incidentally and the root program resolved node types through
 * it — nothing declared the dependency, which is why removing the package
 * surfaced it. TS 6 does not auto-include `node_modules/@types` here.)
 */
/// <reference types="node" />
export {};
