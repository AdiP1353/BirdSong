# BirdSong

BirdSong is an acoustic mesh network: devices pass encrypted text messages to each other as synthetic birdsong played through speakers and heard by microphones. Nine other plans build its parts in parallel. That only works if all dependencies are already installed, so nobody edits `package.json` or the lockfile at the same time, and every shared type, constant and function signature already exists in code, so parallel work compiles against the same contract.

## Commands

| Purpose   | Command                 | Expected on success        |
|-----------|-------------------------|----------------------------|
| Install   | `npm install`           | exit 0                     |
| Typecheck | `npm run typecheck`     | exit 0, no errors          |
| Tests     | `npm test`              | all pass                   |
| One file  | `npx vitest run <path>` | all pass                   |

## Source-code rules

TypeScript runs without a build step (Node strips types natively; Vite and Vitest transpile it themselves), so:

1. Relative imports include the `.ts` extension: `import { x } from './foo.ts'`.
2. Type-only imports use `import type { ... }`.
3. No `enum`, no `namespace`, no constructor parameter properties (`constructor(private x: number)`), because Node cannot strip them.
4. When passing a typed array to WebCrypto or Web Audio and the compiler complains about `ArrayBufferLike`, pass `x.slice()` (a fresh copy); never change a shared signature to work around it.

Detailed plans live in plans/. Protocol constants live in packages/core/src/constants.ts.
