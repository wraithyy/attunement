# CLAUDE.md — attunement

Typed, validated runtime config for SPAs. OSS library, npm name `attunement`
(reserve before publishing). Comments in code English and terse, no emoji.

## What it is

Build once, deploy anywhere: config loads at runtime (fetched JSON / HTML
inject), gets validated against a schema, and the app never renders before
config is available. Generalized from the pattern used in real apps (App A,
App B) — see [`docs/plan.md`](docs/plan.md) for the roadmap and case
studies.

## Architecture — binding principles

- **Core is framework-agnostic with zero dependencies.** `src/index.ts` must not
  import React or anything from npm (only types from `@standard-schema/spec` —
  type-only, erased at build). Framework adapters are separate subpath entries
  (`attunement/react`, future `attunement/vue`...), each a thin wrapper over
  `attune()`.
- **Standard Schema, not Zod.** Validation goes exclusively through
  `schema["~standard"].validate()`. Never import zod in runtime code (tests
  only). Users bring Zod/Valibot/ArkType themselves.
- **Tree-shaking is a requirement, not a bonus:** `sideEffects: false` in
  package.json must actually hold — no module-level code, named exports only,
  no barrel re-exports of runtime values across entry points beyond
  `react.tsx → index.js`. New capability = new export, not a fatter existing
  object.
- **Factory pattern API:** `attune(options)` / `attuneReact(options)` return a
  handle; types flow by inference from the schema, consumers never write
  generics.
- **Eager load:** the promise starts when `attune()` is called (module scope on
  the user side), not at render time. Keep the `.catch(() => {})` guard against
  unhandledrejection.
- **Small core.** New functionality goes into new entry points (`/cli`, `/vite`,
  `/devtools`); core stays ~100 lines. Before adding to core, ask: can this be
  a Source or an adapter instead?

## Structure

```
src/index.ts       core: attune(), Source, fromJson, fromWindow, ConfigError
src/react.tsx      attuneReact(): Provider (Suspense + ConfigBoundary), use()
src/index.test.ts  core tests (Vitest)
tsup.config.ts     one entry per file = one entry in package.json exports
docs/plan.md       roadmap + how the source apps do it today
```

## Commands

```
pnpm test        # Vitest
pnpm typecheck   # tsc --noEmit
pnpm build       # tsup → dist (ESM + d.ts)
```

All three must pass before committing. New entry point = add to
`tsup.config.ts` **and** `package.json#exports` (types + default).

## Conventions

- TypeScript strict, no `any`, no gratuitous casts; a cast needs a comment
  saying why.
- Tests: core business logic (source chain, validation, cache, onLoad) is
  mandatory; React wiring has no coverage requirement.
- Peer deps always optional (`peerDependenciesMeta`) — core must install
  without React.
- React adapter: React 19 minimum (`use()`); don't lower for compatibility —
  older React can use `load()` plus its own wiring.
- Error messages: technically precise, always name the offending key; easter
  eggs ("you didn't say the magic word") are seasoning, never a substitute for
  information.
