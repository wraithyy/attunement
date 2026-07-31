# API wave — field report P3, P10, P11, P12/P13

## Context

Field report (docs/FIELD-REPORT.md) identified structural issues that need API
additions, not docs: module cycles around `onLoad` (P3), config module as a
React/CLI choke point (P10), no path out of a rejected load (P11), test
provider ergonomics (P12/P13). All additive — one minor release.

Decisions (grilled 2026-07-31, then validated by a 6-persona review panel:
junior/medior/senior FE, fullstack/ops, library author, React specialist —
all features approved to ship, with the changes folded in below):

- **One callback queue, two names.** `onReady(cb)` is the mechanism;
  `options.onLoad` becomes sugar for a callback registered first. Same
  machinery, same guarantees — never two execution tiers. (Senior FE: fix it
  pre-1.0 or freeze the split forever.)
- **onReady late registration:** run immediately via the cached promise +
  `console.warn` in DEV. Late-callback errors must surface loudly in prod
  too (unhandled rejection is fine, silence is not); on an already-rejected
  load, late callbacks no-op.
- **onReady errors** (timely registration): reject the load promise — broken
  render-critical wiring should hit `errorFallback`, not render a broken
  tree. Docs must give the counter-recipe for non-critical wiring
  (analytics: try/catch inside the callback, or `.load().then()`).
- **bindReact:** new export; `attuneReact(options)` stays as the convenience
  wrapper (`bindReact(attune(options))`). No deprecation.
- **P11 retry:** `retry: () => void` (required param — optional forces
  consumers to handle undefined for zero benefit), passed to function
  `errorFallback` as 2nd arg + Retry button in the default fallback.
  Contract wording in the type docs: "recovers by any means; currently a
  full page reload" — leaves room to change the mechanism without breaking
  the contract. No cache-dropping `reload()` — `onLoad` wiring is not
  guaranteed idempotent; load-once + page reload is the library's model.
- **P12/P13 testing:** no new API. Baseline fixture is userland spread
  (`createTestProvider(config, {...base, ...overrides})`) — document it.
  Async schemas stay sync-only in tests; clearer error + documented caveat.

## Requirements

1. `onReady(cb)` on the core handle: single queue shared with `onLoad`,
   callbacks awaited in registration order before `load()` resolves.
   Callback errors reject the load. Post-resolve registration: invoke
   immediately, DEV warn, errors surface, no-op on rejected load.
2. `bindReact(attuned)` in `attunement/react`: React binding over an existing
   core handle. Requires `_schema` on the core handle so devtools/testing
   work through either path. Each `bindReact` call is an independent binding
   (own context) over the same shared load — document, don't guard.
3. `errorFallback` function form gets `(error, retry)`; default fallback gets
   a Retry button. `retry` = full page reload.
4. Docs: three-file layout (schema / core / react binding), test baseline
   pattern, async-schema caveat, and the panel-sourced notes listed in 3.1.

## Risks

- **`_schema` generic threading** — `Attuned<T>` → `Attuned<T, S>` with a
  defaulted generic compiles unchanged for annotations, but the new required
  property breaks hand-built mocks (`const fake: Attuned<C> = { load, ... }`)
  — changelog note required.
- **Inference footgun** — annotating the handle (`const cfg: Attuned<Config>
  = attune(...)`) erases `S`; `bindReact` then infers `unknown`. Docs: "let
  inference flow."
- **Queue draining** — callbacks can be registered while another callback
  awaits (dynamic import inside onReady). Drain with an index loop, set the
  resolved flag only after the drain settles; clear the array afterwards
  (GC). Test nested registration explicitly.
- **DEV detection** — `process.env?.NODE_ENV` breaks bundler define-replace
  and `typeof process` is false in Vite browser ESM. Pattern (already fixed
  in react.tsx): dotted `process.env.NODE_ENV` literal OR
  `import.meta.env?.DEV`.
- Rejected ideas, do not resurrect: DEV warning for "Provider mounted after
  resolve" (P1 — false-positives with fast sources); WeakMap/symbol for
  `_schema` (dual-package hazard kills it, and inference needs the property);
  memoization guard on double `bindReact` (React-legal, docs sentence
  suffices).

## Tasks

## Task 1.1: onReady + unified callback queue in attune()
- **Agent**: tdd-guide
- **Files**: src/index.ts, src/index.test.ts
- **Depends on**: none
- **Acceptance**: pnpm test — new tests: onLoad runs first, then onReady in
  registration order, all before load() resolves; callback error rejects
  load; callback registering another callback during its await (drained,
  runs before resolve); late registration runs immediately + DEV warns
  (console.warn spy); late callback on rejected load no-ops; late callback
  error is not swallowed; registry cleared after flush; receives
  (config, fingerprint).
- **Prompt seed**: Replace the direct `await options.onLoad?.()` with a
  callback queue: options.onLoad enqueued first, `onReady(cb)` appends.
  Drain by index inside the load chain (not a snapshot loop), flag resolved
  after the drain, clear the array. Post-resolve onReady: invoke via the
  cached promise, console.warn in DEV (dotted process.env.NODE_ENV +
  import.meta.env?.DEV pattern from react.tsx), skip when the load rejected.
  Write tests first.

## Task 1.2: Expose _schema on the core handle
- **Agent**: build-error-resolver (mechanical)
- **Files**: src/index.ts, src/react.tsx, src/devtools.tsx, src/testing.tsx
- **Depends on**: none
- **Acceptance**: pnpm typecheck — Attuned<T, S = StandardSchemaV1> carries
  `_schema: S` (`@internal` JSDoc); AttunedReact inherits it; devtools and
  testing compile unchanged.
- **Prompt seed**: Move the internal `_schema` from AttunedReact down to
  Attuned (defaulted second generic). attune() stores options.schema on the
  handle. Keep `@internal`.

## Task 2.1: bindReact(attuned)
- **Agent**: react-expert
- **Files**: src/react.tsx, src/react.test.tsx (create if missing)
- **Depends on**: 1.2
- **Acceptance**: pnpm test + typecheck — attuneReact === bindReact(attune());
  S inferred from the handle's `_schema` property (no user generics);
  devtools plugin accepts a bindReact result; test covers two bindings over
  one handle = independent contexts, shared load.
- **Prompt seed**: Extract the binding body of attuneReact into
  `bindReact<S extends StandardSchemaV1>(attuned: Attuned<InferOutput<S>, S>)
  : AttunedReact<InferOutput<S>, S>` — `_schema` is the inference site.
  attuneReact becomes `bindReact(attune(options))`. JSDoc: each call is an
  independent binding over the same load; use() only works under its own
  Provider.

## Task 2.2: retry in errorFallback
- **Agent**: react-expert
- **Files**: src/react.tsx, src/devtools.test.tsx or react test file
- **Depends on**: none
- **Acceptance**: pnpm typecheck + test — errorFallback fn form is
  `(error: Error, retry: () => void) => ReactNode` (required param;
  one-arg user fns stay assignable); DefaultErrorFallback renders a Retry
  button; test stubs location.reload (jsdom lacks it) and asserts the call.
- **Prompt seed**: Thread `retry = () => location.reload()` through
  ConfigBoundary. Type-doc the contract: "recovers by any means; currently a
  full page reload." No new state.

## Task 3.1: Docs — three-file layout, onReady rules, testing patterns
- **Agent**: doc-updater
- **Files**: README.md, docs/recipes.md
- **Depends on**: 1.1, 2.1
- **Acceptance**: README/recipes contain, example-first:
  - the dumb rule: "wiring in the config module → onLoad; wiring in another
    module → onReady" + the analytics counter-recipe (try/catch or
    .load().then() for must-not-kill-the-app callbacks)
  - eager-import warning: onReady module must be imported by main.tsx
    (statically), or the callback registers late
  - "onReady does not run under createTestProvider" — stated explicitly
  - three-file layout as a prerequisite INSIDE the CI-check section (not a
    sidebar); bindReact quick example labelled "you don't need this yet"
    next to attuneReact
  - bindReact inference footgun ("let inference flow, don't annotate")
  - retry = full page reload, said loudly; config file caching note
    (`cache: "no-store"` / Cache-Control) so Retry can't loop on a CDN-stale
    config
  - TanStack Router basepath + MSW recipes (register order, worker.start)
  - test baseline spread pattern; async-schema caveat; `z.strictObject` vs
    stamped `_version`/`_generatedAt` caveat; CLI schema module: relative
    imports only + Node/tsx loading note
- **Prompt seed**: Update README (API table, new "Scaling the config module"
  subsection in CI check) and recipes per the acceptance list. Terse,
  example-first, English.

## Task 3.2: Changeset + field report cross-off
- **Agent**: main session
- **Files**: .changeset/*.md, docs/FIELD-REPORT.md
- **Depends on**: all
- **Acceptance**: minor changeset describing onReady/bindReact/retry +
  changelog note "Attuned hand-built mocks need _schema/onReady";
  FIELD-REPORT gets a short "addressed in" header note per item.

## Out of scope

- Cache-dropping `reload()` (idempotency trap — the retry contract wording
  keeps the door open)
- `createTestProvider` base/factory API (userland spread covers it)
- Async schema support in tests (sync-only stays; documented)
- P1 mount-order DEV warning (unreliable detection)
- Deprecating `attuneReact`
- `check --print-fingerprint` for CI observability (fullstack panel wish —
  nice, separate wave)
- Making onReady run under createTestProvider (documented gap instead;
  revisit only on real demand)

## Verification

1. `pnpm typecheck && pnpm test && pnpm build`
2. Repro app (scratchpad/repro): move router-style wiring into
   `appConfig.onReady()` registered from a second module — no cycle, runs
   before first render (assert via render-order log).
3. Kill the config URL → default fallback shows Retry; click reloads.
4. `attunement check --schema` against a schema-only module — no app imports
   pulled in.
5. DEV guard: repro app in `vite dev` shows error detail in the default
   fallback; `vite build && preview` hides it.
